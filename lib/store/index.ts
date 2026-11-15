import type Anthropic from "@anthropic-ai/sdk";
import { addDays, DEMO_TODAY, nowIso } from "../clock";
import type { AuditEntry, Case, ChatMessage, CustomerId, DraftField, Phase } from "../contract";
import { allCustomers, getCustomer } from "../data";

// In-memory store for the demo: sessions, cases and the audit log.
// Everything else reads and writes through these functions, so this file is
// the only one to change if the data moves to a real database.

export interface Session {
  customerId: CustomerId;
  phase: Phase;
  /** Level 1 consent: may CareLoop look at this customer's transactions for this request? */
  analysisConsent: boolean;
  alertsOn: boolean;
  sensitive: boolean;
  lockScreenBanner: boolean;
  messages: ChatMessage[];
  draftFields: DraftField[];
  /** The conversation as the LLM sees it. */
  llmHistory: Anthropic.Beta.BetaMessageParam[];
  /** The customer clearly said they cannot pay. Logged for a staff check even after "Not yet". */
  saidCantPay: boolean;
  /** The customer asked for a person. */
  wantsHuman: boolean;
}

interface Store {
  sessions: Map<CustomerId, Session>;
  cases: Case[];
  audit: AuditEntry[];
  nextId: number;
}

// Kept on globalThis so the dev server's hot reload does not wipe the demo.
const g = globalThis as unknown as { __careloop?: Store };

function seed(): Store {
  const store: Store = { sessions: new Map(), cases: [], audit: [], nextId: 1 };
  // Mia missed a repayment on 5 Nov, so her case is already with the Assist team.
  store.cases.push({
    id: "CL-1001",
    customerId: "mia",
    customerName: getCustomer("mia").name,
    tier: 3,
    createdAt: "2026-11-05T09:00:00.000Z",
    respondBy: addDays("2026-11-05", 21),
    status: "in_review",
    summary: ["Last salary 17 Oct (job loss)", "Personal loan repayment of $480 failed on 5 Nov", "Balance $40"],
    draft: { fields: [], missing: [] },
  });
  return store;
}

const store = (): Store => (g.__careloop ??= seed());

export function resetStore(): void {
  g.__careloop = seed();
}

export function getSession(customerId: CustomerId): Session {
  const s = store();
  let session = s.sessions.get(customerId);
  if (!session) {
    session = {
      customerId,
      phase: "idle",
      analysisConsent: false,
      alertsOn: getCustomer(customerId).consents.alerts,
      sensitive: false,
      lockScreenBanner: false,
      messages: [],
      draftFields: [],
      llmHistory: [],
      saidCantPay: false,
      wantsHuman: false,
    };
    s.sessions.set(customerId, session);
  }
  return session;
}

export function addMessage(session: Session, message: Omit<ChatMessage, "id" | "at">): ChatMessage {
  const full: ChatMessage = { ...message, id: `m${store().nextId++}`, at: nowIso() };
  session.messages.push(full);
  return full;
}

export function audit(customerId: CustomerId, kind: AuditEntry["kind"], detail: string): void {
  store().audit.push({ at: nowIso(), customerId, kind, detail });
}

export const getAudit = (): AuditEntry[] => store().audit;
export const getCases = (): Case[] => store().cases;
export const getOpenCase = (customerId: CustomerId): Case | null =>
  store().cases.find((c) => c.customerId === customerId) ?? null;

export function createCase(input: Omit<Case, "id" | "createdAt" | "respondBy">): Case {
  const s = store();
  const created: Case = {
    ...input,
    id: `CL-${1001 + s.cases.length}`,
    createdAt: nowIso(),
    respondBy: addDays(DEMO_TODAY, 21),
  };
  s.cases = s.cases.filter((c) => c.customerId !== input.customerId).concat(created);
  audit(input.customerId, "case", `Case ${created.id} created, respond by ${created.respondBy}`);
  return created;
}

export const customerIds = (): CustomerId[] => allCustomers().map((c) => c.id);
