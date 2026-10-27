import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface WebSocketMessage {
  type: string;
  data?: any;
  botId?: string;
}

export function useWebSocket(botId?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!botId) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const ticketResponse = await fetch('/api/auth/ws-ticket', {
          method: 'POST',
          credentials: 'include',
        });
        if (!ticketResponse.ok) {
          throw new Error('Unable to authorize WebSocket connection');
        }

        const { ticket } = await ticketResponse.json();
        if (cancelled) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "auth", ticket }));
        };

        ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            if (message.type === 'auth_success') {
              setIsConnected(true);
            }
            handleWebSocketMessage(message);
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        ws.onclose = () => {
          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          setIsConnected(false);
        };

        ws.onerror = () => {
          setIsConnected(false);
        };
      } catch (error) {
        if (!cancelled) {
          console.error("WebSocket connection failed:", error);
          setIsConnected(false);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [botId]);

  const handleWebSocketMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case "auth_success":
        break;
        
      case "stats_update":
        // Update stats cache
        queryClient.setQueryData(["/api/bot/stats"], {
          stats: message.data,
        });
        break;
        
      case "chat_message":
        // Invalidate chat messages to refetch
        queryClient.invalidateQueries({ queryKey: ["/api/bot/chat"] });
        break;
        
      case "guild_update":
        // Invalidate guilds to refetch
        queryClient.invalidateQueries({ queryKey: ["/api/bot/guilds"] });
        break;
        
      default:
        console.log("Unknown WebSocket message type:", message.type);
    }
  };

  return {
    isConnected,
  };
}
