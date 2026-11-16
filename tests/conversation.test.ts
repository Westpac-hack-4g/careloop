import { beforeEach, describe, expect, it } from "vitest";
import { checkReply } from "@/lib/ai/safety";
import { getQueue, getSessionView, handleAction, handleMessage, recordDecision, sendAlert, sendCheckIn, startReview } from "@/lib/conversation/engine";
import { runTool } from "@/lib/conversation/tools";
import { getAudit, getSession, resetStore } from "@/lib/store";

// These run in sample mode (scripted assistant), so no paid API is called.

beforeEach(() => resetStore());

const cards = (id: "sarah" | "tom" | "mia") => getSessionView(id).messages.map((m) => m.card?.type).filter(Boolean);

describe("consent gate", () => {
  it("refuses data tools until the customer allows", () => {
    const session = getSession("sarah");
    session.phase = "prepare";
    const refused = runTool(session, "get_tier_result", {});
    expect(refused.isError).toBe(true);
    expect(getAudit().some((a) => a.kind === "tool_refused")).toBe(true);

    session.analysisConsent = true;
    expect(runTool(session, "get_tier_result", {}).isError).toBeUndefined();
  });

  it("refuses tools that do not belong to the current step", () => {
    const session = getSession("sarah");
    session.analysisConsent = true;
    session.phase = "explain";
    expect(runTool(session, "update_draft", { fields: [] }).isError).toBe(true);
  });

  it("sends no alert when the customer has alerts off", () => {
    handleAction("sarah", "toggle_alerts");
    expect(sendAlert("sarah").sent).toBe(false);
    expect(cards("sarah")).toEqual([]);
  });
});

describe("Sarah's demo path", () => {
  it("goes from the heads-up to a filed case with a 21 day deadline", async () => {
    expect(sendAlert("sarah").sent).toBe(true);
    expect(getSessionView("sarah").lockScreenBanner).toBe(true);

    handleAction("sarah", "show_why");
    await handleMessage("sarah", "Will asking for help hurt my credit score?");
    const answer = getSessionView("sarah").messages.at(-1)!;
    expect(answer.citations?.length).toBe(1);

    handleAction("sarah", "allow");
    handleAction("sarah", "prepare_request");
    await handleMessage("sarah", "My hospital cut my shifts from 5 days to 3 in October. They said until at least February.");
    await handleMessage("sarah", "Just a car loan, $320 a month.");
    await handleMessage("sarah", "No, just me.");
    await handleMessage("sarah", "Lower repayments for three months.");
    expect(getSessionView("sarah").phase).toBe("review");

    handleAction("sarah", "confirm_review");
    handleAction("sarah", "start_yes");
    expect(cards("sarah")).toEqual(["alert", "consent", "projection", "review", "start_request", "receipt"]);

    const row = getQueue()[0];
    expect(row.customerId).toBe("sarah");
    expect(row.respondBy).toBe("2026-12-07");
    expect(row.case?.draft.fields.find((f) => f.field === "what_changed.reason")).toMatchObject({
      value: "Reduced hours",
      source: "you_told_us",
    });
  });

  it("files nothing when the customer says not yet", async () => {
    await handleMessage("sarah", "I won't make the mortgage this month");
    expect(getSessionView("sarah").phase).toBe("start_request");
    handleAction("sarah", "start_not_yet");
    expect(getQueue().find((r) => r.customerId === "sarah")?.case).toBeNull();
    expect(getAudit().some((a) => a.kind === "cant_pay_logged")).toBe(true);
  });
});

describe("safety", () => {
  it("stops and hands over on a sensitive disclosure", async () => {
    await handleMessage("sarah", "My partner controls all the money");
    expect(getSessionView("sarah").phase).toBe("handover");
    expect(getQueue()[0]).toMatchObject({ customerId: "sarah", tier: 4, status: "priority_assist" });
  });

  it("blocks approval promises and invented amounts", () => {
    expect(checkReply("Don't worry, you will be approved.", "").ok).toBe(false);
    expect(checkReply("You may be $700 short.", "shortfall $620").ok).toBe(false);
    expect(checkReply("You may be $620 short.", "shortfall $620").ok).toBe(true);
  });
});

