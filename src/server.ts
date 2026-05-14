import { config } from "dotenv";
config();

import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { getDb } from "./db/index.js";
import { getUserByEmail, createUser } from "./db/users.js";
import authRoutes from "./auth/routes.js";
import businessRoutes from "./api/businesses.js";
import whatsappRoutes from "./api/whatsapp.js";
import negotiationRoutes from "./api/negotiations.js";
import sseRoutes from "./api/sse.js";
import { initSessionManager } from "./whatsapp/session-manager.js";
import { rateLimit } from "./api/rate-limit.js";
import bcrypt from "bcryptjs";

const PORT = parseInt(process.env.PORT || "3000", 10);
const SESSION_SECRET = process.env.SESSION_SECRET || "agentic-procurement-dev-secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const app = express();

// --- Middleware ---

app.use(express.json());
app.use(cookieParser());

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: createSQLiteSessionStore(),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", FRONTEND_URL);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// --- Routes ---

// Rate limit: 10 auth attempts per 15 minutes per IP
app.use("/api/auth/login", rateLimit(10, 15 * 60 * 1000));
app.use("/api/auth/register", rateLimit(10, 15 * 60 * 1000));

// Rate limit: 30 message sends per minute per IP
app.use("/api/whatsapp/send", rateLimit(30, 60 * 1000));

app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/negotiations", negotiationRoutes);
app.use("/api/events", sseRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Global Error Handler ---

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// --- SQLite session store ---

function createSQLiteSessionStore() {
  const db = getDb();

  const store = new session.MemoryStore() as session.Store;

  // Override with SQLite-backed methods
  store.get = function (sid, callback) {
    try {
      const row = db
        .prepare(`SELECT sess FROM sessions WHERE sid = ? AND expired > datetime('now')`)
        .get(sid) as { sess: string } | undefined;
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err as Error);
    }
  };

  store.set = function (sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expired = new Date(Date.now() + maxAge).toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)`
      ).run(sid, JSON.stringify(sess), expired);
      callback?.(null);
    } catch (err) {
      callback?.(err as Error);
    }
  };

  store.destroy = function (sid, callback) {
    try {
      db.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
      callback?.(null);
    } catch (err) {
      callback?.(err as Error);
    }
  };

  store.touch = function (sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expired = new Date(Date.now() + maxAge).toISOString();
      db.prepare(`UPDATE sessions SET expired = ? WHERE sid = ?`).run(expired, sid);
      callback?.();
    } catch {
      callback?.();
    }
  };

  // Cleanup expired sessions every 15 minutes
  setInterval(() => {
    try {
      db.prepare(`DELETE FROM sessions WHERE expired <= datetime('now')`).run();
    } catch {
      // ignore cleanup errors
    }
  }, 15 * 60 * 1000);

  return store;
}

// --- Seed demo user ---

async function seedDemoUser(): Promise<void> {
  const existing = getUserByEmail("a");
  if (!existing) {
    const hash = await bcrypt.hash("a", 10);
    createUser("a", hash);
    console.log("[Server] Seeded demo user: a / a");
  }
}

// --- Start ---

async function main(): Promise<void> {
  getDb(); // Initialize database
  await seedDemoUser();
  initSessionManager();

  app.listen(PORT, () => {
    console.log(`[Server] Agentic Procurement SaaS running on http://localhost:${PORT}`);
    console.log(`[Server] Frontend expected at ${FRONTEND_URL}`);
    console.log(`[Server] Demo login: a / a`);
  });
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
