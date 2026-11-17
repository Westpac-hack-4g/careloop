// The tier rules and thresholds live in the ML service (careloop/tiers.py and config.py in
// `ml/`). The app shows their result; these few values are only for wording.
export const TIER_CONFIG = {
  /** The base-case forecast looks this many days ahead (LOOKAHEAD_DAYS). */
  forecastDays: 14,
  /** LOW_BUFFER fires under this many days of essential costs (WARNING_BUFFER_DAYS). */
  warningBufferDays: 14,
} as const;

/** tiers.py labels. A specialist need is a separate flag, shown as Priority Assist, not a tier. */
export const TIER_NAMES = ["Steady", "Squeezed", "At risk", "In difficulty"] as const;
