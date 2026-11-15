// Every threshold the tier rules use lives here, so a pilot can tune them
// without touching the logic.
export const TIER_CONFIG = {
  incomeChangeFlag: -0.25, // pay down 25% or more
  bufferTrendFlag: -0.2, // balance down 20% or more over 90 days
  netFlowNegativeMonths: 3, // spending above income this many months running
  cardUseFlag: 0.7, // card balance at 70% of the limit or more, and rising
  projectionDays: 30,
  essentialsLookbackDays: 30,
  recentPayWeeks: 4,
  earlierPayWeeks: 12,
} as const;

export const TIER_NAMES = ["Steady", "Squeezed", "At risk", "In difficulty", "Needs special care"] as const;
