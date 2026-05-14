import { randomUUID } from "crypto";
import { getDb } from "./index.js";

export interface Lead {
  id: string;
  user_id: string;
  name: string;
  address: string;
  phone: string;
  phone_formatted: string;
  rating: number | null;
  website: string | null;
  place_id: string | null;
  created_at: string;
}

export function addLeads(userId: string, leads: Omit<Lead, "id" | "user_id" | "created_at">[]): Lead[] {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO leads (id, user_id, name, address, phone, phone_formatted, rating, website, place_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const results: Lead[] = [];
  const insertMany = db.transaction(() => {
    for (const lead of leads) {
      const id = randomUUID();
      insert.run(
        id,
        userId,
        lead.name,
        lead.address,
        lead.phone,
        lead.phone_formatted,
        lead.rating,
        lead.website,
        lead.place_id
      );
      results.push({ id, user_id: userId, created_at: new Date().toISOString(), ...lead });
    }
  });

  insertMany();
  return results;
}

export function getLeadsByUser(userId: string): Lead[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as Lead[];
}

export function getLeadByPhone(userId: string, phoneFormatted: string): Lead | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM leads WHERE user_id = ? AND phone_formatted = ?`)
    .get(userId, phoneFormatted) as Lead | undefined;
}

export function getLeadByPlaceId(userId: string, placeId: string): Lead | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM leads WHERE user_id = ? AND place_id = ?`)
    .get(userId, placeId) as Lead | undefined;
}
