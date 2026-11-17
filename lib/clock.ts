// The demo runs on a fixed "today" so the numbers on stage never drift.
// Set CARELOOP_TODAY to move it.
export const DEMO_TODAY = process.env.CARELOOP_TODAY || "2026-11-16";

/** Timestamp for stored records: the demo date with the real time of day. */
export function nowIso(): string {
  return `${DEMO_TODAY}T${new Date().toISOString().slice(11)}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next weekday after `date` (Saturdays and Sundays skipped; public holidays are not modelled). */
export function nextBusinessDay(date: string): string {
  let next = addDays(date, 1);
  while ([0, 6].includes(new Date(`${next}T00:00:00Z`).getUTCDay())) next = addDays(next, 1);
  return next;
}

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function formatDate(date: string, withYear = false): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export const formatMoney = (amount: number): string =>
  `${amount < 0 ? "-" : ""}$${Math.abs(Math.round(amount)).toLocaleString("en-AU")}`;
