import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { addMessage, getInboundReplies } from "../db/messages.js";
import { formatToWhatsApp } from "../utils/phone-formatter.js";
import { getActiveNegotiation } from "../db/negotiations.js";
import { getSessionManager } from "../whatsapp/session-manager.js";
import { sendEvent } from "./events.js";

const router = Router();

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const manager = getSessionManager();
    const status = await manager.getStatus(userId);
    console.log(`[WhatsApp API] GET /status for user ${userId.slice(0,8)} -> ${JSON.stringify(status)}`);
    res.json(status);
  } catch (err) {
    console.error("[WhatsApp] Status error:", err);
    res.status(500).json({ error: "Failed to get WhatsApp status" });
  }
});

router.get("/qr", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const manager = getSessionManager();
    console.log(`[WhatsApp API] GET /qr for user ${userId.slice(0,8)}`);
    const qrData = await manager.getQR(userId);

    if (!qrData) {
      res.status(404).json({ error: "No QR code available. Session may already be connected." });
      return;
    }

    res.json({ qr: qrData });
  } catch (err) {
    console.error("[WhatsApp] QR error:", err);
    res.status(500).json({ error: "Failed to get QR code" });
  }
});

router.post("/send", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const { phoneNumber, message } = req.body as { phoneNumber?: string; message?: string };

    if (!phoneNumber || !message) {
      res.status(400).json({ error: "phoneNumber and message are required" });
      return;
    }

    const formatted = formatToWhatsApp(phoneNumber);
    const manager = getSessionManager();
    await manager.sendMessage(userId, formatted, message);

    addMessage(userId, formatted, "outbound", message);

    const neg = getActiveNegotiation(userId, formatted) || getActiveNegotiation(userId, formatted.replace(/\D/g, ""));

    sendEvent(userId, "message:sent", {
      phone: formatted,
      phoneStripped: formatted.replace(/\D/g, "").replace("@c.us", ""),
      negotiationId: neg?.id || null,
      message,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      to: formatted,
      message,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[WhatsApp] Send error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.get("/replies", requireAuth, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const numbersParam = req.query.numbers as string | undefined;
    const phoneNumbers = numbersParam ? numbersParam.split(",").map((n) => formatToWhatsApp(n.trim())) : undefined;

    const replies = getInboundReplies(userId, phoneNumbers);

    res.json({ replies });
  } catch (err) {
    console.error("[WhatsApp] Replies error:", err);
    res.status(500).json({ error: "Failed to get replies" });
  }
});

export default router;
