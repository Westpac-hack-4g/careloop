import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Keyword search (BM25) over the saved Westpac pages in data/kb.
// Everything goes through search(), so embeddings can be added behind it later.

export interface Passage {
  id: string;
  title: string;
  url: string;
  topic: string;
  text: string;
}

export interface SearchHit extends Passage {
  score: number;
}

/** Below this score the match is too weak to answer from: say "I'm not sure". */
export const WEAK_MATCH_SCORE = 3;

const STOP_WORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in is it me my of on or so that the this to was what when will with you your".split(" "),
);

const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word));

let index: { passages: Passage[]; tokens: string[][]; docFreq: Map<string, number>; avgLength: number } | null = null;

function build() {
  if (index) return index;
  const dir = path.join(process.cwd(), "data", "kb");
  const passages: Passage[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    const [header, body = ""] = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").split(/\n---\n/); // \r\n: Windows checkouts
    const meta = Object.fromEntries(
      header.split("\n").filter((line) => line.includes(":")).map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
    );
    body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("PLACEHOLDER TEXT")).forEach((text, i) =>
      passages.push({ id: `${file}#${i}`, title: meta.title ?? file, url: meta.url ?? "", topic: meta.topic ?? "", text }),
    );
  }
  const tokens = passages.map((p) => tokenize(`${p.title} ${p.text}`));
  const docFreq = new Map<string, number>();
  for (const doc of tokens) for (const term of new Set(doc)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  index = { passages, tokens, docFreq, avgLength: tokens.reduce((n, t) => n + t.length, 0) / Math.max(tokens.length, 1) };
  return index;
}

export function search(query: string, limit = 4): SearchHit[] {
  const { passages, tokens, docFreq, avgLength } = build();
  const terms = tokenize(query);
  const k1 = 1.2;
  const b = 0.75;
  return passages
    .map((passage, i) => {
      let score = 0;
      for (const term of terms) {
        const tf = tokens[i].filter((t) => t === term).length;
        if (!tf) continue;
        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (passages.length - df + 0.5) / (df + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens[i].length) / avgLength));
      }
      return { ...passage, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}
