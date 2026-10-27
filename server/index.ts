import express, { type Request, Response, NextFunction } from "express";
import { config as loadEnv } from "dotenv";
import session from "express-session";
import MemoryStore from "memorystore";
import { randomBytes } from "crypto";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { log } from "./logger";

loadEnv({ quiet: true });

const app = express();
const isProduction = app.get("env") === "production";
const configuredPublicOrigin = process.env.PUBLIC_ORIGIN
  ? new URL(process.env.PUBLIC_ORIGIN).origin
  : undefined;
const usesHttps = configuredPublicOrigin?.startsWith("https://") ?? false;

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(helmet({
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      }
    : false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  strictTransportSecurity: isProduction && usesHttps ? undefined : false,
}));

app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  if (!origin) {
    return next();
  }

  try {
    const expectedOrigin = configuredPublicOrigin
      ? configuredPublicOrigin
      : `${req.protocol}://${req.get("host")}`;
    if (new URL(origin).origin !== expectedOrigin) {
      return res.status(403).json({ error: "Cross-origin request denied" });
    }
  } catch {
    return res.status(403).json({ error: "Invalid request origin" });
  }

  next();
});

app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));

app.use("/api/auth/bot", rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
}));

app.use(["/api/bot/message", "/api/bot/chat"], rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 20 }));

// Session configuration
const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
if (configuredSessionSecret && configuredSessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters when provided");
}
const sessionSecret = configuredSessionSecret || randomBytes(48).toString("base64url");
if (isProduction && !configuredSessionSecret) {
  console.warn("SESSION_SECRET is not set; using an ephemeral secret. Sessions will be invalidated when the server restarts.");
}

const MemStore = MemoryStore(session);
app.use(session({
  name: "dispanel.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new MemStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  }),
  cookie: {
    secure: "auto",
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    priority: "high",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request failed");

    console.error(err);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const configuredPort = process.env.PORT?.trim();
  const port = configuredPort ? Number(configuredPort) : 5000;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
