import type { Response } from "express";

export interface SSEClient {
  userId: string;
  res: Response;
}

const clients: SSEClient[] = [];

export function addSSEClient(userId: string, res: Response): void {
  clients.push({ userId, res });

  res.on("close", () => {
    const idx = clients.findIndex((c) => c.res === res);
    if (idx !== -1) clients.splice(idx, 1);
  });
}

export function sendEvent(userId: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.userId === userId) {
      client.res.write(payload);
    }
  }
}

export function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.res.write(payload);
  }
}
