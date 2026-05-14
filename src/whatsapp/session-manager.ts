import whatsapp from "whatsapp-web.js";
const { Client, LocalAuth } = whatsapp;
import type { Message as WAMessage, Client as WAClient } from "whatsapp-web.js";
import QRCode from "qrcode";
import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import {
  getActiveNegotiation,
  updateNegotiationStatus,
  incrementNegotiationRounds,
  type Negotiation,
} from "../db/negotiations.js";
import { addMessage, getMessagesByPhone } from "../db/messages.js";
import {
  generateResponse,
  type ConversationMessage,
  type NegotiationContext,
  type AutoResponderResult,
} from "./auto-responder.js";
import { sendEvent } from "../api/events.js";

// --- Types ---

export interface SessionStatus {
  connected: boolean;
  hasQR: boolean;
  state: "disconnected" | "qr_pending" | "connecting" | "ready";
}

interface UserSession {
  userId: string;
  client: WAClient;
  connected: boolean;
  currentQR: string | null;
  qrDataUrl: string | null;
  lidCache: Map<string, string>;
  lastActivity: number;
  initializing: boolean;
}

// --- Session Manager Singleton ---

const sessions = new Map<string, UserSession>();
const SESSION_DIR = resolve(process.cwd(), ".wwebjs_sessions");
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 4;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function initSessionManager(): void {
  mkdirSync(SESSION_DIR, { recursive: true });

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS && session.connected) {
        console.log(`[SessionManager] Idle timeout for user ${userId}, disconnecting...`);
        destroySession(userId);
      }
    }
  }, 60_000);

  console.log(`[SessionManager] Initialized. Max sessions: ${MAX_SESSIONS}, idle timeout: ${IDLE_TIMEOUT_MS / 60000}min`);
}

export function getSessionManager() {
  return {
    getStatus,
    getQR,
    sendMessage,
    initSession,
    destroySession,
    getSession,
  };
}

// --- Public API ---

async function getStatus(userId: string): Promise<SessionStatus> {
  const session = sessions.get(userId);

  if (!session) {
    return { connected: false, hasQR: false, state: "disconnected" };
  }

  if (session.connected) {
    session.lastActivity = Date.now();
    return { connected: true, hasQR: false, state: "ready" };
  }

  if (session.currentQR) {
    return { connected: false, hasQR: true, state: "qr_pending" };
  }

  if (session.initializing) {
    return { connected: false, hasQR: false, state: "connecting" };
  }

  return { connected: false, hasQR: false, state: "disconnected" };
}

async function getQR(userId: string): Promise<string | null> {
  let session = sessions.get(userId);

  if (!session) {
    session = await initSession(userId);
  }

  // If already connected, no QR needed
  if (session.connected) return null;

  // If QR is available, return it
  if (session.qrDataUrl) return session.qrDataUrl;

  // Wait a bit for QR to generate
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    if (session.qrDataUrl) return session.qrDataUrl;
    if (session.connected) return null;
  }

  return session.qrDataUrl;
}

async function sendMessage(userId: string, chatId: string, message: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session || !session.connected) {
    throw new Error("WhatsApp is not connected. Please scan the QR code first.");
  }

  const id = chatId.includes("@") ? chatId : `${chatId}@c.us`;
  console.log(`[SessionManager] sendMessage called: chatId input="${chatId}", resolved ID="${id}", body="${message.substring(0, 60)}"`);
  const sent = await session.client.sendMessage(id, message);
  console.log(`[SessionManager] sendMessage result: id=${JSON.stringify(sent.id)}, from=${sent.from}, to=${sent.to}, author=${sent.author}, body="${sent.body?.substring(0, 60)}"`);
  session.lastActivity = Date.now();
}

function getSession(userId: string): UserSession | undefined {
  return sessions.get(userId);
}

// --- Session Lifecycle ---

