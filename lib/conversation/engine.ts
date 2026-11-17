import { assistantReply } from "../ai/assistant";
import { addDays, DEMO_TODAY, formatDate, formatMoney, nextBusinessDay } from "../clock";
import type { Case, CustomerId, QueueRow, SessionView } from "../contract";
import { getCustomer, getMlRecord, getSchedule } from "../data";
import { CHECK_IN_DAYS, DECISIONS, type DecisionKey } from "../decisions";
import { addMessage, audit, createCase, customerIds, getOpenCase, getSession, type Session } from "../store";
import { getTierResult } from "../tier";
import { TIER_CONFIG } from "../tier/config";
import { mlOpinion } from "../tier/ml";
import { isSensitive, saysCantPay } from "./detectors";
import { toDraft } from "./draft";
import { handover } from "./handover";
import { MONEY_CHECK } from "./money-check";
import { upsertDraftCard } from "./tools";

// The conversation engine. It owns the step (phase) the conversation is at.
// Button taps are handled here in plain code; only free text goes to the AI.

export type Action =
  | "open_app"
  | "show_why"
  | "talk_to_someone"
  | "request_callback"
  | "not_now"
  | "not_right"
  | "allow"
  | "decline_consent"
  | "prepare_request"
  | "confirm_review"
  | "start_yes"
  | "start_not_yet"
  | "start_talk"
  | "checkin_return"
  | "checkin_extend"
  | "checkin_keep"
  | "toggle_alerts";

const say = (session: Session, text: string) => addMessage(session, { role: "careloop", text });

/** Tell the LLM what happened outside the chat, so its picture of the conversation stays right. */
const note = (session: Session, text: string) => session.llmHistory.push({ role: "user", content: `<event>${text}</event>` });

/** Presenter bar: send the early heads-up. Refused when the customer has alerts off. */
export function sendAlert(customerId: CustomerId): { sent: boolean; reason?: string } {
  const session = getSession(customerId);
  const tier = getTierResult(customerId, { alertsOn: session.alertsOn });
  if (!tier.mayContact) {
    const reason = tier.tier === 0 ? "Tier 0: nothing to tell the customer" : "Alerts are off for this customer, so no message is sent";
    audit(customerId, "consent", `Alert not sent: ${reason}`);
    return { sent: false, reason };
  }
  session.lockScreenBanner = true;
  session.phase = "alert";
  // Tier 2 leads with the projected shortfall. Tier 3 leads with the missed repayment, even if a gap is also ahead.
  const shortfall = tier.tier === 2 ? tier.projection.shortfall : null;
  // Every heads-up is a card with the same four buttons.
  const text =
    tier.tier === 3
      ? "A repayment didn't go through. If things are tight, I can help you look at your options. No pressure."
      : "Your everyday balance has been getting lower over the last few months. Would you like to see why?";
  // Tier 3 offers a call back first: a kind same-day message, and a person by the next business day.
  addMessage(session, {
    role: "careloop",
    card: shortfall ? { type: "alert", shortfall: shortfall.amount, date: shortfall.date } : { type: "alert", text, ...(tier.tier === 3 ? { callback: true } : {}) },
  });
  note(session, `The backend sent the customer a heads-up card: "${shortfall ? "You may be short before your next repayment." : text}" It has these buttons: ${tier.tier === 3 ? "Ask for a call back, Show me why, Not now" : "Show me why, Talk to someone, Not now, This isn't right"}.`);
  audit(customerId, "message", `Heads-up sent (tier ${tier.tier})`);
  return { sent: true };
}

