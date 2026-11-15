import { describe, expect, it } from "vitest";
import { getTierResult } from "@/lib/tier";

describe("tier engine on the sample customers", () => {
  it("puts Tom in tier 1 with no shortfall", () => {
    const tom = getTierResult("tom");
    expect(tom.tier).toBe(1);
    expect(tom.projection.shortfall).toBeNull();
    expect(tom.signals.bufferTrend).toBe(-0.2);
    expect(tom.signals.netFlowNegativeMonths).toBe(3);
    expect(tom.signals.cardUse).toBe(0.72);
  });

  it("puts Sarah in tier 2, $620 short on 28 Nov", () => {
    const sarah = getTierResult("sarah");
    expect(sarah.tier).toBe(2);
    expect(sarah.projection.shortfall).toEqual({ amount: 620, date: "2026-11-28" });
    expect(sarah.signals.incomeChange).toBe(-0.4);
    expect(sarah.mayContact).toBe(true);
  });

  it("puts Mia in tier 3 after a missed repayment", () => {
    const mia = getTierResult("mia");
    expect(mia.tier).toBe(3);
    expect(mia.signals.missedRepayment).toBe(true);
  });

  it("keeps Sarah in tier 2 but sends no alert when alerts are off", () => {
    const sarah = getTierResult("sarah", { alertsOn: false });
    expect(sarah.tier).toBe(2);
    expect(sarah.mayContact).toBe(false);
  });

  it("moves anyone to tier 4 on a sensitive disclosure", () => {
    expect(getTierResult("sarah", { sensitive: true }).tier).toBe(4);
  });
});

describe("how CareLoop noticed", () => {
  it("dates Sarah's pay drop, the heads-up and the repayment", () => {
    const { timeline } = getTierResult("sarah");
    expect(timeline).toEqual([
      { date: "2026-10-23", label: "Pay dropped from $2,600 to $1,560", when: "past" },
      { date: "2026-11-16", label: "Early heads-up, 12 days before the repayment", when: "today" },
      { date: "2026-11-28", label: "Repayment due: projected $620 short", when: "ahead" },
    ]);
  });

  it("dates Mia's last pay and failed repayment", () => {
    const labels = getTierResult("mia").timeline.map((t) => `${t.date} ${t.label}`);
    expect(labels[0]).toBe("2026-10-17 Last pay received ($1,900)");
    expect(labels[1]).toContain("2026-11-05");
  });
});
