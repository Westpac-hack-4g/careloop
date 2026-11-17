import type { Card } from "../contract";

// Tier 1 ("Squeezed"): nothing is short yet, so CareLoop offers a light money check instead of a
// request. Each step is taken from a saved Westpac page in data/kb, with the page as its source.

export const MONEY_CHECK: Extract<Card, { type: "money_check" }>["items"] = [
  {
    title: "Make a simple budget",
    text: "Draw up a budget so you can cover what you need without running out of money. It isn't fixed: change it as things change.",
    source: { n: 1, title: "Tips for managing financial stress", url: "https://www.westpac.com.au/help/lifemoments/recovery/respond/tips-for-managing-financial-stress/" },
  },
  {
    title: "Talk to us early",
    text: "The sooner you talk with us, the sooner we can help. A conversation won't affect your credit report or your ability to borrow.",
    source: { n: 2, title: "Ways to lower mortgage stress", url: "https://www.westpac.com.au/home-loans/manage-home-loan/lowering-stress" },
  },
  {
    title: "Free, independent advice",
    text: "The National Debt Helpline offers free, confidential financial counselling on 1800 007 007.",
    source: { n: 3, title: "Applying for Financial Hardship Support", url: "https://www.westpac.com.au/help/support-with-tough-times/applying-for-financial-hardship-support/" },
  },
];
