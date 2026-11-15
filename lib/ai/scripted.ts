import type { Citation } from "../contract";
import { CUSTOMER_FIELDS, toDraft, type CustomerFieldName } from "../conversation/draft";
import { runTool } from "../conversation/tools";
import type { Session } from "../store";

// The scripted assistant: no LLM. It runs when there is no API key (sample mode),
// in tests, and as the fallback when the AI service is slow or fails on stage.
// It uses the same tools as the real assistant, so the same gates apply.

export interface AssistantReply {
  text: string;
  citations?: Citation[];
}

export const QUESTIONS: Record<CustomerFieldName, string> = {
  "what_changed.reason": "Could you tell me in your own words what's changed?",
  "what_changed.since": "When did this start?",
  "what_changed.expected_duration": "How long do you think it may last? A rough guess is fine.",
  other_debts: "Do you have loans or cards with other lenders?",
  "household.joint_borrower": "Is anyone else on the loan with you?",
  "help.preference":
    "Last one: what would help most? Options include lower repayments for a while, a short pause or a longer loan term. Westpac's team will look at what fits.",
};

const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Very small pattern matcher for the demo path. The real assistant does this with the LLM. */
function extractFields(text: string, asked: CustomerFieldName | undefined) {
  const found: { field: CustomerFieldName; value: string; evidence: string }[] = [];
  const add = (field: CustomerFieldName, value: string) => found.push({ field, value, evidence: text });
  const plainNo = /^(no|nope|none|nothing|just me|only me)\b/i.test(text.trim());

  if (/(shift|hours|days).*(cut|reduc|less|fewer)|(cut|reduc).*(shift|hours|days)/i.test(text)) add("what_changed.reason", "Reduced hours");
  else if (/lost (my )?job|redundan|laid off|let go/i.test(text)) add("what_changed.reason", "Job loss");
  else if (/sick|ill\b|illness|injur|surgery/i.test(text)) add("what_changed.reason", "Illness or injury");
  else if (asked === "what_changed.reason") add("what_changed.reason", text.trim());

  const since = text.match(new RegExp(`\\b(?:since|from|in)\\s+${MONTH}\\b`, "i"));
  if (since) add("what_changed.since", cap(since[1]));
  else if (asked === "what_changed.since") add("what_changed.since", text.trim());

  const until = text.match(new RegExp(`\\buntil\\s+(?:at least\\s+|about\\s+)?${MONTH}\\b`, "i"));
  const span = text.match(/\b(\d+)\s+(weeks?|months?)\b/i);
  if (until) add("what_changed.expected_duration", `Until at least ${cap(until[1])}`);
  else if (asked === "what_changed.expected_duration") add("what_changed.expected_duration", /don'?t know|not sure/i.test(text) ? "Not sure" : span ? `About ${span[0]}` : text.trim());

  const debt = text.match(/(car loan|personal loan|credit card|loan)[^$]*\$\s?([\d,]+)/i);
  if (debt) add("other_debts", `${cap(debt[1])}, $${debt[2]} a month`);
  else if (asked === "other_debts") add("other_debts", plainNo ? "None" : text.trim());

  if (asked === "household.joint_borrower") add("household.joint_borrower", plainNo ? "No" : /\b(yes|partner|husband|wife|both)\b/i.test(text) ? "Yes" : text.trim());

  if (/lower repayments?|smaller repayments?|pause|longer (loan )?term|interest.only/i.test(text) || asked === "help.preference") {
    add("help.preference", cap(text.trim().replace(/\.$/, "")));
  }
  return found;
}

export function scriptedReply(session: Session, text: string): AssistantReply {
  if (session.phase === "prepare" || session.phase === "review") {
    const asked = toDraft(session.draftFields).missing[0]?.field as CustomerFieldName | undefined;
    const fields = extractFields(text, asked);
    if (fields.length) runTool(session, "update_draft", { fields });
    const missing = toDraft(session.draftFields).missing;
    if (!missing.length) {
      runTool(session, "show_draft", {});
      return { text: "Thanks. Here is everything in one place. Please check it and change anything that isn't right." };
    }
    const next = CUSTOMER_FIELDS.find((f) => f.field === missing[0].field)!;
    return { text: `${fields.length ? "Thanks, that helps. " : ""}${QUESTIONS[next.field]}` };
  }

  if (session.phase === "explain" && /\b(check|look|show me|why|how much)\b/i.test(text)) {
    runTool(session, "request_consent", {});
    return { text: "I can check that for you. I'll need your OK first." };
  }

  const found = runTool(session, "retrieve_westpac_info", { query: text });
  if (found.citations?.length) {
    const top = found.result.split("\n")[0].replace(/^\[1\] .*? - /, "").replace(/ \(https?:[^)]*\)$/, "");
    // Two sentences are enough for a chat bubble.
    const short = top.replace(/^[^:]{0,80}: /, "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return { text: `${short} [1]`, citations: found.citations.slice(0, 1) };
  }
  return { text: "I'm not sure about that one, and I don't want to guess. I can connect you with the Westpac Assist team if you'd like." };
}
