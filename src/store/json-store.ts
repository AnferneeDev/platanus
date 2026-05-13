import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

export interface Lead {
  id: string;
  name: string;
  address: string;
  phone: string;
  phoneFormatted: string; // WhatsApp format
  rating?: number;
  website?: string;
  placeId: string;
  messages: Message[];
  createdAt: string;
}

export interface Message {
  direction: "outbound" | "inbound";
  body: string;
  timestamp: string;
  simulated?: boolean;
}

export interface StoreData {
  leads: Lead[];
}

const DATA_PATH = resolve(process.cwd(), "data", "leads.json");

function ensureDataDir(): void {
  const dir = dirname(DATA_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadStore(): StoreData {
  ensureDataDir();
  if (!existsSync(DATA_PATH)) {
    const initial: StoreData = { leads: [] };
    writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(raw) as StoreData;
}

export function saveStore(data: StoreData): void {
  ensureDataDir();
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

export function addLeads(newLeads: Lead[]): Lead[] {
  const store = loadStore();
  for (const lead of newLeads) {
    // Avoid duplicates by placeId
    const exists = store.leads.find((l) => l.placeId === lead.placeId);
    if (!exists) {
      store.leads.push(lead);
    }
  }
  saveStore(store);
  return store.leads;
}

export function addMessage(phone: string, message: Message): Lead | null {
  const store = loadStore();
  const lead = store.leads.find(
    (l) => l.phone === phone || l.phoneFormatted === phone
  );
  if (lead) {
    lead.messages.push(message);
    saveStore(store);
    return lead;
  }
  return null;
}

export function getLeadByPhone(phone: string): Lead | null {
  const store = loadStore();
  return (
    store.leads.find(
      (l) => l.phone === phone || l.phoneFormatted === phone
    ) ?? null
  );
}
