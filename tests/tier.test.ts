import { describe, expect, it } from "vitest";
import { getCustomer } from "@/lib/data";
import { getTierResult } from "@/lib/tier";

// Every figure here comes from the ML service (data/ml-results.json), as of 16 Nov 2026.
// They match resource/CareLoop_Tier_Decisions.xlsx and the ML explainer.

describe("tiers from the ML service", () => {
  it("puts Tom in tier 1 on three warning signals, with no shortfall", () => {
    const tom = getTierResult("tom");
    expect(tom.tier).toBe(1);
    expect(tom.projection.shortfall).toBeNull();
    expect(tom.signals.warningSignals).toEqual(["LOW_BUFFER", "NEGATIVE_CASHFLOW", "BALANCE_DECLINE"]);
    expect(tom.signals.bufferDays).toBe(7.8);
  });

  it("puts Sarah in tier 2, $620 short on 28 Nov ($947 in the stress case)", () => {
    const sarah = getTierResult("sarah");
    expect(sarah.tier).toBe(2);
    expect(sarah.projection.shortfall).toEqual({ amount: 620, date: "2026-11-28" });
    expect(sarah.projection.stressShortfall).toBe(947.16);
    expect(sarah.signals.incomeChange).toBe(-0.2226);
    expect(sarah.signals.bufferDays).toBe(5.08);
    expect(sarah.mayContact).toBe(true);
  });

  it("walks Sarah's balance day by day from $420 to -$620", () => {
    const { points } = getTierResult("sarah").projection;
    expect(points).toHaveLength(15);
    expect(points[0]).toEqual({ date: "2026-11-16", balance: 420 });
    const withEvents = points.filter((p) => p.event).map((p) => [p.date, p.event, p.balance]);
    expect(withEvents).toEqual([
      ["2026-11-18", "Home & contents insurance", 260],
      ["2026-11-20", "Pay", 1160],
      ["2026-11-21", "Strata levy", 1050],
      ["2026-11-24", "Electricity & water", 820],
      ["2026-11-25", "Car registration renewal", 380],
      ["2026-11-28", "Home loan repayment", -620],
    ]);
    expect(getCustomer("sarah")).toMatchObject({ balance: 420, products: [{ name: "Home loan", repayment: 1000 }] });
  });

  it("puts Mia in tier 3 after a failed repayment", () => {
    const mia = getTierResult("mia");
    expect(mia.tier).toBe(3);
    expect(mia.signals.missedRepayment).toBe(true);
    expect(mia.reasons[0]).toBe("Personal loan repayment of $380 failed on 10 Nov");
  });

  it("keeps Sarah in tier 2 but sends no alert when alerts are off", () => {
    const sarah = getTierResult("sarah", { alertsOn: false });
    expect(sarah.tier).toBe(2);
    expect(sarah.mayContact).toBe(false);
  });

  it("keeps the tier on a sensitive disclosure, hands over and pauses alerts", () => {
    const sarah = getTierResult("sarah", { sensitive: true });
    expect(sarah.tier).toBe(2);
    expect(sarah.nextAction).toBe("specialist_handover");
    expect(sarah.mayContact).toBe(false);
  });
});

describe("how CareLoop noticed", () => {
  it("dates Sarah's pay drop, the heads-up and the repayment", () => {
    const { timeline } = getTierResult("sarah");
    expect(timeline).toEqual([
      { date: "2026-10-23", label: "Pay dropped from $1,196 to $900", when: "past" },
      { date: "2026-11-16", label: "Early heads-up, 12 days before the repayment", when: "today" },
      { date: "2026-11-28", label: "Repayment due: projected $620 short", when: "ahead" },
    ]);
  });

  it("dates Mia's last pay and failed repayment", () => {
    const labels = getTierResult("mia").timeline.map((t) => `${t.date} ${t.label}`);
    expect(labels[0]).toBe("2026-09-30 Last pay received ($2,050)");
    expect(labels[1]).toBe("2026-11-10 Personal loan repayment of $380 failed");
  });
});
