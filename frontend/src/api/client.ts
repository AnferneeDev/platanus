const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (res.status === 401) {
    // If we get a 401 on a non-auth route, redirect to login
    if (!path.startsWith("/auth/")) {
      window.location.href = "/login";
    }
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}

// Auth
export const auth = {
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: { id: string; email: string } }>("/auth/me"),
};

// Businesses
export const businesses = {
  hasGps: () => request<{ available: boolean }>("/businesses/has-gps"),

  search: (query: string, maxResults = 5) =>
    request<{
      mode: "search" | "manual";
      message: string;
      query?: string;
      businesses?: Array<{
        name: string;
        address: string;
        phone: string;
        phoneFormatted: string;
        rating: number | null;
        website: string | null;
        placeId: string;
      }>;
      skipped?: string[];
    }>("/businesses/search", {
      method: "POST",
      body: JSON.stringify({ query, maxResults }),
    }),

  list: () =>
    request<{ leads: Array<{ id: string; name: string; phone: string; phone_formatted: string; address: string; rating: number | null }> }>("/businesses"),
};

// WhatsApp
export const whatsapp = {
  status: () => request<{ connected: boolean; hasQR: boolean; state: string }>("/whatsapp/status"),
  qr: () => request<{ qr: string }>("/whatsapp/qr"),
  send: (phoneNumber: string, message: string) =>
    request<{ success: boolean; to: string; message: string; timestamp: string }>("/whatsapp/send", {
      method: "POST",
      body: JSON.stringify({ phoneNumber, message }),
    }),
  replies: (numbers?: string[]) =>
    request<{ replies: Record<string, Array<{ body: string; timestamp: string }>> }>(
      `/whatsapp/replies${numbers ? `?numbers=${numbers.join(",")}` : ""}`
    ),
};

// Negotiations
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

export interface Message {
  id: number;
  phone_formatted: string;
  direction: "inbound" | "outbound";
  body: string;
  simulated: number;
  timestamp: string;
}

export const negotiations = {
  list: () => request<{ negotiations: Negotiation[] }>("/negotiations"),

  get: (id: string) => request<{ negotiation: Negotiation; messages: Message[] }>(`/negotiations/${id}`),

  start: (data: {
    phoneNumber: string;
    businessName?: string;
    context: string;
    objective: string;
    initialMessage?: string;
    maxRounds?: number;
  }) =>
    request<{ success: boolean; negotiation: Negotiation; initialMessageSent: string }>("/negotiations", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  stop: (id: string) =>
    request<{ success: boolean; message: string }>(`/negotiations/${id}`, { method: "DELETE" }),
};