describe("reply filter", () => {
  it("lets the assistant say it cannot promise approval", () => {
    expect(checkReply("I can't promise it will be approved. A person at Westpac decides.", "").ok).toBe(true);
    expect(checkReply("Good news, you will be approved.", "").ok).toBe(false);
  });

  it("accepts amounts that tools returned as plain numbers and blocks invented ones", () => {
    const trusted = JSON.stringify({ shortfall: { amount: 620 }, repayment: 2850 });
    expect(checkReply("You'd be about $620 short of the $2,850 repayment.", trusted).ok).toBe(true);
    expect(checkReply("You'd be about $700 short.", trusted).ok).toBe(false);
  });
});

describe("staff review", () => {
  it("moves a new request to In review and tells the customer", async () => {
    expect(startReview("sarah")).toBe(false); // Nothing filed yet.
    await handleMessage("sarah", "I can't pay this month");
    handleAction("sarah", "start_yes");
    expect(startReview("sarah")).toBe(true);
    expect(getQueue().find((r) => r.customerId === "sarah")?.status).toBe("in_review");
    expect(getSessionView("sarah").messages.at(-1)?.text).toContain("started looking at your request");
  });
});

describe("closing the loop", () => {
  const file = async () => {
    await handleMessage("sarah", "I can't pay this month");
    handleAction("sarah", "start_yes");
    startReview("sarah");
  };

  it("sends no check-in before a person has decided", async () => {
    await file();
    expect(sendCheckIn("sarah", true).sent).toBe(false);
  });

  it("passes on the staff decision and books the check-in 28 days later", async () => {
    await file();
    expect(recordDecision("sarah", "lower_repayments")).toBe(true);
    const row = getQueue().find((r) => r.customerId === "sarah");
    expect(row?.status).toBe("arrangement");
    expect(row?.case?.decision?.reviewOn).toBe("2026-12-14");
    expect(cards("sarah").at(-1)).toBe("decision");
    expect(recordDecision("sarah", "pause")).toBe(false); // Already decided.
  });

  it("asks at the check-in and leaves the change to a person", async () => {
    await file();
    recordDecision("sarah", "lower_repayments");
    expect(sendCheckIn("sarah", true).sent).toBe(true);
    const card = getSessionView("sarah").messages.at(-1)?.card;
    expect(card).toMatchObject({ type: "check_in", recovered: true, payNow: 2600 });
    handleAction("sarah", "checkin_return");
    const row = getQueue().find((r) => r.customerId === "sarah");
    expect(row?.note).toBe("Wants to go back to normal repayments");
    expect(row?.status).toBe("arrangement"); // Nothing changes until staff act.
  });
});

describe("answering the heads-up in words", () => {
  it("gives Tom a heads-up card with buttons, shown on the home screen", () => {
    expect(sendAlert("tom").sent).toBe(true);
    expect(cards("tom")).toEqual(["alert"]);
    expect(getSessionView("tom").home.headsUp).toBe(true);
  });

  it("closes the chat on a typed no, without pushing, and still answers if they write again", async () => {
    sendAlert("tom");
    await handleMessage("tom", "no");
    const view = getSessionView("tom");
    expect(view.phase).toBe("idle");
    expect(view.messages.at(-1)?.card?.type).toBe("closed");
    expect(view.home.headsUp).toBe(false);
    await handleMessage("tom", "Will asking for help hurt my credit score?");
    expect(getSessionView("tom").messages.at(-1)?.role).toBe("careloop");
  });

  it("treats a typed 'show me the reason' as the Show me why button", async () => {
    sendAlert("tom");
    await handleMessage("tom", "show me the reason");
    expect(getSessionView("tom").phase).toBe("consent");
    expect(cards("tom").at(-1)).toBe("consent");
  });

  it("does not take a typed yes as permission to read accounts", async () => {
    sendAlert("tom");
    handleAction("tom", "show_why");
    await handleMessage("tom", "yes");
    expect(getSession("tom").analysisConsent).toBe(false);
  });
});
