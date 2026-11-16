import Anthropic from "@anthropic-ai/sdk";
import type { Citation } from "../contract";
import { toDraft } from "../conversation/draft";
import { runTool, TOOL_DEFINITIONS, TOOLS_BY_PHASE } from "../conversation/tools";
import { audit, type Session } from "../store";
import { getTierResult } from "../tier";
import { SYSTEM_PROMPT } from "./prompt";
import { checkReply, SAFE_FALLBACK } from "./safety";
import { scriptedReply, type AssistantReply } from "./scripted";

// The assistant: one Claude conversation with tools. The backend (not the AI)
// decides which tools exist at each step and runs them.

const MODEL = process.env.CARELOOP_MODEL || "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 6;

/** Sample mode: no key, or CARELOOP_AI=sample. The scripted assistant answers instead. */
export function aiMode(): "claude" | "sample" {
  if (process.env.CARELOOP_AI === "sample") return "sample";
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "claude" : "sample";
}

let client: Anthropic | null = null;
// 25 seconds, then fall back to the scripted reply rather than stall on stage.
// Some keys are not tied to one workspace; those need the workspace id sent with every request.
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const getClient = () =>
  (client ??= new Anthropic({
    timeout: 25_000,
    maxRetries: 1,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  }));

function stateBlock(session: Session): string {
  const draft = toDraft(session.draftFields);
  return [
    `step: ${session.phase}`,
    `tools that work at this step: ${TOOLS_BY_PHASE[session.phase].join(", ") || "none"}`,
    `permission to look at accounts: ${session.analysisConsent ? "given" : "not given"}`,
    session.draftFields.length
      ? `request form still missing: ${draft.missing.map((m) => m.field).join(", ") || "nothing"}`
      : "request form: not started",
  ].join("\n");
}

// The model always sees the same tool list: changing it mid-conversation invalidates the model's
// earlier reasoning. The backend still refuses any tool that does not belong to the current step.
const TOOLS: Anthropic.Beta.BetaTool[] = (Object.keys(TOOL_DEFINITIONS) as (keyof typeof TOOL_DEFINITIONS)[]).map((name) => ({
  name,
  description: TOOL_DEFINITIONS[name].description,
  input_schema: TOOL_DEFINITIONS[name].input_schema as Anthropic.Beta.BetaTool["input_schema"],
  strict: true,
}));

async function claudeReply(session: Session, text: string): Promise<AssistantReply> {
  const history = session.llmHistory;
  history.push({ role: "user", content: `<state>\n${stateBlock(session)}\n</state>\n<customer_message>\n${text}\n</customer_message>` });

  let citations: Citation[] = [];
  // Everything already on the customer's screen is trusted: their own words and the cards and lines built by code.
  let trusted = `${text}\n${JSON.stringify(session.messages)}\n${JSON.stringify(session.draftFields)}`;
  if (session.analysisConsent) trusted += `\n${JSON.stringify(getTierResult(session.customerId).projection.assumptions)}`;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Server-side fallback: if a safety classifier declines, the API re-runs on a fallback model.
    const withFallback = !MODEL.includes("haiku");
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: history,
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") throw new Error("The model declined this request");
    history.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const reply = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      const verdict = checkReply(reply, trusted);
      if (!verdict.ok) {
        audit(session.customerId, "safety", `Reply blocked (${verdict.problem}): ${reply}`);
        return { text: SAFE_FALLBACK };
      }
      const cited = citations.filter((c) => reply.includes(`[${c.n}]`));
      return { text: reply || "Sorry, could you say that another way?", ...(cited.length ? { citations: cited } : {}) };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const outcome = runTool(session, use.name, (use.input ?? {}) as Record<string, unknown>);
      if (outcome.citations) citations = outcome.citations;
      trusted += `\n${outcome.result}`;
      return { type: "tool_result", tool_use_id: use.id, content: outcome.result, ...(outcome.isError ? { is_error: true } : {}) };
    });
    history.push({ role: "user", content: results });
    // flag_sensitive hands the chat to a person: the safety card speaks, the assistant does not.
    if (session.phase === "handover") return { text: "" };
  }
  throw new Error("Too many tool rounds");
}

/** Answer one customer message. Falls back to the scripted assistant on any failure. */
export async function assistantReply(session: Session, text: string): Promise<AssistantReply> {
  if (aiMode() === "sample") return scriptedReply(session, text);
  const historyLength = session.llmHistory.length;
  try {
    return await claudeReply(session, text);
  } catch (error) {
    const reason =
      error instanceof Anthropic.RateLimitError ? "rate limited"
      : error instanceof Anthropic.APIConnectionError ? "connection or timeout"
      : error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message.slice(0, 300)}`
      : error instanceof Error ? error.message
      : "unknown error";
    audit(session.customerId, "safety", `AI unavailable (${reason}); scripted fallback used`);
    // Drop the half-finished turn so the next request starts from a valid history.
    session.llmHistory.length = historyLength;
    return scriptedReply(session, text);
  }
}
