import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { TLSSocket } from "tls";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { discordService } from "./services/discord";
import { z } from "zod";

// Extend Express Request type to include session
declare module 'express-session' {
  interface SessionData {
    botId?: string;
  }
}

interface AuthenticatedWebSocket extends WebSocket {
  botId?: string;
}

interface WebSocketTicket {
  botId: string;
  expiresAt: number;
}

const snowflakeSchema = z.string().regex(/^\d{17,20}$/, "Invalid Discord ID");
const messageContentSchema = z.string()
  .min(1, "Message cannot be empty")
  .max(2000, "Message cannot exceed 2000 characters")
  .refine(value => value.trim().length > 0, "Message cannot be empty");

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy(error => error ? reject(error) : resolve());
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  const connectedClients: Map<string, AuthenticatedWebSocket[]> = new Map();
  const webSocketTickets = new Map<string, WebSocketTicket>();

  // Bot Authentication
  app.post("/api/auth/bot", async (req, res) => {
    try {
      const { token } = z.object({
        token: z.string().trim().min(20).max(256),
      }).strict().parse(req.body);
      
      const result = await discordService.authenticateBot(token);
      
      if (result.success) {
        try {
          await regenerateSession(req);
          req.session.botId = result.bot?.id;
          await saveSession(req);
        } catch (error) {
          if (result.bot?.id) {
            await discordService.disconnectBot(result.bot.id);
          }
          throw error;
        }
        
        res.set("Cache-Control", "no-store");
        res.json({
          success: true,
          bot: result.bot,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: "Invalid authentication request" });
      }
      console.error('Bot authentication error:', error);
      res.status(500).json({ success: false, error: "Authentication failed" });
    }
  });

  // Get current bot session
  app.get("/api/auth/session", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const session = await storage.getBotSession(botId);
    if (!session || !session.isActive) {
      return res.status(401).json({ error: "Bot session not found or inactive" });
    }

    res.set("Cache-Control", "no-store");
    res.json({ botId, session });
  });

  // Mint a short-lived, single-use credential for WebSocket authentication.
  app.post("/api/auth/ws-ticket", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const now = Date.now();
    for (const [ticket, record] of webSocketTickets) {
      if (record.expiresAt <= now) {
        webSocketTickets.delete(ticket);
      }
    }

    const ticket = randomBytes(32).toString("base64url");
    webSocketTickets.set(ticket, { botId, expiresAt: now + 30_000 });
    const expiryTimer = setTimeout(() => webSocketTickets.delete(ticket), 30_000);
    expiryTimer.unref();
    res.set("Cache-Control", "no-store");
    res.json({ ticket });
  });

  // Disconnect bot
  app.post("/api/auth/disconnect", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const success = await discordService.disconnectBot(botId);
      await destroySession(req);
      res.clearCookie("dispanel.sid", { path: "/" });
      res.json({ success });
    } catch (error) {
      console.error('Disconnect error:', error);
      res.status(500).json({ error: "Failed to disconnect bot" });
    }
  });

  // Update bot status
  app.post("/api/bot/status", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { status } = z.object({
        status: z.enum(["online", "idle", "dnd", "invisible"]),
      }).strict().parse(req.body);

      const success = await discordService.updateBotStatus(botId, status);
      res.json({ success });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get bot stats
  app.get("/api/bot/stats", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const stats = await storage.getLatestBotStats(botId);
    res.json({ stats });
  });

  // Send message
  app.post("/api/bot/message", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { targetType, targetId, content } = z.object({
        targetType: z.enum(["channel", "user"]),
        targetId: snowflakeSchema,
        content: messageContentSchema,
      }).strict().parse(req.body);

      const result = await discordService.sendMessage(botId, targetType, targetId, content);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get recent messages
  app.get("/api/bot/messages", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const messages = await storage.getBotMessages(botId, 10);
    res.json({ messages });
  });

  // Get guilds
  app.get("/api/bot/guilds", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const guilds = await storage.getBotGuilds(botId);
    res.json({ guilds: guilds.filter(g => g.isActive) });
  });

  // Generate invite
  app.post("/api/bot/guilds/:guildId/invite", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const guildIdResult = snowflakeSchema.safeParse(req.params.guildId);
    if (!guildIdResult.success) {
      return res.status(400).json({ error: "Invalid guild ID" });
    }
    const guildId = guildIdResult.data;
    const result = await discordService.generateInvite(botId, guildId);
    res.json(result);
  });

  // Leave guild
  app.post("/api/bot/guilds/:guildId/leave", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const guildIdResult = snowflakeSchema.safeParse(req.params.guildId);
    if (!guildIdResult.success) {
      return res.status(400).json({ error: "Invalid guild ID" });
    }
    const guildId = guildIdResult.data;
    const result = await discordService.leaveGuild(botId, guildId);
    res.json(result);
  });

  // Get chat messages
  app.get("/api/bot/chat", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const messages = await storage.getChatMessages(botId);
    res.json({ messages });
  });

  // Send chat message (for testing)
  app.post("/api/bot/chat", async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { content } = z.object({
        content: messageContentSchema,
      }).strict().parse(req.body);

      const message = await storage.createChatMessage({
        botId,
        userId: "test-user",
        username: "Test User",
        content,
        isFromBot: false,
      });

      // Broadcast to connected clients
      broadcastToBotClients(botId, {
        type: "chat_message",
        data: message,
      });

      res.json({ success: true, message });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get guild channels
  app.get('/api/bot/guilds/:guildId/channels', async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    try {
      const guildIdResult = snowflakeSchema.safeParse(req.params.guildId);
      if (!guildIdResult.success) {
        return res.status(400).json({ error: "Invalid guild ID" });
      }
      const guildId = guildIdResult.data;
      const result = await discordService.getGuildChannels(botId, guildId);
      
      if (result.success) {
        res.json({ success: true, channels: result.channels });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Get guild channels error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get the custom emojis available in a guild
  app.get('/api/bot/guilds/:guildId/emojis', async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const guildIdResult = snowflakeSchema.safeParse(req.params.guildId);
      if (!guildIdResult.success) {
        return res.status(400).json({ error: "Invalid guild ID" });
      }
      const guildId = guildIdResult.data;
      const result = await discordService.getGuildEmojis(botId, guildId);

      if (result.success) {
        res.json({ success: true, emojis: result.emojis });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Get guild emojis error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get channel messages
  app.get('/api/bot/channels/:channelId/messages', async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    try {
      const channelIdResult = snowflakeSchema.safeParse(req.params.channelId);
      const limitResult = z.coerce.number().int().min(1).max(100).safeParse(req.query.limit ?? 50);
      const beforeResult = req.query.before === undefined
        ? z.undefined().safeParse(undefined)
        : snowflakeSchema.safeParse(req.query.before);
      if (!channelIdResult.success || !limitResult.success || !beforeResult.success) {
        return res.status(400).json({ error: "Invalid channel ID, message limit, or before cursor" });
      }
      const channelId = channelIdResult.data;
      const limit = limitResult.data;
      const before = beforeResult.data;
      const result = await discordService.getChannelMessages(botId, channelId, limit, before);
      
      if (result.success) {
        res.json({ success: true, messages: result.messages, hasMore: result.hasMore });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Get channel messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update custom status
  app.post('/api/bot/custom-status', async (req, res) => {
    const botId = req.session.botId;
    if (!botId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    try {
      const { text, type } = z.object({
        text: z.string().min(1).max(128),
        type: z.enum(['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING'])
      }).strict().parse(req.body);

      const result = await discordService.updateCustomStatus(botId, text, type);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('Update custom status error:', error);
      res.status(400).json({ error: error.message || 'Invalid request' });
    }
  });

  // WebSocket connection handling
  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    let expectedOrigin: string | null = null;
    let requestOrigin: string | null = null;
    try {
      const forwardedProtocol = req.headers['x-forwarded-proto']?.toString().split(',')[0].trim();
      const protocol = forwardedProtocol === 'https'
        || (req.socket instanceof TLSSocket && req.socket.encrypted)
        ? 'https'
        : 'http';
      expectedOrigin = process.env.PUBLIC_ORIGIN
        ? new URL(process.env.PUBLIC_ORIGIN).origin
        : req.headers.host
          ? `${protocol}://${req.headers.host}`
          : null;
      requestOrigin = req.headers.origin ? new URL(req.headers.origin).origin : null;
    } catch {
      // Invalid origins are rejected below.
    }

    if (!requestOrigin || !expectedOrigin || requestOrigin !== expectedOrigin) {
      ws.close(1008, 'Invalid origin');
      return;
    }

    const authTimeout = setTimeout(() => {
      if (!ws.botId) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('message', (data) => {
      try {
        if (ws.botId) {
          ws.close(1008, 'Unexpected message');
          return;
        }

        const message = z.object({
          type: z.literal('auth'),
          ticket: z.string().length(43),
        }).strict().parse(JSON.parse(data.toString()));
        
        const ticket = webSocketTickets.get(message.ticket);
        webSocketTickets.delete(message.ticket);
        if (!ticket || ticket.expiresAt <= Date.now()) {
          ws.close(1008, 'Invalid authentication ticket');
          return;
        }

        clearTimeout(authTimeout);
        ws.botId = ticket.botId;

        const clients = connectedClients.get(ticket.botId) || [];
        clients.push(ws);
        connectedClients.set(ticket.botId, clients);

        ws.send(JSON.stringify({
          type: 'auth_success',
          botId: ticket.botId,
        }));
      } catch (error) {
        ws.close(1008, 'Invalid authentication message');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      // Remove from connected clients
      if (ws.botId) {
        const clients = connectedClients.get(ws.botId) || [];
        const index = clients.indexOf(ws);
        if (index > -1) {
          clients.splice(index, 1);
        }
        if (clients.length === 0) {
          connectedClients.delete(ws.botId);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  function broadcastToBotClients(botId: string, message: any) {
    const clients = connectedClients.get(botId) || [];
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Set up periodic stats broadcasting
  setInterval(async () => {
    for (const [botId, clients] of connectedClients) {
      if (clients.length > 0) {
        const stats = await storage.getLatestBotStats(botId);
        if (stats) {
          broadcastToBotClients(botId, {
            type: 'stats_update',
            data: stats,
          });
        }
      }
    }
  }, 5000);

  return httpServer;
}
