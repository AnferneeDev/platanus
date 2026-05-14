import { getDb } from "./index.js";

export interface Message {
  id: number;
  user_id: string;
  phone_formatted: string;
  direction: "inbound" | "outbound";
  body: string;
  simulated: number;
  timestamp: string;
}

export function addMessage(
  userId: string,
  phoneFormatted: string,
  direction: "inbound" | "outbound",
  body: string,
  simulated: boolean = false
): Message {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO messages (user_id, phone_formatted, direction, body, simulated)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(userId, phoneFormatted, direction, body, simulated ? 1 : 0);
  return getMessageById(Number(result.lastInsertRowid))!;
}

export function getMessageById(id: number): Message | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as Message | undefined;
}

export function getMessagesByPhone(userId: string, phoneFormatted: string): Message[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE user_id = ? AND phone_formatted = ? ORDER BY timestamp ASC`
    )
    .all(userId, phoneFormatted) as Message[];
}

export function getRecentMessages(userId: string, phoneFormatted: string, limit: number = 50): Message[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM messages WHERE user_id = ? AND phone_formatted = ?
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(userId, phoneFormatted, limit) as Message[];
}

export function getInboundReplies(userId: string, phoneNumbers?: string[]): Record<string, Message[]> {
  const db = getDb();
  let rows: Message[];

  if (phoneNumbers && phoneNumbers.length > 0) {
    const placeholders = phoneNumbers.map(() => "?").join(",");
    rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND direction = 'inbound' AND phone_formatted IN (${placeholders})
         ORDER BY timestamp ASC`
      )
      .all(userId, ...phoneNumbers) as Message[];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND direction = 'inbound'
         ORDER BY timestamp ASC`
      )
      .all(userId) as Message[];
  }

  const grouped: Record<string, Message[]> = {};
  for (const msg of rows) {
    if (!grouped[msg.phone_formatted]) grouped[msg.phone_formatted] = [];
    grouped[msg.phone_formatted].push(msg);
  }
  return grouped;
}
