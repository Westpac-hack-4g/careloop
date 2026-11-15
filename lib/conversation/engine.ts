import { assistantReply } from "../ai/assistant";
import { formatDate, formatMoney } from "../clock";
import type { Case, CustomerId, QueueRow, SessionView } from "../contract";
import { getCustomer } from "../data";
import { addMessage, audit, createCase, customerIds, getOpenCase, getSession, type Session } from "../store";
import { getTierResult } from "../tier";
import { isSensitive, saysCantPay } from "./detectors";
import { toDraft } from "./draft";
import { upsertDraftCard } from "./tools";

// The conversation engine. It owns the step (phase) the conversation is at.
// Button taps are handled here in plain code; only free text goes to the AI.

export type Action =
  | "open_app"
  | "show_why"
  | "talk_to_someone"
  | "not_now"
  | "not_right"
  | "allow"
  | "decline_consent"
  | "prepare_request"
  | "confirm_review"
  | "start_yes"
  | "start_not_yet"
  | "start_talk"
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
  const shortfall = tier.projection.shortfall;
  if (shortfall) addMessage(session, { role: "careloop", card: { type: "alert", shortfall: shortfall.amount, date: shortfall.date } });
  else if (tier.tier === 3) say(session, "A repayment didn't go through. If things are tight, I can help you look at your options. No pressure.");
  else say(session, "Your everyday balance has been getting lower over the last few months. Would you like to see why?");
  audit(customerId, "message", `Heads-up sent (tier ${tier.tier})`);
  return { sent: true };
}

function handover(session: Session): void {
  session.sensitive = true;
  session.phase = "handover";
  addMessage(session, { role: "careloop", card: { type: "handover" } });
  createCase({
    customerId: session.customerId,
    customerName: getCustomer(session.customerId).name,
    tier: 4,
    status: "priority_assist",
    summary: ["The customer shared a sensitive situation. Form filling stopped.", "Passed to Priority Assist. Do not ask the customer to repeat details."],
    draft: toDraft(session.draftFields),
  });
  audit(session.customerId, "safety", "Sensitive disclosure: handover card shown, case sent to Priority Assist");
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

export async function handleMessage(customerId: CustomerId, text: string): Promise<void> {
  const session = getSession(customerId);
  session.lockScreenBanner = false;
  addMessage(session, { role: "customer", text });
  audit(customerId, "message", `Customer: ${text}`);
  if (session.phase === "handover") return; // A person takes it from here.

  // Two shortcuts that work at any step.
  if (isSensitive(text)) return handover(session);
  if (saysCantPay(text) && !["start_request", "receipt"].includes(session.phase)) {
    session.saidCantPay = true;
    audit(customerId, "cant_pay_logged", `"${text}"`);
    note(session, `The customer said: "${text}". The backend showed the "Start a request?" card.`);
    say(session, "Thank you for telling me. That can't have been easy to write. Nothing is sent unless you say so.");
    return offerStartRequest(session);
  }

  if (session.phase === "idle" || session.phase === "alert") session.phase = "explain";
  const seen = new Set(session.messages.map((m) => m.id));
  const reply = await assistantReply(session, text);
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
    case "show_why":
      session.phase = "consent";
      say(session, "Your pay looks a little different lately, so I wanted to give you an early heads-up rather than a surprise. I can show you exactly why, if that's OK.");
      addMessage(session, { role: "careloop", card: { type: "consent" } });
      note(session, "The customer tapped Show me why. The backend showed the consent card.");
      return;
    case "not_now":
      session.phase = "idle";
      say(session, "No problem. I'm here whenever you want to look at it.");
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
          : "Thanks. Here's what I can see for the next 30 days.",
      );
      addMessage(session, { role: "careloop", card: { type: "projection", projection: tier.projection } });
      note(session, "The customer tapped Allow. The backend showed the 30 day projection.");
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

export function getSessionView(customerId: CustomerId): SessionView {
  const session = getSession(customerId);
  return {
    customerId,
    customerName: getCustomer(customerId).name,
    phase: session.phase,
    messages: session.messages,
    lockScreenBanner: session.lockScreenBanner,
    alertsOn: session.alertsOn,
  };
}

const URGENCY: Record<Case["status"], number> = { priority_assist: 0, new: 1, in_review: 2, watching: 3 };

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
        ...(session.wantsHuman
          ? { note: "Asked to talk to someone" }
          : session.saidCantPay && !open
            ? { note: "Said they can't pay. No request started yet." }
            : {}),
      };
    })
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.tier - a.tier);
}
