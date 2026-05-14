import { randomUUID } from "crypto";
import { getDb } from "./index.js";

export interface Negotiation {
  id: string;
  user_id: string;
  phone: string;
  phone_formatted: string;
  business_name: string | null;
  context: string;
  objective: string;
  brief: string;
  status: "active" | "completed" | "rejected" | "stopped";
  reason: string | null;
  rounds: number;
  max_rounds: number;
  started_at: string;
  completed_at: string | null;
}

export function createNegotiation(
  userId: string,
  data: {
    phone: string;
    phoneFormatted: string;
    businessName?: string;
    context: string;
    objective: string;
    brief: string;
    maxRounds?: number;
  }
): Negotiation {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO negotiations (id, user_id, phone, phone_formatted, business_name, context, objective, brief, max_rounds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    data.phone,
    data.phoneFormatted,
    data.businessName || null,
    data.context,
    data.objective,
    data.brief,
    data.maxRounds || 15
  );
  return getNegotiationById(id)!;
}

export function getNegotiationById(id: string): Negotiation | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM negotiations WHERE id = ?`).get(id) as Negotiation | undefined;
}

export function getActiveNegotiation(userId: string, phoneFormatted: string): Negotiation | undefined {
  const db = getDb();
  let result = db
    .prepare(`SELECT * FROM negotiations WHERE user_id = ? AND phone_formatted = ? AND status = 'active'`)
    .get(userId, phoneFormatted) as Negotiation | undefined;
  if (result) return result;

  // Try matching by raw digits (stripped of @c.us and non-digits)
  const digits = phoneFormatted.replace(/\D/g, "");
  result = db
    .prepare(`SELECT * FROM negotiations WHERE user_id = ? AND REPLACE(phone_formatted, ' ', '') LIKE ? AND status = 'active'`)
    .get(userId, `%${digits}%`) as Negotiation | undefined;
  if (result) return result;

  // Try without country code prefix (WhatsApp sometimes strips leading country codes)
  if (digits.length > 10) {
    const withoutPrefix = digits.slice(-10);
    result = db
      .prepare(`SELECT * FROM negotiations WHERE user_id = ? AND REPLACE(phone_formatted, ' ', '') LIKE ? AND status = 'active'`)
      .get(userId, `%${withoutPrefix}%`) as Negotiation | undefined;
    if (result) return result;
  }

  return undefined;
}

export function getNegotiationsByUser(userId: string): Negotiation[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM negotiations WHERE user_id = ? ORDER BY started_at DESC`)
    .all(userId) as Negotiation[];
}

export function getActiveNegotiationsByUser(userId: string): Negotiation[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM negotiations WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC`
    )
    .all(userId) as Negotiation[];
}

export function updateNegotiationStatus(
  id: string,
  status: Negotiation["status"],
  reason?: string
): void {
  const db = getDb();
  const completedAt = status !== "active" ? new Date().toISOString() : null;
  db.prepare(
    `UPDATE negotiations SET status = ?, reason = ?, completed_at = ? WHERE id = ?`
  ).run(status, reason || null, completedAt, id);
}

export function incrementNegotiationRounds(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE negotiations SET rounds = rounds + 1 WHERE id = ?`).run(id);
}

export function getAllNegotiations(): Negotiation[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM negotiations ORDER BY started_at DESC`)
    .all() as Negotiation[];
}
