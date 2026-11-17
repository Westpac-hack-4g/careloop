// The shared data contract. Every part of the app (tier engine, conversation,
// AI, phone screens, staff console) talks in these shapes. Change it here first.

export type CustomerId = "tom" | "sarah" | "mia";

export interface Customer {
  id: CustomerId;
  name: string;
  /** Everyday account balance today. */
  balance: number;
  products: Product[];
  consents: {
    /** Level 2: the opt-in early heads-up (nightly check of their own accounts). */
    alerts: boolean;
  };
}

export interface Product {
  type: "home_loan" | "car_loan" | "personal_loan" | "credit_card";
  name: string; // "Home loan"
  repayment: number;
}

export interface Schedule {
  customerId: CustomerId;
  upcomingPays: { date: string; amount: number }[];
  upcomingRepayments: { date: string; amount: number; product: string }[];
  pastRepayments: { date: string; amount: number; product: string; status: "paid" | "failed" }[];
}

/** The financial tier from the ML service's rules (tiers.py). A specialist need is a separate flag, not a tier. */
export type Tier = 0 | 1 | 2 | 3;

/** What the ML service measured. The app shows these; it never recomputes them. */
export interface Signals {
  incomeChange: number | null; // -0.22 = income 22% below the customer's own usual level
  /** The latest regular pay, and the usual pay before it dropped. */
  recentPay: number | null;
  earlierPay: number | null;
  /** Days of essential costs the available money covers. */
  bufferDays: number | null;
  netCashFlow30d: number | null;
  missedRepayment: boolean;
  /** Early-warning signal codes, e.g. LOW_BUFFER, INCOME_DROP. */
  warningSignals: string[];
  sensitive: boolean;
}

export interface ProjectionPoint {
  date: string;
  balance: number;
  event?: string; // "Pay", "Home loan repayment"
}

export interface Projection {
  /** The base-case 14-day forecast from the ML service, one point per day. */
  points: ProjectionPoint[];
  /** The first loan or card repayment the balance can't cover, if any. */
  shortfall: { amount: number; date: string } | null;
  /** The shortfall in the conservative (stress) case: lower pay, higher bills, everyday spending. */
  stressShortfall: number;
  confidence: "high" | "medium" | "low";
  assumptions: string[];
}

/** One dated fact on the "how CareLoop noticed" timeline. */
export interface TimelineItem {
  date: string;
  label: string;
  when: "past" | "today" | "ahead";
}

export interface TierResult {
  customerId: CustomerId;
  tier: Tier;
  tierName: string;
  reasons: string[];
  signals: Signals;
  projection: Projection;
  timeline: TimelineItem[];
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
  | "check_in"
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
  /** The heads-up. With a projected shortfall it shows the amount; otherwise it shows `text`. */
  | { type: "alert"; shortfall?: number; date?: string; text?: string }
  /** The customer said "not now": this chat is over until they write again. */
  | { type: "closed" }
  | { type: "consent" }
  | { type: "projection"; projection: Projection }
  | { type: "draft"; draft: DraftRequest }
  | { type: "review"; draft: DraftRequest }
  | { type: "start_request" }
  | { type: "receipt"; caseId: string; respondBy: string }
  | { type: "decision"; outcome: string; approved: boolean; reviewOn: string }
  | { type: "check_in"; recovered: boolean; payNow: number; outcome: string }
  | { type: "handover" };

export interface ChatMessage {
  id: string;
  role: "customer" | "careloop" | "staff";
  text?: string;
  citations?: Citation[];
  card?: Card;
  at: string;
}

export type CaseStatus = "new" | "in_review" | "arrangement" | "closed" | "watching" | "priority_assist";

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
  /** Recorded by a staff member. CareLoop never decides. */
  decision?: { outcome: string; approved: boolean; reviewOn: string };
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
  /** The app's home screen: what the customer sees before opening the chat. */
  home: { balance: number; tiles: { name: string; detail: string }[]; headsUp: boolean };
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
  timeline: TimelineItem[];
}
