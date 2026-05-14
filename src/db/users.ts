import { randomUUID } from "crypto";
import { getDb } from "./index.js";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  default_country_code: string;
  created_at: string;
}

export function createUser(email: string, passwordHash: string): User {
  const db = getDb();
  const id = randomUUID();
  const stmt = db.prepare(
    `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`
  );
  stmt.run(id, email.toLowerCase().trim(), passwordHash);
  return getUserById(id)!;
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim()) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    | User
    | undefined;
}

export function updateUserCountryCode(id: string, code: string): void {
  const db = getDb();
  db.prepare(`UPDATE users SET default_country_code = ? WHERE id = ?`).run(
    code,
    id
  );
}