async function initSession(userId: string): Promise<UserSession> {
  const existing = sessions.get(userId);
  if (existing) return existing;

  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest idle session
    let oldestUserId: string | null = null;
    let oldestTime = Infinity;
    for (const [uid, s] of sessions) {
      if (s.lastActivity < oldestTime) {
        oldestTime = s.lastActivity;
        oldestUserId = uid;
      }
    }
    if (oldestUserId) {
      console.log(`[SessionManager] Evicting idle session for user ${oldestUserId}`);
      await destroySession(oldestUserId);
    }
  }

  const sessionPath = resolve(SESSION_DIR, `session-${userId}`);
  mkdirSync(sessionPath, { recursive: true });

  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];
  console.log(`[SessionManager] Starting WhatsApp client for user ${userId}`);
  console.log(`[SessionManager] Session dir: ${sessionPath}`);
  console.log(`[SessionManager] Puppeteer args: ${puppeteerArgs.join(" ")}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: SESSION_DIR,
    }),
    puppeteer: {
      headless: true,
      args: puppeteerArgs,
    },
  });

  const session: UserSession = {
    userId,
    client,
    connected: false,
    currentQR: null,
    qrDataUrl: null,
    lidCache: new Map(),
    lastActivity: Date.now(),
    initializing: true,
  };

  sessions.set(userId, session);

  // Wire up ALL events with verbose logging
  client.on("loading_screen", (percent: number, message: string) => {
    console.log(`[SessionManager] Loading screen [${userId}]: ${percent}% — ${message}`);
  });

  client.on("qr", async (qr: string) => {
    session.currentQR = qr;
    session.qrDataUrl = await QRCode.toDataURL(qr);
    console.log(`[SessionManager] QR generated for user ${userId} (qr string length: ${qr.length})`);
    sendEvent(userId, "whatsapp:qr", { qr: session.qrDataUrl });
  });

  client.on("ready", async () => {
    session.connected = true;
    session.currentQR = null;
    session.qrDataUrl = null;
    session.initializing = false;
    session.lastActivity = Date.now();
    const info = client.info;
    console.log(`[SessionManager] ✅ WhatsApp READY for user ${userId}`);
    console.log(`[SessionManager]   wid._serialized: ${JSON.stringify(info?.wid?._serialized)}`);
    console.log(`[SessionManager]   wid.user: ${info?.wid?.user}`);
    console.log(`[SessionManager]   wid.server: ${info?.wid?.server}`);
    console.log(`[SessionManager]   pushname: ${info?.pushname}`);
    console.log(`[SessionManager]   platform: ${info?.platform}`);
    console.log(`[SessionManager]   me._serialized: ${JSON.stringify(info?.me?._serialized)}`);
    console.log(`[SessionManager]   me.user: ${info?.me?.user}`);
    // Dump all stored session files
    try {
      const { readdirSync, readFileSync, existsSync } = await import("fs");
      const sessionDir = resolve(SESSION_DIR, `session-${userId}`);
      if (existsSync(sessionDir)) {
        const files = readdirSync(sessionDir);
        console.log(`[SessionManager]   Session files in ${sessionDir}: ${files.join(", ")}`);
      }
    } catch {}
    sendEvent(userId, "whatsapp:ready", { phone: info?.wid?.user });
  });

  client.on("authenticated", () => {
    console.log(`[SessionManager] 🔑 Authenticated for user ${userId}`);
  });

  client.on("auth_failure", (msg: string) => {
    console.error(`[SessionManager] ❌ Auth FAILURE for user ${userId}: ${msg}`);
    session.initializing = false;
    sendEvent(userId, "whatsapp:auth_failure", { message: msg });
  });

  client.on("disconnected", (reason: string) => {
    session.connected = false;
    session.initializing = false;
    console.log(`[SessionManager] ⚠️ Disconnected user ${userId}: ${reason}`);
    sendEvent(userId, "whatsapp:disconnected", { reason });
  });

  client.on("change_state", (state: string) => {
    console.log(`[SessionManager] State change [${userId}]: ${state}`);
  });

  client.on("message", async (msg: WAMessage) => {
    await handleIncomingMessage(userId, session, msg);
  });

  client.on("message_create", (msg: WAMessage) => {
    console.log(`[SessionManager] message_create [${userId}]: id=${JSON.stringify(msg.id)}, from=${msg.from}, to=${msg.to}, author=${msg.author}, body="${msg.body?.substring(0, 80)}", timestamp=${msg.timestamp}, hasMedia=${!!msg.hasMedia}, type=${msg.type}`);
  });

  // Initialize and log result
  console.log(`[SessionManager] Calling client.initialize() for user ${userId}...`);
  client.initialize()
    .then(() => {
      console.log(`[SessionManager] ✅ client.initialize() resolved for user ${userId}`);
    })
    .catch((err) => {
      console.error(`[SessionManager] ❌ Init FAILED for user ${userId}:`, err);
      console.error(`[SessionManager]   Stack: ${(err as Error).stack}`);
      session.initializing = false;
    });

  return session;
}

async function destroySession(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session) return;

  try {
    await session.client.destroy();
  } catch (err) {
    console.error(`[SessionManager] Destroy error for user ${userId}:`, err);
  }

  sessions.delete(userId);
  console.log(`[SessionManager] Session destroyed for user ${userId}`);
}

// --- Incoming Message Handler (Auto-Respond) ---

async function handleIncomingMessage(userId: string, session: UserSession, msg: WAMessage): Promise<void> {
  const rawSender = msg.from;

  if (!msg.body || msg.body.trim().length === 0) return;
  if (rawSender === "status@broadcast") return;
  if (msg.fromMe) return; // Ignore messages we sent ourselves

  let resolvedKey = rawSender;
  // replyTo is the actual chat ID WhatsApp needs to route the reply correctly.
  // For LID contacts this MUST be the @lid address, not the resolved @c.us number.
  let replyTo = rawSender;

  // LID resolution — resolve to a stable @c.us key for DB storage/lookup,
  // but keep replyTo as the original @lid so WhatsApp can route replies.
  if (rawSender.includes("@lid")) {
    const cached = session.lidCache.get(rawSender);
    if (cached) {
      resolvedKey = cached;
      // replyTo stays as rawSender (@lid) — that's what WhatsApp needs
    } else {
      try {
        const contact = await msg.getContact();
        const phone =
          (contact?.number && !contact.number.startsWith("1") ? contact.number : null) ||
          (contact?.id?.user && contact.id.user.length >= 10 && contact.id._serialized?.includes("@c.us")
            ? contact.id.user
            : null);

        if (phone) {
          resolvedKey = `${phone}@c.us`;
          session.lidCache.set(rawSender, resolvedKey);
        } else {
          try {
            const chat = await msg.getChat();
            const chatId = (chat as any).id?.user;
            if (chatId && chatId.length >= 10) {
              resolvedKey = `${chatId}@c.us`;
              session.lidCache.set(rawSender, resolvedKey);
            }
          } catch {
            // fallback: keep resolvedKey as rawSender, replyTo already set
          }
        }
      } catch (err) {
        console.error(`[SessionManager] LID resolution failed for ${rawSender}: ${err}`);
      }
    }
  }

  session.lastActivity = Date.now();

  // Store inbound message in DB
  addMessage(userId, resolvedKey, "inbound", msg.body);

  console.log(`[SessionManager] Message from ${resolvedKey} for user ${userId}: ${msg.body.substring(0, 80)}`);

  // Check for active negotiation — try multiple key formats
  const phoneNumber = resolvedKey.replace("@c.us", "");
  let negotiation = getActiveNegotiation(userId, phoneNumber) || getActiveNegotiation(userId, resolvedKey);

  // Fallback: if no match by phone, look up ANY active negotiation for this user.
  // This handles the case where formatToWhatsApp produces a different number than WhatsApp's internal ID.
  if (!negotiation) {
    const { getActiveNegotiationsByUser } = await import("../db/negotiations.js");
    const activeNegs = getActiveNegotiationsByUser(userId);
    if (activeNegs.length === 1) {
      negotiation = activeNegs[0];
      // Update the phone_formatted to the actual WhatsApp ID so future lookups work
      const db = (await import("../db/index.js")).getDb();
      db.prepare(`UPDATE negotiations SET phone_formatted = ? WHERE id = ? AND status = 'active'`).run(resolvedKey, negotiation.id);
      console.log(`[SessionManager] Phone mismatch — assigned negotiation ${negotiation.id} to ${resolvedKey} (was ${negotiation.phone_formatted})`);
    } else if (activeNegs.length > 1) {
      console.log(`[SessionManager] ${activeNegs.length} active negotiations for user ${userId.slice(0, 8)}:`);
      for (const n of activeNegs) {
        console.log(`[SessionManager]   neg ${n.id.slice(0,8)}: phone="${n.phone}" phone_formatted="${n.phone_formatted}" biz="${n.business_name}"`);
      }
      console.log(`[SessionManager]   Incoming resolvedKey: "${resolvedKey}" phoneNumber: "${phoneNumber}"`);
    }
  }

  if (negotiation) {
    console.log(`[SessionManager] Found negotiation ${negotiation.id} (status: ${negotiation.status})`);
  } else {
    console.log(`[SessionManager] No active negotiation found for ${phoneNumber} or ${resolvedKey} (user ${userId.slice(0, 8)})`);
    // Dump ALL negotiations for this user to diagnose
    try {
      const { getNegotiationsByUser } = await import("../db/negotiations.js");
      const allNegs = getNegotiationsByUser(userId);
      console.log(`[SessionManager] All ${allNegs.length} negotiations for user:`);
      for (const n of allNegs) {
        console.log(`[SessionManager]   neg ${n.id.slice(0,8)}: phone="${n.phone}" phone_formatted="${n.phone_formatted}" status=${n.status} biz="${n.business_name}"`);
      }
    } catch {}
  }

  // Send SSE with negotiation ID so frontend can match reliably
  sendEvent(userId, "message:received", {
    phone: resolvedKey,
    phoneStripped: phoneNumber,
    negotiationId: negotiation?.id || null,
    body: msg.body,
    timestamp: new Date().toISOString(),
  });

  if (!negotiation || negotiation.status !== "active") return;

  console.log(`[SessionManager] Auto-responding for negotiation ${negotiation.id}`);

  // Check round limit
  incrementNegotiationRounds(negotiation.id);
  const refreshedNeg = (await import("../db/negotiations.js")).getNegotiationById(negotiation.id);
  if (!refreshedNeg) return;

  if (refreshedNeg.rounds > refreshedNeg.max_rounds) {
    console.log(`[SessionManager] Max rounds reached for negotiation ${negotiation.id}`);
    updateNegotiationStatus(negotiation.id, "stopped", "max_rounds");
    sendEvent(userId, "negotiation:completed", {
      negotiationId: negotiation.id,
      status: "stopped",
      reason: "max_rounds",
    });

    await sendDealSummary(session, refreshedNeg, {
      reply: "Negotiation stopped after reaching max rounds.",
      shouldClose: true,
      reason: "max_rounds",
      detectedLanguage: "en",
    }, resolvedKey);
    return;
  }

  // Build conversation history from DB
  const allMessages = getMessagesByPhone(userId, resolvedKey);
  const conversationHistory: ConversationMessage[] = allMessages
    .filter((m) => !(m.direction === "inbound" && m.body === msg.body && m.timestamp === allMessages[allMessages.length - 1]?.timestamp))
    .map((m) => ({
      role: (m.direction === "outbound" ? "assistant" : "user") as "assistant" | "user",
      content: m.body,
    }));

  const negContext: NegotiationContext = {
    businessName: refreshedNeg.business_name || undefined,
    phone: resolvedKey.replace("@c.us", ""),
    context: refreshedNeg.context,
    objective: refreshedNeg.objective,
    brief: refreshedNeg.brief || `BRIEF: ${refreshedNeg.context}\nOBJECTIVE: ${refreshedNeg.objective}`,
  };

  try {
    const result = await generateResponse(negContext, conversationHistory, msg.body);
    console.log(`[SessionManager] AI response: ${result.reply.substring(0, 80)}${result.shouldClose ? ` [${result.reason}]` : ""}`);

    // Reply using replyTo (the original @lid or @c.us from the incoming message).
    // Using resolvedKey (@c.us) fails for LID contacts with "No LID for user".
    console.log(`[SessionManager] Sending reply to replyTo="${replyTo}" (resolvedKey="${resolvedKey}")`);
    await session.client.sendMessage(replyTo, result.reply);

    // Store outbound in DB under the resolved key for consistency
    addMessage(userId, resolvedKey, "outbound", result.reply);

    sendEvent(userId, "message:sent", {
      phone: resolvedKey,
      body: result.reply,
      timestamp: new Date().toISOString(),
      auto: true,
    });

    if (result.shouldClose) {
      const newStatus = result.reason === "deal_accepted" ? "completed" as const : "rejected" as const;
      updateNegotiationStatus(negotiation.id, newStatus, result.reason);

      sendEvent(userId, "negotiation:completed", {
        negotiationId: negotiation.id,
        status: newStatus,
        reason: result.reason,
      });

      await sendDealSummary(session, { ...refreshedNeg, status: newStatus }, result, resolvedKey);
    }
  } catch (err) {
    console.error(`[SessionManager] Auto-respond error: ${err}`);
  }
}

// --- Deal Summary Notification ---

async function sendDealSummary(
  session: UserSession,
  negotiation: Negotiation,
  result: AutoResponderResult,
  resolvedKey: string
): Promise<void> {
  try {
    const ownNumber = (session.client as any).info?.wid?.user;
    if (!ownNumber) return;

    const ownChatId = `${ownNumber}@c.us`;
    const summary = await generateSummaryText(negotiation, result, resolvedKey);
    await session.client.sendMessage(ownChatId, summary);
    console.log(`[SessionManager] Deal summary sent to self for user ${session.userId}`);
  } catch (err) {
    console.error(`[SessionManager] Failed to send deal summary: ${err}`);
  }
}

async function generateSummaryText(
  negotiation: Negotiation,
  result: AutoResponderResult,
  resolvedKey: string
): Promise<string> {
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
  const statusLabel = result.reason === "deal_accepted" ? "ACCEPTED" : result.reason === "deal_rejected" ? "REJECTED" : "MAX ROUNDS";

  if (!DEEPSEEK_KEY) {
    return `${result.reason === "deal_accepted" ? "✅" : "❌"} ${statusLabel}\n${negotiation.business_name || resolvedKey}\n${negotiation.phone}\n${result.reply}`;
  }

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 250,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You format negotiation result summaries. CRITICAL: write the ENTIRE summary in the SAME LANGUAGE as the negotiation context. Detect the context language and use it for all labels. No English unless the context is English. No explanations — output only the summary text.`,
          },
          {
            role: "user",
            content: `Generate a brief summary of this completed negotiation. Write all labels and text in the same language as the CONTEXT below.

Status: ${statusLabel} (${result.reason})
Business: ${negotiation.business_name || resolvedKey} (${negotiation.phone})
Context: ${negotiation.context}
Objective: ${negotiation.objective}
Final reply: ${result.reply}
Total rounds: ${negotiation.rounds}/${negotiation.max_rounds}`,
          },
        ],
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      return data.choices?.[0]?.message?.content?.trim() || `${statusLabel}: ${negotiation.phone}`;
    }
  } catch (err) {
    console.error(`[SessionManager] Summary generation failed: ${err}`);
  }

  return `${statusLabel}\n${negotiation.business_name || resolvedKey} (${negotiation.phone})\n${negotiation.context.substring(0, 100)}\n${result.reply}`;
}

// --- Util ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
