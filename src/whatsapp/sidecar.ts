import express from "express";
import whatsapp from "whatsapp-web.js";
const { Client, LocalAuth } = whatsapp;
import type { Message as WAMessage } from "whatsapp-web.js";
import QRCode from "qrcode";
import { config } from "dotenv";

config();

const PORT = parseInt(process.env.SIDECAR_PORT || "3001", 10);

// --- WhatsApp Client Setup ---

let isConnected = false;
let currentQR: string | null = null;
let qrDataUrl: string | null = null;

// Store incoming messages: Map<senderNumber, Message[]>
const incomingMessages = new Map<string, { body: string; timestamp: string }[]>();

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

client.on("message", (msg: WAMessage) => {
  const sender = msg.from;
  const existing = incomingMessages.get(sender) || [];
  existing.push({
    body: msg.body,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 20 messages per sender
  if (existing.length > 20) {
    existing.splice(0, existing.length - 20);
  }
  incomingMessages.set(sender, existing);
  console.error(`[WhatsApp] Message from ${sender}: ${msg.body.substring(0, 100)}`);
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

// Check replies from specific numbers
app.get("/replies", (req, res) => {
  const numbersParam = (req.query.numbers as string) || "";
  const numbers = numbersParam
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (numbers.length === 0) {
    // Return all incoming messages
    const all: Record<string, { body: string; timestamp: string }[]> = {};
    for (const [key, value] of incomingMessages) {
      all[key] = value;
    }
    res.json({ replies: all });
    return;
  }

  const result: Record<string, { body: string; timestamp: string }[]> = {};
  for (const num of numbers) {
    const chatId = num.includes("@c.us") ? num : `${num}@c.us`;
    const messages = incomingMessages.get(chatId) || [];
    if (messages.length > 0) {
      result[chatId] = messages;
    }
  }
  res.json({ replies: result });
});

// --- Start ---

console.error(`[Sidecar] Starting WhatsApp sidecar on port ${PORT}...`);
client.initialize();

app.listen(PORT, () => {
  console.error(`[Sidecar] HTTP server listening on http://localhost:${PORT}`);
  console.error(`[Sidecar] QR page: http://localhost:${PORT}/qr`);
  console.error(`[Sidecar] Status: http://localhost:${PORT}/status`);
});
