import express from "express";
import whatsapp from "whatsapp-web.js";
const { Client, LocalAuth } = whatsapp;
import type { Message as WAMessage } from "whatsapp-web.js";
import QRCode from "qrcode";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { config } from "dotenv";

config();

const PORT = parseInt(process.env.SIDECAR_PORT || "3001", 10);
const MESSAGES_PATH = resolve(process.cwd(), "data", "messages.json");

// --- Persistent Message Store ---

interface StoredMessage {
  body: string;
  timestamp: string;
  rawSender: string; // Original sender ID (e.g. @lid, @c.us)
}

// Map<normalizedPhoneNumber@c.us, StoredMessage[]>
let incomingMessages: Record<string, StoredMessage[]> = {};

function ensureDataDir(): void {
  const dir = dirname(MESSAGES_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadMessages(): void {
  ensureDataDir();
  if (existsSync(MESSAGES_PATH)) {
    try {
      const raw = readFileSync(MESSAGES_PATH, "utf-8");
      incomingMessages = JSON.parse(raw);
      console.error(`[Store] Loaded ${Object.keys(incomingMessages).length} contacts from disk.`);
    } catch {
      console.error("[Store] Failed to parse messages.json, starting fresh.");
      incomingMessages = {};
    }
  }
}

function persistMessages(): void {
  ensureDataDir();
  writeFileSync(MESSAGES_PATH, JSON.stringify(incomingMessages, null, 2));
}

function storeMessage(resolvedKey: string, msg: StoredMessage): void {
  if (!incomingMessages[resolvedKey]) {
    incomingMessages[resolvedKey] = [];
  }
  incomingMessages[resolvedKey].push(msg);
  // Keep last 50 messages per contact
  if (incomingMessages[resolvedKey].length > 50) {
    incomingMessages[resolvedKey] = incomingMessages[resolvedKey].slice(-50);
  }
  persistMessages();
}

// --- LID Resolution Cache ---
// Maps @lid IDs to resolved @c.us phone numbers so we don't re-resolve every message
const lidCache = new Map<string, string>();

// --- WhatsApp Client Setup ---

let isConnected = false;
let currentQR: string | null = null;
let qrDataUrl: string | null = null;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

client.on("qr", async (qr: string) => {
  currentQR = qr;
  qrDataUrl = await QRCode.toDataURL(qr);
  console.error(`[WhatsApp] QR code received. Scan at http://localhost:${PORT}/qr`);
});

client.on("ready", () => {
  isConnected = true;
  currentQR = null;
  qrDataUrl = null;
  console.error("[WhatsApp] Client is ready and connected!");
});

client.on("authenticated", () => {
  console.error("[WhatsApp] Authenticated successfully.");
});

client.on("auth_failure", (msg: string) => {
  console.error("[WhatsApp] Auth failure:", msg);
});

client.on("disconnected", (reason: string) => {
  isConnected = false;
  console.error("[WhatsApp] Disconnected:", reason);
});

// --- Message Handler: Resolve @lid → phone number, then store ---

client.on("message", async (msg: WAMessage) => {
  const rawSender = msg.from;

  // Skip empty messages and status broadcasts
  if (!msg.body || msg.body.trim().length === 0) return;
  if (rawSender === "status@broadcast") return;

  let resolvedKey = rawSender;

  // If sender is a @lid (Linked Device ID), resolve to actual phone number
  if (rawSender.includes("@lid")) {
    // Check cache first
    const cached = lidCache.get(rawSender);
    if (cached) {
      resolvedKey = cached;
    } else {
      try {
        const contact = await msg.getContact();
        // Log all useful contact fields for debugging
        console.error(`[WhatsApp] Contact for LID ${rawSender}: id=${JSON.stringify(contact?.id)}, number=${contact?.number}, pushname=${contact?.pushname}`);

        // Try multiple resolution strategies
        const phone =
          // 1. contact.number (sometimes returns the lid number, not phone)
          (contact?.number && !contact.number.startsWith("1") ? contact.number : null) ||
          // 2. contact.id.user if it looks like a phone number
          (contact?.id?.user && contact.id.user.length >= 10 && contact.id._serialized?.includes("@c.us")
            ? contact.id.user
            : null);

        if (phone) {
          resolvedKey = `${phone}@c.us`;
          lidCache.set(rawSender, resolvedKey);
          console.error(`[WhatsApp] Resolved LID ${rawSender} → ${resolvedKey}`);
        } else {
          // Fallback: try to get the chat and resolve from there
          try {
            const chat = await msg.getChat();
            const chatId = (chat as any).id?.user;
            if (chatId && chatId.length >= 10) {
              resolvedKey = `${chatId}@c.us`;
              lidCache.set(rawSender, resolvedKey);
              console.error(`[WhatsApp] Resolved LID via chat ${rawSender} → ${resolvedKey}`);
            } else {
              console.error(`[WhatsApp] Could not resolve LID ${rawSender}, storing under raw key. Chat ID: ${JSON.stringify((chat as any).id)}`);
            }
          } catch (chatErr) {
            console.error(`[WhatsApp] Chat fallback failed for ${rawSender}: ${chatErr}`);
          }
        }
      } catch (err) {
        console.error(`[WhatsApp] Failed to resolve LID ${rawSender}: ${err}`);
        // Store under raw key as fallback — better than losing the message
      }
    }
  }

  const storedMsg: StoredMessage = {
    body: msg.body,
    timestamp: new Date().toISOString(),
    rawSender,
  };

  storeMessage(resolvedKey, storedMsg);
  console.error(`[WhatsApp] Message from ${resolvedKey}: ${msg.body.substring(0, 100)}`);
});

// --- Express Server ---

const app = express();
app.use(express.json());

// Health / status
app.get("/status", (_req, res) => {
  res.json({
    connected: isConnected,
    hasQR: currentQR !== null,
    qrUrl: currentQR ? `http://localhost:${PORT}/qr` : null,
  });
});

// QR code page
app.get("/qr", (_req, res) => {
  if (isConnected) {
    res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:system-ui;background:#0a0a0a;color:#fff;">
          <div style="text-align:center;">
            <h1>WhatsApp Connected</h1>
            <p style="color:#22c55e;font-size:1.5rem;">Session is active. You're good to go.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  if (!qrDataUrl) {
    res.send(`
      <html>
        <head><meta http-equiv="refresh" content="3"></head>
        <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:system-ui;background:#0a0a0a;color:#fff;">
          <div style="text-align:center;">
            <h1>Waiting for QR Code...</h1>
            <p>This page will refresh automatically.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.send(`
    <html>
      <head><meta http-equiv="refresh" content="15"></head>
      <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:system-ui;background:#0a0a0a;color:#fff;">
        <div style="text-align:center;">
          <h1>Scan QR Code with WhatsApp</h1>
          <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
          <img src="${qrDataUrl}" style="width:300px;height:300px;margin:20px auto;border-radius:12px;" />
          <p style="color:#888;">Page refreshes automatically. QR expires in ~60s.</p>
        </div>
      </body>
    </html>
  `);
});

// Send a message
app.post("/send", async (req, res) => {
  const { number, message } = req.body as { number: string; message: string };

  if (!isConnected) {
    res.status(503).json({ error: "WhatsApp is not connected. Scan QR first." });
    return;
  }

  if (!number || !message) {
    res.status(400).json({ error: "Missing 'number' or 'message' in body." });
    return;
  }

  try {
    const chatId = number.includes("@c.us") ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    console.error(`[WhatsApp] Sent to ${chatId}: ${message.substring(0, 100)}`);
    res.json({ success: true, to: chatId, message });
  } catch (err) {
    console.error("[WhatsApp] Send error:", err);
    res.status(500).json({ error: "Failed to send message", details: String(err) });
  }
});

// Check replies — exact match by normalized @c.us key
app.get("/replies", (req, res) => {
  const numbersParam = (req.query.numbers as string) || "";
  const numbers = numbersParam
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (numbers.length === 0) {
    // Return all messages
    res.json({ replies: incomingMessages });
    return;
  }

  const result: Record<string, StoredMessage[]> = {};
  for (const num of numbers) {
    // Normalize to @c.us format
    const key = num.includes("@") ? num : `${num}@c.us`;
    const messages = incomingMessages[key];
    if (messages && messages.length > 0) {
      result[key] = messages;
    }
  }
  res.json({ replies: result });
});

// --- Start ---

console.error(`[Sidecar] Starting WhatsApp sidecar on port ${PORT}...`);
loadMessages();
client.initialize();

app.listen(PORT, () => {
  console.error(`[Sidecar] HTTP server listening on http://localhost:${PORT}`);
  console.error(`[Sidecar] QR page: http://localhost:${PORT}/qr`);
  console.error(`[Sidecar] Status: http://localhost:${PORT}/status`);
});
