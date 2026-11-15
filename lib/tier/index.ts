import { DEMO_TODAY } from "../clock";
import type { CustomerId, TierResult } from "../contract";
import { getCustomer, getSchedule, getTransactions } from "../data";
import { assessCustomer } from "./engine";

/** Run the tier engine for one sample customer. */
export function getTierResult(
  customerId: CustomerId,
  options: { sensitive?: boolean; alertsOn?: boolean } = {},
): TierResult {
  const customer = getCustomer(customerId);
  return assessCustomer({
    customer:
      options.alertsOn === undefined ? customer : { ...customer, consents: { alerts: options.alertsOn } },
    transactions: getTransactions(customerId),
    schedule: getSchedule(customerId),
    today: DEMO_TODAY,
    sensitive: options.sensitive,
  });
}

export { assessCustomer } from "./engine";
