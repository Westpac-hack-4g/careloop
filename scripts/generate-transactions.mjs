// Writes data/transactions.csv: 90 days of made-up transactions for Tom, Sarah and Mia.
// No randomness, so the file is the same every run. Run: npm run data
import { writeFileSync } from "node:fs";

const DEMO_DATE = "2026-11-16";
const DAYS = 90; // 18 Aug to 15 Nov

const day = (offset) => {
  const d = new Date(`${DEMO_DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const ESSENTIAL_MERCHANTS = [
  ["Woolworths", "groceries"],
  ["Origin Energy", "utilities"],
  ["Coles", "groceries"],
  ["Translink", "transport"],
  ["Telstra", "phone"],
  ["Chemist Warehouse", "health"],
];

const rows = [];
const add = (customerId, date, amount, merchant, category, essential) =>
  rows.push([customerId, date, amount.toFixed(2), merchant, category, essential ? "yes" : "no"]);

// Daily essentials alternate between two amounts, so any 30 days in a row average out exactly.
function essentials(customerId, low, high, untilOffset = -1) {
  for (let i = -DAYS; i <= untilOffset; i++) {
    const [merchant, category] = ESSENTIAL_MERCHANTS[(i + DAYS) % ESSENTIAL_MERCHANTS.length];
    add(customerId, day(i), -((i + DAYS) % 2 === 0 ? low : high), merchant, category, true);
  }
}

const FORTNIGHTS = ["2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09", "2026-10-23", "2026-11-06"];

// Tom: steady $3,200 pay, spending about $400 a month above income.
FORTNIGHTS.forEach((d) => add("tom", d, 3200, "Employer payroll", "pay", false));
["2026-09-01", "2026-10-01", "2026-11-01"].forEach((d) =>
  add("tom", d, -2400, "Westpac home loan", "loan repayment", true),
);
essentials("tom", 90, 100); // $95 a day
for (let w = 0; w < 3; w++) {
  // $1,550 of non-essential spending in each 30 day window.
  for (let k = 0; k < 5; k++) {
    add("tom", day(-DAYS + w * 30 + 3 + k * 6), -310, k % 2 ? "JB Hi-Fi" : "Restaurant", "discretionary", false);
  }
}

// Sarah: pay falls from $2,600 to $1,560 a fortnight from late October.
FORTNIGHTS.forEach((d, i) => add("sarah", d, i < 4 ? 2600 : 1560, "Gold Coast Health payroll", "pay", false));
["2026-08-28", "2026-09-28", "2026-10-28"].forEach((d) =>
  add("sarah", d, -2850, "Westpac home loan", "loan repayment", true),
);
essentials("sarah", 85, 120); // $102.50 a day, $1,230 over 12 days

// Mia: last salary 17 October, then nothing.
["2026-08-22", "2026-09-05", "2026-09-19", "2026-10-03", "2026-10-17"].forEach((d) =>
  add("mia", d, 1900, "Retail employer payroll", "pay", false),
);
["2026-09-05", "2026-10-05"].forEach((d) =>
  add("mia", d, -480, "Westpac personal loan", "loan repayment", true),
);
essentials("mia", 55, 65);

rows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
const csv = ["customer_id,date,amount,merchant,category,essential", ...rows.map((r) => r.join(","))].join("\n");
writeFileSync(new URL("../data/transactions.csv", import.meta.url), csv + "\n");
console.log(`Wrote ${rows.length} transactions.`);
