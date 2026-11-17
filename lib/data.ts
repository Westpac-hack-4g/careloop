import { readFileSync } from "node:fs";
import path from "node:path";
import type { Customer, CustomerId, Product, Schedule } from "./contract";

// Sample data only. Every figure comes from the ML service (in `ml/`), exported
// to data/ml-results.json by scripts/export-ml-results.py. In a real build this module is
// the one place that would ask the Risk Tracking service instead of reading a file.

/** One customer's record in data/ml-results.json. The `analysis` block is the ML service's AnalysisResponse. */
export interface MlRecord {
  story: string;
  profile_type: string;
  accounts: { account_id: string; account_type: string; balance_aud: number }[];
  pays: { date: string; amount: number }[];
  repayments: { date: string; amount: number; description: string; category: string; status: "posted" | "failed" }[];
  upcoming: { due_date: string; description: string; event_type: string; amount_aud: number; amount_status: string }[];
  analysis: {
    financial_tier: number | null;
    tier_label: string;
    rule_applied: string | null;
    reason_codes: string[];
    warning_signals: string[];
    features: Record<string, number | boolean | null>;
    forecast: {
      horizon_days: number;
      start_balance_aud: number;
      shortfall_amount_aud: number;
      shortfall_date: string | null;
      daily_balances: { date: string; balance: number }[];
      events: { date: string; description: string; event_type: string; amount_aud: number; balance_after_aud: number }[];
      conservative: { shortfall_amount_aud: number };
      confidence: "high" | "medium" | "low";
    };
    ml_experiment: {
      model_status: string;
      predicted_probability: number | null;
      above_threshold: boolean | null;
      top_contributions: { feature: string; contribution: number }[];
    };
  };
}

interface MlResults {
  source: string;
  as_of_date: string;
  forecast_days: number;
  customers: Record<string, MlRecord>;
}

/** The app's three demo customers and the names shown on screen. */
const DEMO_CUSTOMERS: { id: CustomerId; name: string }[] = [
  { id: "tom", name: "Tom R." },
  { id: "sarah", name: "Sarah K." },
  { id: "mia", name: "Mia L." },
];

/** "Home loan repayment" -> the product it belongs to. */
const PRODUCTS: { match: RegExp; type: Product["type"]; name: string }[] = [
  { match: /^home loan/i, type: "home_loan", name: "Home loan" },
  { match: /^car loan/i, type: "car_loan", name: "Car loan" },
  { match: /^personal loan/i, type: "personal_loan", name: "Personal loan" },
  { match: /^credit card/i, type: "credit_card", name: "Credit card" },
];
const productOf = (description: string) => PRODUCTS.find((p) => p.match.test(description));
const isRepayment = (eventType: string) => eventType === "loan_repayment" || eventType === "card_repayment";

let cache: { results: MlResults; customers: Customer[]; schedules: Schedule[] } | null = null;

function load() {
  if (cache) return cache;
  const results = JSON.parse(readFileSync(path.join(process.cwd(), "data", "ml-results.json"), "utf8")) as MlResults;
  const customers: Customer[] = [];
  const schedules: Schedule[] = [];
  for (const { id, name } of DEMO_CUSTOMERS) {
    const record = results.customers[id];
    if (!record) throw new Error(`data/ml-results.json has no record for ${id}`);
    const everyday = record.accounts.find((a) => a.account_type === "everyday");

    // Products: every loan or card the customer repays, with its latest repayment amount.
    const products = new Map<string, Product>();
    for (const r of [...record.repayments.map((p) => ({ d: p.description, a: p.amount })), ...record.upcoming.filter((u) => isRepayment(u.event_type)).map((u) => ({ d: u.description, a: u.amount_aud }))]) {
      const product = productOf(r.d);
      if (product) products.set(product.name, { type: product.type, name: product.name, repayment: r.a });
    }

    // Loans first, in PRODUCTS order: the home screen flags the first one.
    const order = (p: Product) => PRODUCTS.findIndex((x) => x.type === p.type);
    const sorted = [...products.values()].sort((a, b) => order(a) - order(b));
    customers.push({ id, name, balance: everyday?.balance_aud ?? 0, products: sorted, consents: { alerts: true } });
    schedules.push({
      customerId: id,
      upcomingPays: record.analysis.forecast.events
        .filter((e) => e.event_type === "income")
        .map((e) => ({ date: e.date, amount: e.amount_aud })),
      upcomingRepayments: record.upcoming
        .filter((u) => isRepayment(u.event_type))
        .map((u) => ({ date: u.due_date, amount: u.amount_aud, product: productOf(u.description)?.name ?? u.description })),
      pastRepayments: record.repayments.map((r) => ({
        date: r.date,
        amount: r.amount,
        product: productOf(r.description)?.name ?? r.description,
        status: r.status === "failed" ? "failed" : "paid",
      })),
    });
  }
  cache = { results, customers, schedules };
  return cache;
}

export const allCustomers = (): Customer[] => load().customers;

export function getCustomer(id: CustomerId): Customer {
  const customer = load().customers.find((c) => c.id === id);
  if (!customer) throw new Error(`Unknown customer: ${id}`);
  return customer;
}

export function getSchedule(id: CustomerId): Schedule {
  const schedule = load().schedules.find((s) => s.customerId === id);
  if (!schedule) throw new Error(`No schedule for: ${id}`);
  return schedule;
}

/** The ML service's full result for one customer. */
export const getMlRecord = (id: CustomerId): MlRecord => load().results.customers[id];

/** The date the ML results were worked out for. */
export const mlAsOfDate = (): string => load().results.as_of_date;

export const isCustomerId = (value: unknown): value is CustomerId =>
  value === "tom" || value === "sarah" || value === "mia";
