// Saves Westpac's public support pages into data/kb so CareLoop can answer from them.
// Run: npm run kb
// Each file: title, url, topic, fetched date, then "---", then passages split by blank lines.
// The text belongs to Westpac. It is kept here only as the prototype's source material.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "https://www.westpac.com.au";
const PAGES = [
  { slug: "hardship-faq", title: "Financial hardship FAQs", topic: "hardship", path: "/faq/financial-hardship/" },
  { slug: "hardship-faq-customers", title: "Financial hardship: frequently asked questions", topic: "hardship", path: "/about-westpac/sustainability/initiatives-for-you/customers-financial-hardship-faq/" },
  { slug: "hardship-applying", topic: "hardship", path: "/help/support-with-tough-times/applying-for-financial-hardship-support/" },
  { slug: "tough-times", title: "Support with tough times", topic: "hardship", path: "/help/support-with-tough-times/" },
  { slug: "mortgage-stress", title: "Ways to lower mortgage stress", topic: "home loan", path: "/personal-banking/home-loans/manage-home-loan/lowering-stress/" },
  { slug: "credit-reporting", topic: "credit report", path: "/privacy/comprehensive-credit-reporting/" },
  { slug: "job-loss", title: "Job loss: help with your finances", topic: "job loss", path: "/help/lifemoments/managing-unplanned-moments/job-loss/help-with-your-finances/" },
  { slug: "serious-illness", title: "Serious illness: help with your finances", topic: "illness", path: "/help/lifemoments/managing-unplanned-moments/serious-illness/help-with-your-finances/" },
  { slug: "financial-stress", topic: "money stress", path: "/help/lifemoments/recovery/respond/tips-for-managing-financial-stress/" },
  { slug: "financial-counsellors", topic: "third party help", path: "/help/support-with-tough-times/support-for-financial-counsellors/" },
  { slug: "family-violence", topic: "priority assist", path: "/help/support-with-tough-times/domestic-violence-and-financial-abuse/" },
  { slug: "gambling", topic: "priority assist", path: "/help/support-with-tough-times/gambling/" },
];

const MAX_PASSAGE = 700;
const MIN_PASSAGE = 60;

const ENTITIES = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "..." };
const decode = (text) =>
  text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ");

/** Main content of a page as lines; headings are marked with a leading "# ". */
function toLines(html) {
  const main = html.match(/<main[\s\S]*<\/main>/i)?.[0] ?? html;
  const text = main
    .replace(/<(script|style|noscript|svg|nav|form|button|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h[1-6][^>]*>/gi, "\n# ")
    .replace(/<\/(h[1-6]|p|li|div|section|tr|dt|dd|summary)>/gi, "\n")
    .replace(/<(br|li|p|div|section|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(text).split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Group lines under their heading and cut long sections into passages. */
function toPassages(lines) {
  const passages = [];
  let heading = "";
  let buffer = [];
  const flush = () => {
    let chunk = "";
    const emit = () => {
      const body = chunk.trim();
      // Text before the first heading is the breadcrumb trail, not content.
      if (heading && body.length >= MIN_PASSAGE) passages.push(`${heading}: ${body}`);
      chunk = "";
    };
    for (const line of buffer) {
      if (chunk && chunk.length + line.length > MAX_PASSAGE) emit();
      chunk += `${chunk ? " " : ""}${line}`;
    }
    emit();
    buffer = [];
  };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      flush();
      heading = line.slice(2).replace(/[:?.]$/, (end) => (end === "?" ? "?" : ""));
    } else if (line.length > 2) buffer.push(line);
  }
  flush();
  return [...new Set(passages)];
}

const outDir = path.join(process.cwd(), "data", "kb");
mkdirSync(outDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const saved = [];

for (const page of PAGES) {
  const url = `${BASE}${page.path}`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (CareLoop student prototype)" }, redirect: "follow" });
    if (!response.ok || response.url.includes("/error")) throw new Error(`status ${response.status}`);
    const html = await response.text();
    const title = page.title ?? decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? page.slug).replace(/\s+/g, " ").trim();
    const passages = toPassages(toLines(html));
    if (passages.length < 2) throw new Error("no readable text found");
    writeFileSync(
      path.join(outDir, `${page.slug}.md`),
      `title: ${title}\nurl: ${response.url}\ntopic: ${page.topic}\nfetched: ${today}\n---\n${passages.join("\n\n")}\n`,
    );
    saved.push(`${page.slug}.md`);
    console.log(`saved  ${page.slug}.md  (${passages.length} passages)  ${title}`);
  } catch (error) {
    console.log(`FAILED ${page.slug}: ${error.message}  ${url}`);
  }
}

// Remove old files only when the fetch worked, so a bad network never empties the folder.
if (saved.length >= PAGES.length / 2) {
  for (const file of readdirSync(outDir)) {
    if (file.endsWith(".md") && file !== "README.md" && !saved.includes(file)) rmSync(path.join(outDir, file));
  }
}
console.log(`\n${saved.length} of ${PAGES.length} pages saved to data/kb`);
