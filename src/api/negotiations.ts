import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  createNegotiation,
  getNegotiationsByUser,
  getActiveNegotiation,
  updateNegotiationStatus,
} from "../db/negotiations.js";
import { addMessage, getMessagesByPhone } from "../db/messages.js";
import { formatToWhatsApp } from "../utils/phone-formatter.js";
import { generateBrief } from "../whatsapp/auto-responder.js";
import { getSessionManager } from "../whatsapp/session-manager.js";
import { sendEvent } from "./events.js";

const router = Router();

router.get("/", requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const negotiations = getNegotiationsByUser(userId);
  res.json({ negotiations });
});

router.get("/:id", requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const negotiations = getNegotiationsByUser(userId);
  const negotiation = negotiations.find((n) => n.id === req.params.id);

  if (!negotiation) {
    res.status(404).json({ error: "Negotiation not found" });
    return;
  }

  const messages = getMessagesByPhone(userId, negotiation.phone_formatted);

  res.json({ negotiation, messages });
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const {
      phoneNumber,
      businessName,
      context,
      objective,
      initialMessage,
      maxRounds,
    } = req.body as {
      phoneNumber?: string;
      businessName?: string;
      context?: string;
      objective?: string;
      initialMessage?: string;
      maxRounds?: number;
    };

    if (!phoneNumber || !context || !objective) {
      res.status(400).json({ error: "phoneNumber, context, and objective are required" });
      return;
    }

    const formatted = formatToWhatsApp(phoneNumber);
    console.log(`[Negotiations API] User ${userId.slice(0, 8)} — raw input: "${phoneNumber}" → formatted: "${formatted}"`);

    const existing = getActiveNegotiation(userId, formatted);
    if (existing) {
      res.status(409).json({ error: "Active negotiation already exists for this number", negotiation: existing });
      return;
    }

    const brief = await generateBrief(context, objective);

    const negotiation = createNegotiation(userId, {
      phone: phoneNumber,
      phoneFormatted: formatted,
      businessName,
      context,
      objective,
      brief,
      maxRounds,
    });

    const manager = getSessionManager();
    const firstMessage =
      initialMessage ||
      `Hola! Estoy interesado en sus servicios. ${context}. Me podría dar información sobre disponibilidad y precios?`;

    await manager.sendMessage(userId, formatted, firstMessage);
    addMessage(userId, formatted, "outbound", firstMessage);

    sendEvent(userId, "negotiation:started", { negotiation });

    res.status(201).json({
      success: true,
      negotiation,
      initialMessageSent: firstMessage,
    });
  } catch (err) {
    console.error("[Negotiations] Start error:", err);
    res.status(500).json({ error: "Failed to start negotiation" });
  }
});

router.delete("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const negotiations = getNegotiationsByUser(userId);
    const negotiation = negotiations.find((n) => n.id === req.params.id);

    if (!negotiation) {
      res.status(404).json({ error: "Negotiation not found" });
      return;
    }

    if (negotiation.status !== "active") {
      res.status(400).json({ error: "Negotiation is not active" });
      return;
    }

    updateNegotiationStatus(negotiation.id, "stopped", "manual_stop");

    sendEvent(userId, "negotiation:stopped", { negotiationId: negotiation.id });

    res.json({ success: true, message: "Negotiation stopped" });
  } catch (err) {
    console.error("[Negotiations] Stop error:", err);
    res.status(500).json({ error: "Failed to stop negotiation" });
  }
});

export default router;
