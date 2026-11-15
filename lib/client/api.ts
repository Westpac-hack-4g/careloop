import type { AuditEntry, CustomerId, QueueRow, SessionView } from "../contract";

// Browser-side calls to the API routes. The screens use only these.

async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

export const api = {
  session: (customerId: CustomerId) => call<SessionView>(`/api/chat?customerId=${customerId}`),
  sendText: (customerId: CustomerId, text: string) => call<SessionView>("/api/chat", { customerId, text }),
  sendAction: (customerId: CustomerId, action: string) => call<SessionView>("/api/chat", { customerId, action }),
  queue: () => call<{ queue: QueueRow[] }>("/api/cases"),
  staffReply: (customerId: CustomerId, text: string) => call<{ queue: QueueRow[] }>("/api/cases", { customerId, text }),
  startReview: (customerId: CustomerId) => call<{ queue: QueueRow[] }>("/api/cases", { customerId, op: "start_review" }),
  demoInfo: () => call<{ aiMode: "claude" | "sample"; audit: AuditEntry[] }>("/api/demo"),
  reset: () => call<{ ok: boolean }>("/api/demo", { op: "reset" }),
  sendAlert: (customerId: CustomerId) => call<{ sent: boolean; reason?: string }>("/api/demo", { op: "send_alert", customerId }),
};

export const money = (amount: number) => `${amount < 0 ? "-" : ""}$${Math.abs(Math.round(amount)).toLocaleString("en-AU")}`;

export const shortDate = (date: string, withYear = false) =>
  new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
