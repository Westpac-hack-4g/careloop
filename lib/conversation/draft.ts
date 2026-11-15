import { formatDate, formatMoney } from "../clock";
import type { CustomerId, DraftField, DraftRequest } from "../contract";
import { getCustomer, getSchedule } from "../data";
import { getTierResult } from "../tier";

// The hardship request form. Bank data fills what the bank already knows;
// the customer only adds what the bank cannot see.

/** Fields only the customer can give. All are needed before review. */
export const CUSTOMER_FIELDS = [
  { field: "what_changed.reason", label: "What changed" },
  { field: "what_changed.since", label: "Since when" },
  { field: "what_changed.expected_duration", label: "How long it may last" },
  { field: "other_debts", label: "Loans or cards with other lenders" },
  { field: "household.joint_borrower", label: "Anyone else on the loan" },
  { field: "help.preference", label: "What would help most" },
] as const;

export type CustomerFieldName = (typeof CUSTOMER_FIELDS)[number]["field"];
export const CUSTOMER_FIELD_NAMES = CUSTOMER_FIELDS.map((f) => f.field) as CustomerFieldName[];

/** Everything Westpac already knows, tagged "From your accounts". Needs the analysis consent. */
export function prefillFromAccounts(customerId: CustomerId): DraftField[] {
  const customer = getCustomer(customerId);
  const schedule = getSchedule(customerId);
  const tier = getTierResult(customerId);
  const repayment = schedule.upcomingRepayments[0];
  const pay = schedule.upcomingPays[0];
  const fromAccounts = (field: string, label: string, value: string): DraftField => ({
    field,
    label,
    value,
    source: "from_your_accounts",
  });
  const fields: DraftField[] = [fromAccounts("accounts.balance", "Everyday account balance", formatMoney(customer.balance))];
  if (repayment) {
    fields.push(
      fromAccounts("accounts.repayment", `${repayment.product} repayment`, `${formatMoney(repayment.amount)}, due ${formatDate(repayment.date)}`),
    );
  }
  fields.push(fromAccounts("income.current_pay", "Regular pay now", pay ? `${formatMoney(pay.amount)} a fortnight` : "No regular pay"));
  if (tier.signals.incomeChange !== null && tier.signals.incomeChange < 0) {
    fields.push(fromAccounts("income.change", "Change in pay", `Down ${Math.round(-tier.signals.incomeChange * 100)}% in the last 4 weeks`));
  }
  if (tier.projection.shortfall) {
    fields.push(
      fromAccounts(
        "projection.shortfall",
        "Projected shortfall",
        `${formatMoney(tier.projection.shortfall.amount)} on ${formatDate(tier.projection.shortfall.date)}`,
      ),
    );
  }
  return fields;
}

export function toDraft(fields: DraftField[]): DraftRequest {
  const filled = new Set(fields.map((f) => f.field));
  return { fields, missing: CUSTOMER_FIELDS.filter((f) => !filled.has(f.field)).map((f) => ({ ...f })) };
}

/** Add or replace a "You told us" field. Code checks it; the AI only proposes it. */
export function applyCustomerField(
  fields: DraftField[],
  input: { field: string; value: string; evidence: string },
): { ok: true; fields: DraftField[] } | { ok: false; error: string } {
  const known = CUSTOMER_FIELDS.find((f) => f.field === input.field);
  if (!known) return { ok: false, error: `Unknown field "${input.field}". Use one of: ${CUSTOMER_FIELD_NAMES.join(", ")}` };
  if (!input.value.trim()) return { ok: false, error: "Value is empty" };
  if (!input.evidence.trim()) return { ok: false, error: "Evidence (the customer's own words) is required" };
  const next: DraftField = {
    field: known.field,
    label: known.label,
    value: input.value.trim(),
    source: "you_told_us",
    evidence: input.evidence.trim(),
  };
  return { ok: true, fields: fields.filter((f) => f.field !== known.field).concat(next) };
}
