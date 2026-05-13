/**
 * HTTP client for communicating with the WhatsApp sidecar.
 */

const SIDECAR_URL = `http://localhost:${process.env.SIDECAR_PORT || "3001"}`;

export interface SidecarStatus {
  connected: boolean;
  hasQR: boolean;
  qrUrl: string | null;
}

export interface SendResult {
  success: boolean;
  to: string;
  message: string;
}

export interface RepliesResult {
  replies: Record<string, { body: string; timestamp: string }[]>;
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${SIDECAR_URL}${path}`;
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sidecar responded ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof TypeError && String(err).includes("fetch")) {
      throw new Error(
        `Cannot reach WhatsApp sidecar at ${SIDECAR_URL}. Is it running? Start it with: npm run sidecar`
      );
    }
    throw err;
  }
}

export async function getStatus(): Promise<SidecarStatus> {
  return fetchJSON<SidecarStatus>("/status");
}

export async function sendMessage(number: string, message: string): Promise<SendResult> {
  return fetchJSON<SendResult>("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number, message }),
  });
}

export async function getReplies(numbers?: string[]): Promise<RepliesResult> {
  const query = numbers && numbers.length > 0 ? `?numbers=${numbers.join(",")}` : "";
  return fetchJSON<RepliesResult>(`/replies${query}`);
}