/** A short summary for staff. Facts from the rule engine and the customer's own answers, each from its source. */
function buildSummary(session: Session): string[] {
  const told = (field: string) => session.draftFields.find((f) => f.field === field)?.value;
  const lines = session.analysisConsent ? [...getTierResult(session.customerId).reasons] : [];
  const reason = told("what_changed.reason");
  if (reason) lines.unshift([reason, told("what_changed.since") && `since ${told("what_changed.since")}`, told("what_changed.expected_duration")].filter(Boolean).join(", "));
  if (told("other_debts")) lines.push(`Other lenders: ${told("other_debts")}`);
  if (told("household.joint_borrower")) lines.push(`Joint borrower: ${told("household.joint_borrower")}`);
  if (told("help.preference")) lines.push(`Asks for: ${told("help.preference")}`);
  if (!lines.length) lines.push("The customer said they cannot make a repayment. No details given yet.");
  return lines;
}

function offerStartRequest(session: Session): void {
  if (session.phase === "start_request") return;
  session.phase = "start_request";
  addMessage(session, { role: "careloop", card: { type: "start_request" } });
}

const SAYS_NO = /^(no|nope|nah|not now|not yet|no thanks?|no thank you|later|maybe later)[\s.!]*$/i;
const SAYS_YES = /^(yes|yep|yeah|ok|okay|sure|please|go on|yes please)[\s.!]*$/i;
const ASKS_WHY = /^(why|how come|show me( why| the reason)?|what('s| is) the reason|tell me why)[\s.!?]*$/i;

/** Which button a short typed reply stands for, if any. Giving permission still needs the Allow tap. */
function typedButton(session: Session, text: string): Action | null {
  if (session.phase === "alert") {
    if (SAYS_NO.test(text)) return "not_now";
    if (SAYS_YES.test(text) || ASKS_WHY.test(text)) return "show_why";
  }
  if (session.phase === "consent" && SAYS_NO.test(text)) return "decline_consent";
  if (session.phase === "start_request" && SAYS_NO.test(text)) return "start_not_yet";
  return null;
}

export async function handleMessage(customerId: CustomerId, text: string): Promise<void> {
  const session = getSession(customerId);
  session.lockScreenBanner = false;
  addMessage(session, { role: "customer", text });
  audit(customerId, "message", `Customer: ${text}`);
  if (session.phase === "handover") return; // A person takes it from here.

  // Two shortcuts that work at any step.
  if (isSensitive(text)) return handover(session, "keyword check");
  if (saysCantPay(text) && !["start_request", "receipt"].includes(session.phase)) {
    session.saidCantPay = true;
    audit(customerId, "cant_pay_logged", `"${text}"`);
    note(session, `The customer said: "${text}". The backend showed the "Start a request?" card.`);
    say(session, "Thank you for telling me. That can't have been easy to write. Nothing is sent unless you say so.");
    return offerStartRequest(session);
  }

  // A typed answer to a card counts as the matching button, so a plain "no" never confuses the AI.
  const typed = typedButton(session, text);
  if (typed) return handleAction(customerId, typed);

  if (session.phase === "idle" || session.phase === "alert") session.phase = "explain";
  const seen = new Set(session.messages.map((m) => m.id));
  const reply = await assistantReply(session, text);
  if (!reply.text) return; // The assistant handed over to a person; the card says it all.
  const message = addMessage(session, { role: "careloop", text: reply.text, citations: reply.citations });
  // A card the assistant showed during this turn goes under its words, not above them.
  const firstNew = session.messages.findIndex((m) => !seen.has(m.id));
  if (session.messages[firstNew] !== message) {
    session.messages = session.messages.filter((m) => m !== message);
    session.messages.splice(firstNew, 0, message);
  }
}

export function handleAction(customerId: CustomerId, action: Action): void {
  const session = getSession(customerId);
  session.lockScreenBanner = false;
  if (action !== "open_app") audit(customerId, "message", `Customer tapped: ${action}`);

  switch (action) {
    case "open_app":
      return;
    case "toggle_alerts":
      session.alertsOn = !session.alertsOn;
      audit(customerId, "consent", `Early heads-up turned ${session.alertsOn ? "on" : "off"}`);
      return;
    case "show_why": {
      session.phase = "consent";
      const seen = getTierResult(customerId, { alertsOn: session.alertsOn });
      const what = seen.signals.missedRepayment
        ? "A repayment didn't go through"
        : seen.signals.incomeChange !== null && seen.signals.incomeChange < 0
          ? "Your pay looks a little different lately"
          : "Your everyday balance has been going down";
      say(session, `${what}, so I wanted to give you an early heads-up rather than a surprise. I can show you exactly why, if that's OK.`);
      addMessage(session, { role: "careloop", card: { type: "consent" } });
      note(session, "The customer tapped Show me why. The backend showed the consent card.");
      return;
    }
    case "not_now":
      // No pushing: one line, then the chat is closed. The door stays open if they write again.
      session.phase = "idle";
      say(session, "No problem. If you want help later, just message me here.");
      addMessage(session, { role: "careloop", card: { type: "closed" } });
      note(session, "The customer said not now. The backend closed the chat. Do not bring the heads-up up again unless they ask.");
      return;
    case "not_right":
      say(session, "Thanks for telling me. What looks wrong? For example, if you're expecting other money to come in, tell me and the Westpac team will see your note.");
      note(session, "The customer tapped This isn't right.");
      return;
    case "decline_consent":
      session.phase = "explain";
      audit(customerId, "consent", "Analysis consent declined");
      say(session, "That's fine. I won't look at your transactions. You can still ask me anything about how Westpac's support works.");
      note(session, "The customer declined permission to look at their accounts.");
      return;
    case "allow": {
      session.analysisConsent = true;
      session.phase = "projection";
      audit(customerId, "consent", "Analysis consent given: last 90 days of transactions, for this request only");
      const tier = getTierResult(customerId);
      const shortfall = tier.projection.shortfall;
      say(
        session,
        shortfall
          ? `Thanks. Here's what I can see. Unless something changes, your balance would be about ${formatMoney(shortfall.amount)} short when your repayment comes out on ${formatDate(shortfall.date)}.`
          : `Thanks. Here's what I can see for the next ${TIER_CONFIG.forecastDays} days.`,
      );
      addMessage(session, { role: "careloop", card: { type: "projection", projection: tier.projection } });
      note(session, `The customer tapped Allow. The backend showed the ${TIER_CONFIG.forecastDays} day projection.`);
      if (tier.tier === 1 && !shortfall) {
        // Tier 1: nothing is short yet, so a light money check from Westpac's own pages, not a request.
        say(session, "Nothing looks short right now. If money feels tight, these can help keep it that way:");
        addMessage(session, { role: "careloop", card: { type: "money_check", items: MONEY_CHECK } });
        note(session, "Tier 1: the backend showed a money check card (budget, talk early, National Debt Helpline). The customer can still ask to prepare a request.");
      }
      return;
    }
    case "prepare_request":
      if (!session.analysisConsent) return;
      session.phase = "prepare";
      upsertDraftCard(session);
      say(session, "I've filled in what Westpac already knows from your accounts. Could you tell me in your own words what's changed?");
      note(session, "The customer tapped Prepare a request. The backend pre-filled the form and asked what has changed.");
      return;
    case "confirm_review":
      if (session.phase !== "review") return;
      say(session, "Thanks for checking. One last thing before anything is sent.");
      offerStartRequest(session);
      return;
    case "start_yes": {
      if (session.phase !== "start_request") return;
      const tier = session.analysisConsent ? getTierResult(customerId).tier : 2;
      const created = createCase({
        customerId,
        customerName: getCustomer(customerId).name,
        tier,
        status: "new",
        summary: buildSummary(session),
        draft: toDraft(session.draftFields),
      });
      session.phase = "receipt";
      addMessage(session, { role: "careloop", card: { type: "receipt", caseId: created.id, respondBy: created.respondBy } });
      note(session, `The customer tapped Yes, start. Case ${created.id} was filed.`);
      return;
    }
    case "start_not_yet":
      if (session.phase !== "start_request") return;
      session.phase = "explain";
      say(session, "No problem. Nothing has been sent, and the door stays open. You can come back to this any time.");
      note(session, "The customer tapped Not yet. Nothing was filed.");
      return;
    case "checkin_return":
    case "checkin_extend":
    case "checkin_keep": {
      if (session.phase !== "check_in") return;
      session.phase = "receipt";
      if (action === "checkin_keep") {
        say(session, "No problem. Your arrangement stays as it is. I'll check in again before it ends.");
        note(session, "At the check-in the customer chose to keep the arrangement as it is.");
        return;
      }
      const back = action === "checkin_return";
      session.followUp = back ? "Wants to go back to normal repayments" : "Asked for more time on the arrangement";
      audit(customerId, "case", `Check-in: ${session.followUp}. Sent to staff.`);
      say(
        session,
        back
          ? "Good to hear things are steadier. I've passed that to the Westpac Assist team. A person will confirm it with you, and nothing changes until they do."
          : "I've passed that to the Westpac Assist team with everything you've already told us, so you won't need to explain again. A person will reply, and nothing changes until they do.",
      );
      note(session, `At the check-in the customer tapped: ${session.followUp}. The Assist team was told. A person decides.`);
      return;
    }
    case "request_callback": {
      // Tier 3: a person rings by the next business day. An open case gets the call added; otherwise one is opened.
      const callbackBy = nextBusinessDay(DEMO_TODAY);
      const existing = getOpenCase(customerId);
      const target =
        existing ??
        createCase({
          customerId,
          customerName: getCustomer(customerId).name,
          tier: getTierResult(customerId).tier,
          status: "new",
          summary: ["Asked for a call back after a missed repayment. No details given yet."],
          draft: toDraft(session.draftFields),
        });
      target.callbackBy = callbackBy;
      session.phase = "receipt";
      say(session, "Thank you. A person from the Westpac Assist team will call you. You won't need to explain everything again.");
      addMessage(session, { role: "careloop", card: { type: "callback", caseId: target.id, callbackBy } });
      note(session, `The customer asked for a call back. Case ${target.id}: a person calls by ${callbackBy}.`);
      audit(customerId, "case", `Call back requested on case ${target.id}, by ${callbackBy}`);
      return;
    }
    case "start_talk":
    case "talk_to_someone":
      session.wantsHuman = true;
      audit(customerId, "message", "Customer asked for a person");
      say(session, "Of course. I've asked the Westpac Assist team to join this chat. They can already see what we've covered, so you won't need to repeat yourself.");
      note(session, "The customer asked to talk to a person. The Assist team was told.");
      return;
  }
}

/** A Westpac person replies in the same chat thread. */
export function staffReply(customerId: CustomerId, text: string): void {
  const session = getSession(customerId);
  addMessage(session, { role: "staff", text });
  note(session, `A Westpac Assist team member joined the chat and said: "${text}"`);
  audit(customerId, "message", `Staff: ${text}`);
}

/** A staff member picks up a new request. The customer is told in the same chat. */
export function startReview(customerId: CustomerId): boolean {
  const open = getOpenCase(customerId);
  if (!open || open.status !== "new") return false;
  open.status = "in_review";
  const session = getSession(customerId);
  say(session, `A person in the Westpac Assist team has started looking at your request. You'll hear back by ${formatDate(open.respondBy)} at the latest.`);
  note(session, `A Westpac Assist team member started reviewing case ${open.id}.`);
  audit(customerId, "case", `Case ${open.id} moved to In review by staff`);
  return true;
}

/** A staff member records the outcome. CareLoop only passes it on and books the check-in. */
export function recordDecision(customerId: CustomerId, key: DecisionKey): boolean {
  const open = getOpenCase(customerId);
  if (!open || !["new", "in_review"].includes(open.status)) return false;
  const { label, approved } = DECISIONS[key];
  open.decision = { outcome: label, approved, reviewOn: addDays(DEMO_TODAY, CHECK_IN_DAYS) };
  open.status = approved ? "arrangement" : "closed";
  const session = getSession(customerId);
  session.lockScreenBanner = true;
  addMessage(session, { role: "careloop", card: { type: "decision", outcome: label, approved, reviewOn: open.decision.reviewOn } });
  note(session, `A Westpac Assist team member recorded a decision on case ${open.id}: ${label}. The backend showed the decision card.`);
  audit(customerId, "case", `Case ${open.id}: staff recorded "${label}"`);
  return true;
}

/**
 * The check-in that closes the loop, four weeks after an arrangement starts.
 * On stage the four weeks are simulated: `recovered` picks which way the pay went.
 */
export function sendCheckIn(customerId: CustomerId, recovered: boolean): { sent: boolean; reason?: string } {
  const open = getOpenCase(customerId);
  if (!open?.decision?.approved) return { sent: false, reason: "No arrangement in place yet. A staff member records the decision first." };
  const session = getSession(customerId);
  const { recentPay, earlierPay } = getTierResult(customerId).signals;
  const payNow = (recovered ? earlierPay : recentPay) ?? 0;
  session.lockScreenBanner = true;
  session.phase = "check_in";
  session.followUp = null;
  addMessage(session, { role: "careloop", card: { type: "check_in", recovered, payNow, outcome: open.decision.outcome } });
  note(session, `Four weeks later the backend sent a check-in. Pay over the last 4 weeks: about ${formatMoney(payNow)} (${recovered ? "back to its earlier level" : "still lower"}).`);
  audit(customerId, "message", `Check-in sent (simulated 4 weeks later, pay ${recovered ? "recovered" : "still lower"})`);
  return { sent: true };
}

export function getSessionView(customerId: CustomerId): SessionView {
  const session = getSession(customerId);
  const customer = getCustomer(customerId);
  const schedule = getSchedule(customerId);
  return {
    customerId,
    customerName: customer.name,
    phase: session.phase,
    messages: session.messages,
    lockScreenBanner: session.lockScreenBanner,
    alertsOn: session.alertsOn,
    home: {
      balance: customer.balance,
      tiles: customer.products.map((p) => {
        const next = schedule.upcomingRepayments.find((r) => r.product === p.name);
        return { name: p.name, detail: next ? `Next repayment ${formatMoney(next.amount)} on ${formatDate(next.date)}` : `Repayment ${formatMoney(p.repayment)}` };
      }),
      headsUp: session.phase === "alert",
    },
  };
}

const URGENCY: Record<Case["status"], number> = { priority_assist: 0, new: 1, in_review: 2, arrangement: 3, watching: 4, closed: 5 };

/** The staff queue, most urgent first. */
export function getQueue(): QueueRow[] {
  return customerIds()
    .map((customerId): QueueRow => {
      const session = getSession(customerId);
      const open = getOpenCase(customerId);
      const tier = getTierResult(customerId, { sensitive: session.sensitive });
      return {
        customerId,
        customerName: getCustomer(customerId).name,
        tier: tier.tier,
        respondBy: open?.respondBy ?? null,
        status: open?.status ?? "watching",
        case: open,
        reasons: tier.reasons,
        timeline: tier.timeline,
        ml: mlOpinion(getMlRecord(customerId)),
        ...(open?.callbackBy && !["arrangement", "closed"].includes(open.status)
          ? { note: `Call back by ${formatDate(open.callbackBy)}` }
          : session.wantsHuman
          ? { note: "Asked to talk to someone" }
          : session.followUp
            ? { note: session.followUp }
          : session.saidCantPay && !open
            ? { note: "Said they can't pay. No request started yet." }
            : {}),
      };
    })
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.tier - a.tier);
}
