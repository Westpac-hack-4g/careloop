// The outcomes a staff member can record. No amounts here: the person confirms the details in writing.
export const DECISIONS = {
  lower_repayments: { label: "Lower repayments for 3 months", approved: true },
  pause: { label: "Repayment pause for 1 month", approved: true },
  longer_term: { label: "Longer loan term", approved: true },
  not_offered: { label: "No arrangement offered", approved: false },
} as const;

export type DecisionKey = keyof typeof DECISIONS;

export const isDecisionKey = (value: unknown): value is DecisionKey => typeof value === "string" && value in DECISIONS;

/** How long after a decision CareLoop checks in. */
export const CHECK_IN_DAYS = 28;
