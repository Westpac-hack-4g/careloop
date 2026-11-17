import type { Card, ChatSoFar, Phase } from "../contract";
import type { Session } from "../store";

// What a staff member needs before joining a chat, so the customer never has to repeat themselves:
// where the conversation is, whether they gave consent, the last few turns, and any unsent draft.

const STAGE: Record<Phase, string> = {
  idle: "Not in a conversation",
  alert: "Heads-up sent, not opened yet",
  explain: "Asking questions",
  consent: "Asked for permission to look at accounts",
  projection: "Has seen the 14-day forecast",
  prepare: "Filling in a request",
  review: "Checking the request before sending",
  start_request: "Deciding whether to send the request",
  receipt: "Request sent",
  check_in: "At the 4-week check-in",
  handover: "Passed to Priority Assist",
};

const CARD: Record<Card["type"], string> = {
  alert: "Saw the heads-up",
  closed: "Closed the chat (not now)",
  consent: "Saw the permission card",
  projection: "Saw the 14-day forecast",
  money_check: "Saw the money check",
  help_options: "Saw the options for getting help",
  draft: "Saw the request draft",
  review: "Saw the request to check",
  start_request: "Asked whether to send the request",
  receipt: "Got the request receipt",
  decision: "Got the decision",
  check_in: "Got the 4-week check-in",
  callback: "Booked a call back",
  handover: "Saw the safety card",
};

const LAST = 8;

export function chatSoFar(session: Session): ChatSoFar {
  const entries = session.messages.slice(-LAST).map((m) =>
    m.card
      ? { who: "event" as const, text: CARD[m.card.type] }
      : { who: m.role, text: (m.text ?? "").length > 220 ? `${m.text!.slice(0, 217)}…` : (m.text ?? "") },
  );
  return {
    stage: STAGE[session.phase],
    consent: session.analysisConsent,
    earlier: Math.max(0, session.messages.length - LAST),
    entries,
    draft: session.draftFields,
  };
}
