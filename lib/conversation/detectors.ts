// Keyword backups that run on every customer message, before the AI sees it.
// The AI engineer adds an LLM detector on top; these keep the demo safe without one.

const SENSITIVE = [
  /partner (controls|takes|won'?t let)/i,
  /controls? (all )?(the|my) money/i,
  /(afraid|scared) of (him|her|my partner|my husband|my wife)/i,
  /domestic violence|family violence|financial abuse|abus(e|ive|ed)/i,
  /gambl/i,
  /(passed away|died|funeral|bereave)/i,
  /(hurt|harm|kill) myself|suicid/i,
];

const CANT_PAY = [
  /can'?t (pay|afford|make|cover)/i,
  /cannot (pay|afford|make|cover)/i,
  /won'?t (be able to|make|manage)/i,
  /(unable|not able) to (pay|make|cover)/i,
  /don'?t think i can (pay|make|cover)/i,
];

export const isSensitive = (text: string): boolean => SENSITIVE.some((re) => re.test(text));
export const saysCantPay = (text: string): boolean => CANT_PAY.some((re) => re.test(text));
