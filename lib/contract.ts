// The shared data contract. Every part of the app (tier engine, conversation,
// AI, phone screens, staff console) talks in these shapes. Change it here first.

export type CustomerId = "tom" | "sarah" | "mia";

export interface Customer {
  id: CustomerId;
  name: string;
  /** Everyday account balance today and 90 days ago. */
  balance: number;
  balance90DaysAgo: number;
  products: Product[];
  consents: {
    /** Level 2: the opt-in early heads-up (nightly check of their own accounts). */
    alerts: boolean;
  };
}

export type Product =
  | { type: "home_loan" | "personal_loan"; name: string; repayment: number }
  | { type: "credit_card"; name: string; limit: number; balance: number; balance90DaysAgo: number };

export interface Transaction {
  customerId: CustomerId;
  date: string; // YYYY-MM-DD
  amount: number; // positive = money in, negative = money out
  merchant: string;
  category: string;
  essential: boolean;
}

export interface Schedule {
  customerId: CustomerId;
  upcomingPays: { date: string; amount: number }[];
  upcomingRepayments: { date: string; amount: number; product: string }[];
  pastRepayments: { date: string; amount: number; product: string; status: "paid" | "failed" }[];
}

export type Tier = 0 | 1 | 2 | 3 | 4;

export interface Signals {
  incomeChange: number | null; // -0.4 = pay down 40%
  bufferTrend: number; // balance today / balance 90 days ago - 1
  netFlowNegativeMonths: number; // months in a row, most recent first
  cardUse: number | null; // 0..1
  cardUseRising: boolean;
  missedRepayment: boolean;
  sensitive: boolean;
}

export interface ProjectionPoint {
  date: string;
  balance: number;
  event?: string; // "Pay", "Home loan repayment"
}

export interface Projection {
  points: ProjectionPoint[];
  /** The first repayment that takes the balance below zero, if any. */
  shortfall: { amount: number; date: string } | null;
  assumptions: string[];
}

export interface TierResult {
  customerId: CustomerId;
  tier: Tier;
  tierName: string;
  reasons: string[];
  signals: Signals;
  projection: Projection;
  nextAction: "none" | "nudge" | "heads_up" | "missed_payment_help" | "specialist_handover";
  /** Whether a proactive message may be sent (needs the alerts consent). */
  mayContact: boolean;
}

export type Phase =
  | "idle"
  | "alert"
  | "explain"
  | "consent"
  | "projection"
  | "prepare"
  | "review"
  | "start_request"
  | "receipt"
  | "handover";

export type FieldSource = "from_your_accounts" | "you_told_us";

export interface DraftField {
  field: string; // "what_changed.reason"
  label: string;
  value: string;
  source: FieldSource;
  /** The customer's own words, when the source is "you_told_us". */
  evidence?: string;
}

export interface DraftRequest {
  fields: DraftField[];
  missing: { field: string; label: string }[];
}

export interface Citation {
  n: number;
  title: string;
  url: string;
}

export type Card =
  | { type: "alert"; shortfall: number; date: string }
  | { type: "consent" }
  | { type: "projection"; projection: Projection }
  | { type: "draft"; draft: DraftRequest }
  | { type: "review"; draft: DraftRequest }
  | { type: "start_request" }
  | { type: "receipt"; caseId: string; respondBy: string }
  | { type: "handover" };

export interface ChatMessage {
  id: string;
  role: "customer" | "careloop" | "staff";
  text?: string;
  citations?: Citation[];
  card?: Card;
  at: string;
}

export type CaseStatus = "new" | "in_review" | "watching" | "priority_assist";

export interface Case {
  id: string;
  customerId: CustomerId;
  customerName: string;
  tier: Tier;
  createdAt: string;
  /** createdAt + 21 days: the deadline to respond to a hardship request. */
  respondBy: string;
  status: CaseStatus;
  summary: string[];
  draft: DraftRequest;
}

export interface AuditEntry {
  at: string;
  customerId: CustomerId;
  kind: "consent" | "tool_call" | "tool_refused" | "message" | "case" | "safety" | "cant_pay_logged";
  detail: string;
}

/** What the phone screen polls for. */
export interface SessionView {
  customerId: CustomerId;
  customerName: string;
  phase: Phase;
  messages: ChatMessage[];
  lockScreenBanner: boolean;
  alertsOn: boolean;
}

/** One row of the staff queue. */
export interface QueueRow {
  customerId: CustomerId;
  customerName: string;
  tier: Tier;
  respondBy: string | null;
  status: CaseStatus;
  case: Case | null;
  /** Short flag for staff, for example "Asked to talk to someone". */
  note?: string;
  reasons: string[];
}
