import { AsyncLocalStorage } from "node:async_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import { addDays, DEMO_TODAY, nowIso } from "../clock";
import type { AuditEntry, Case, ChatMessage, CustomerId, DraftField, NightlyReport, Phase } from "../contract";
import { allCustomers, getCustomer } from "../data";

// In-memory store for the demo: sessions, cases and the audit log.
// Everything else reads and writes through these functions, so this file is
// the only one to change if the data moves to a real database.
//
// Each visitor (one browser) gets their own copy, so two people trying the hosted demo
// never see or reset each other's chat. Memory only: a restart clears everything.

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
  /** What the customer asked for at a check-in. Shown to staff. */
  followUp: string | null;
}

interface Store {
  sessions: Map<CustomerId, Session>;
  cases: Case[];
  audit: AuditEntry[];
  nextId: number;
  /** The latest nightly report, if one has run. */
  report: NightlyReport | null;
}

/** One visitor's demo, plus how much AI they have used. Reset clears the demo, not the AI count. */
interface Slot {
  store: Store;
  lastUsed: number;
  aiCalls: number;
}

/** Requests with no visitor cookie (tests, scripts) share this one. */
const SHARED = "shared";
const MAX_VISITORS = 300;
const IDLE_MS = 6 * 60 * 60 * 1000;
/** AI replies one visitor may use, and all visitors together, before scripted replies take over. */
const AI_LIMIT = Number(process.env.CARELOOP_AI_LIMIT) || 40;
const AI_TOTAL_LIMIT = Number(process.env.CARELOOP_AI_TOTAL_LIMIT) || 1500;

// Kept on globalThis so the dev server's hot reload does not wipe the demo.
const g = globalThis as unknown as { __careloop?: Map<string, Slot>; __careloopAiTotal?: number };
const visitor = new AsyncLocalStorage<string>();

/** Run one request as a visitor: every store call inside reads and writes that visitor's copy. */
export const runAsVisitor = <T>(id: string, work: () => T): T => visitor.run(id, work);

function seed(): Store {
  const store: Store = { sessions: new Map(), cases: [], audit: [], nextId: 1, report: null };
  // Mia's personal loan repayment failed on 10 Nov, so her case is already with the Assist team.
  // Figures from the ML service (data/ml-results.json).
  store.cases.push({
    id: "CL-1001",
    customerId: "mia",
    customerName: getCustomer("mia").name,
    tier: 3,
    createdAt: "2026-11-10T09:00:00.000Z",
    respondBy: addDays("2026-11-10", 21),
    status: "in_review",
    summary: ["Last pay 30 Sep (final pay after her job ended)", "Personal loan repayment of $380 failed on 10 Nov", "Available money: $23 across her accounts"],
    draft: { fields: [], missing: [] },
  });
  return store;
}

function slot(): Slot {
  if (!(g.__careloop instanceof Map)) g.__careloop = new Map();
  const all = g.__careloop;
  const id = visitor.getStore() ?? SHARED;
  let mine = all.get(id);
  if (!mine) {
    // Make room: drop visitors who have been away for hours, then the longest idle one.
    const now = Date.now();
    for (const [key, other] of all) if (now - other.lastUsed > IDLE_MS) all.delete(key);
    if (all.size >= MAX_VISITORS) {
      const oldest = [...all].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) all.delete(oldest[0]);
    }
    mine = { store: seed(), lastUsed: now, aiCalls: 0 };
    all.set(id, mine);
  }
  mine.lastUsed = Date.now();
  return mine;
}

const store = (): Store => slot().store;

export function resetStore(): void {
  slot().store = seed();
}

/** Counts one AI reply for this visitor. False once this visitor, or the whole server, has used its share. */
export function takeAiCall(): boolean {
  const mine = slot();
  const total = g.__careloopAiTotal ?? 0;
  if (mine.aiCalls >= AI_LIMIT || total >= AI_TOTAL_LIMIT) return false;
  mine.aiCalls += 1;
  g.__careloopAiTotal = total + 1;
  return true;
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
      followUp: null,
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

export function audit(customerId: AuditEntry["customerId"], kind: AuditEntry["kind"], detail: string): void {
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

export const getReport = (): NightlyReport | null => store().report ?? null;
export function saveReport(report: NightlyReport): void {
  store().report = report;
}
