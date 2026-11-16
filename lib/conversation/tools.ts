import type { Citation, Phase } from "../contract";
import { search, WEAK_MATCH_SCORE } from "../rag";
import { addMessage, audit, type Session } from "../store";
import { getTierResult } from "../tier";
import { handover } from "./handover";
import { applyCustomerField, CUSTOMER_FIELD_NAMES, prefillFromAccounts, toDraft } from "./draft";

// The only things the AI can do. The backend decides which tools exist in each
// phase and refuses data tools without consent. The AI never files a request:
// only the customer's "Yes, start" tap does that (see engine.ts).

export type ToolName = "flag_sensitive" | "retrieve_westpac_info" | "request_consent" | "get_tier_result" | "update_draft" | "show_draft";

export const TOOLS_BY_PHASE: Record<Phase, ToolName[]> = {
  idle: ["flag_sensitive", "retrieve_westpac_info"],
  alert: ["flag_sensitive", "retrieve_westpac_info"],
  explain: ["flag_sensitive", "retrieve_westpac_info", "request_consent"],
  consent: ["flag_sensitive", "retrieve_westpac_info", "request_consent"],
  projection: ["flag_sensitive", "retrieve_westpac_info", "get_tier_result"],
  prepare: ["flag_sensitive", "retrieve_westpac_info", "get_tier_result", "update_draft", "show_draft"],
  review: ["flag_sensitive", "retrieve_westpac_info", "update_draft", "show_draft"],
  start_request: ["flag_sensitive", "retrieve_westpac_info"],
  receipt: ["flag_sensitive", "retrieve_westpac_info"],
  check_in: ["flag_sensitive", "retrieve_westpac_info"],
  handover: [],
};

/** Tools that read the customer's account data. Refused until consent is recorded. */
const NEEDS_CONSENT: ToolName[] = ["get_tier_result", "update_draft", "show_draft"];

export interface ToolOutcome {
  /** What goes back to the AI. */
  result: string;
  isError?: boolean;
  citations?: Citation[];
}

export function runTool(session: Session, name: string, input: Record<string, unknown>): ToolOutcome {
  const tool = name as ToolName;
  if (!TOOLS_BY_PHASE[session.phase].includes(tool)) {
    audit(session.customerId, "tool_refused", `${name} is not allowed in phase ${session.phase}`);
    return { result: `Tool ${name} is not available at this step.`, isError: true };
  }
  if (NEEDS_CONSENT.includes(tool) && !session.analysisConsent) {
    audit(session.customerId, "tool_refused", `${name} refused: no consent recorded`);
    return { result: "Refused: the customer has not given permission to look at their accounts. Ask with request_consent.", isError: true };
  }
  audit(session.customerId, "tool_call", `${name} ${JSON.stringify(input)}`);

  switch (tool) {
    case "flag_sensitive": {
      handover(session, "flagged by the AI");
      return { result: "Done. The form is stopped and the safety card is shown. A specialist takes it from here. Do not write anything else." };
    }
    case "retrieve_westpac_info": {
      const hits = search(String(input.query ?? ""));
      if (!hits.length || hits[0].score < WEAK_MATCH_SCORE) {
        return { result: "No good match in Westpac's pages. Say you are not sure and offer the Westpac Assist team." };
      }
      const citations = hits.map((hit, i) => ({ n: i + 1, title: hit.title, url: hit.url }));
      return {
        result: hits.map((hit, i) => `[${i + 1}] ${hit.title} - ${hit.text} (${hit.url})`).join("\n"),
        citations,
      };
    }
    case "request_consent": {
      if (!session.messages.some((m) => m.card?.type === "consent")) addMessage(session, { role: "careloop", card: { type: "consent" } });
      session.phase = "consent";
      return { result: "Consent card shown. Wait for the customer to tap Allow or Not now." };
    }
    case "get_tier_result": {
      const tier = getTierResult(session.customerId, { sensitive: session.sensitive });
      return { result: JSON.stringify({ tier: tier.tier, tierName: tier.tierName, reasons: tier.reasons, shortfall: tier.projection.shortfall, assumptions: tier.projection.assumptions }) };
    }
    case "update_draft": {
      const updates = Array.isArray(input.fields) ? (input.fields as { field: string; value: string; evidence: string }[]) : [];
      const errors: string[] = [];
      for (const update of updates) {
        const applied = applyCustomerField(session.draftFields, update);
        if (applied.ok) session.draftFields = applied.fields;
        else errors.push(applied.error);
      }
      const draft = toDraft(session.draftFields);
      upsertDraftCard(session);
      return {
        result: JSON.stringify({
          errors,
          still_missing: draft.missing.map((m) => m.field),
          next: draft.missing.length ? `Ask about: ${draft.missing[0].label}` : "Nothing is missing. Call show_draft.",
        }),
        isError: errors.length > 0 && errors.length === updates.length,
      };
    }
    case "show_draft": {
      const draft = toDraft(session.draftFields);
      if (draft.missing.length) return { result: `Still missing: ${draft.missing.map((m) => m.field).join(", ")}. Ask for these first.`, isError: true };
      session.messages = session.messages.filter((m) => m.card?.type !== "draft" && m.card?.type !== "review");
      addMessage(session, { role: "careloop", card: { type: "review", draft } });
      session.phase = "review";
      return { result: "Review card shown. The customer checks it and taps Looks right." };
    }
  }
}

/** Keep one live draft card in the chat and refresh it as fields fill in. */
export function upsertDraftCard(session: Session): void {
  if (!session.draftFields.length) session.draftFields = prefillFromAccounts(session.customerId);
  const draft = toDraft(session.draftFields);
  const existing = session.messages.find((m) => m.card?.type === "draft");
  if (existing) existing.card = { type: "draft", draft };
  else addMessage(session, { role: "careloop", card: { type: "draft", draft } });
}

/** Tool definitions in the shape the Claude API expects. */
export const TOOL_DEFINITIONS: Record<ToolName, { description: string; input_schema: Record<string, unknown> }> = {
  flag_sensitive: {
    description:
      "Call this at once, before anything else, when the customer mentions or hints at family or domestic violence, someone controlling their money, feeling unsafe at home, gambling harm, the death of someone close, or thoughts of harming themselves. Hints count: you do not need to be certain. It stops the form and brings in Westpac's specialist team. Never ask for details first.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  retrieve_westpac_info: {
    description:
      "Search Westpac's own public pages. Call this before answering any question about hardship help, credit reports, options or support services. Answer only from what it returns.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "The customer's question in a few words" } }, required: ["query"], additionalProperties: false },
  },
  request_consent: {
    description: "Show the card that asks permission to look at the customer's last 90 days of transactions. Call it when the customer wants their situation checked.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  get_tier_result: {
    description: "Get the rule engine's result for this customer: tier, reasons, any shortfall and the assumptions behind it. The only source of dollar amounts.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  update_draft: {
    description:
      "Save what the customer just told you into the request form. One answer can fill several fields. Each field needs the customer's own words as evidence. Returns what is still missing.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string", enum: CUSTOMER_FIELD_NAMES },
              value: { type: "string", description: "Short plain value, for example 'Reduced hours' or 'Car loan, $320 a month'" },
              evidence: { type: "string", description: "The customer's exact words" },
            },
            required: ["field", "value", "evidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["fields"],
      additionalProperties: false,
    },
  },
  show_draft: {
    description: "Show the full request for the customer to check. Only works when nothing is missing.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
};
