// Checks that run on every AI reply before the customer sees it.

const APPROVAL_PROMISES = [
  /you('ll| will) (definitely |certainly |surely )?(be|get) approved/i,
  /(will|going to) be approved/i,
  /i('ve| have| can) approved?/i,
  /guarantee/i,
  /your request (is|has been) approved/i,
];

/** "I can't promise it will be approved" is the right thing to say, so sentences that say no are let through. */
const SAYS_NO = /\b(can't|cannot|can not|won't|not|never|no|isn't|aren't|unable|whether|if)\b/i;

const toNumber = (raw: string): number => Number(raw.replace(/[$\s,]/g, ""));
/** Dollar amounts the reply states. */
const amountsIn = (text: string): number[] => (text.match(/\$\s?\d[\d,]*(\.\d+)?/g) ?? []).map(toNumber);
/** Every number in the trusted text. Tool results carry amounts as plain numbers, with no dollar sign. */
export const numbersIn = (text: string): number[] => (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map(toNumber);

export interface SafetyVerdict {
  ok: boolean;
  problem?: string;
}

/**
 * @param reply       the AI's text
 * @param trustedText everything a dollar amount may come from: tier engine output,
 *                    the draft, retrieved passages and the customer's own messages
 */
export function checkReply(reply: string, trustedText: string): SafetyVerdict {
  const sentences = reply.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/);
  if (sentences.some((s) => !SAYS_NO.test(s) && APPROVAL_PROMISES.some((re) => re.test(s)))) return { ok: false, problem: "approval promise" };
  const allowed = new Set(numbersIn(trustedText));
  const invented = amountsIn(reply).filter((amount) => !allowed.has(amount));
  if (invented.length) return { ok: false, problem: `amount not from the rules engine: ${invented.join(", ")}` };
  return { ok: true };
}

export const SAFE_FALLBACK =
  "I want to be careful to get this right, so I'd rather not guess. The Westpac Assist team can go through it with you. Would you like me to ask them to join this chat?";
