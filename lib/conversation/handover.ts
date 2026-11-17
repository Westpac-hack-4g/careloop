import { getCustomer } from "../data";
import { getTierResult } from "../tier";
import { addMessage, audit, createCase, type Session } from "../store";
import { toDraft } from "./draft";

/**
 * A sensitive disclosure: stop the form, show the safety card and pass the chat to Priority Assist.
 * Reached two ways: the keyword check in detectors.ts, or the AI calling flag_sensitive.
 */
export function handover(session: Session, how: string): void {
  if (session.phase === "handover") return;
  session.sensitive = true;
  session.phase = "handover";
  addMessage(session, { role: "careloop", card: { type: "handover" } });
  createCase({
    customerId: session.customerId,
    customerName: getCustomer(session.customerId).name,
    // The financial tier stays as the ML service set it; the specialist need is the status.
    tier: getTierResult(session.customerId).tier,
    status: "priority_assist",
    summary: ["The customer shared a sensitive situation. Form filling stopped.", "Passed to Priority Assist. Do not ask the customer to repeat details."],
    draft: toDraft(session.draftFields),
  });
  audit(session.customerId, "safety", `Sensitive disclosure (${how}): handover card shown, case sent to Priority Assist`);
}
