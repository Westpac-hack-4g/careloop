import { DEMO_TODAY } from "../clock";
import type { CustomerId, TierResult } from "../contract";
import { getCustomer, getMlRecord, getSchedule } from "../data";
import { assessCustomer } from "./engine";

/** The ML service's assessment of one sample customer, in the app's shapes. */
export function getTierResult(
  customerId: CustomerId,
  options: { sensitive?: boolean; alertsOn?: boolean } = {},
): TierResult {
  const customer = getCustomer(customerId);
  return assessCustomer({
    customer:
      options.alertsOn === undefined ? customer : { ...customer, consents: { alerts: options.alertsOn } },
    schedule: getSchedule(customerId),
    record: getMlRecord(customerId),
    today: DEMO_TODAY,
    sensitive: options.sensitive,
  });
}

export { assessCustomer } from "./engine";
