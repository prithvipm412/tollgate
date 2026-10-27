import { combineVerdicts, moneyToCents, type EvaluatePolicy, type Finding } from "@tollgate/contracts";

/** Pure evaluation of validated requests and pre-aggregated history. */
export const evaluatePolicy: EvaluatePolicy = ({ request, policy, history, now }) => {
  const findings: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string, source: Finding["source"] = "policy") => {
    findings.push({ source, code, severity, message });
  };
  const amount = moneyToCents(request.amount);
  if (!policy.kinds_allowed.includes(request.kind)) {
    add("KIND_NOT_ALLOWED", "block", `Action kind ${request.kind} is not allowed.`);
  }
  if (request.kind !== "order_create") {
    const value = request.counterparty.value;
    if (policy.counterparties.deny?.includes(value)) {
      add("COUNTERPARTY_DENIED", "block", `Counterparty ${value} is denied.`);
    }
    if (policy.counterparties.allow && !policy.counterparties.allow.includes(value)) {
      add("COUNTERPARTY_NOT_ALLOWLISTED", "block", `Counterparty ${value} is not allowlisted.`);
    }
    if (policy.approval.new_counterparty && !history.known_counterparties.includes(value)) {
      add("NEW_COUNTERPARTY", "hold", `Counterparty ${value} has no payment history.`);
    }
  }
  if (request.category !== undefined && policy.categories.deny?.includes(request.category)) {
    add("CATEGORY_DENIED", "block", `Category ${request.category} is denied.`);
  }
  if (policy.categories.allow && (request.category === undefined || !policy.categories.allow.includes(request.category))) {
    add("CATEGORY_NOT_ALLOWLISTED", "block", "The category is missing or not allowlisted.");
  }
  const limits = [
    [policy.limits.per_action_max, 0, "PER_ACTION_LIMIT_EXCEEDED", "Per-action"],
    [policy.limits.daily_max, history.spent_today, "DAILY_LIMIT_EXCEEDED", "Daily"],
    [policy.limits.weekly_max, history.spent_week, "WEEKLY_LIMIT_EXCEEDED", "Weekly"],
    [policy.limits.monthly_max, history.spent_month, "MONTHLY_LIMIT_EXCEEDED", "Monthly"],
  ] as const;
  for (const [limit, spent, code, label] of limits) {
    if (limit && spent + amount > moneyToCents(limit)) {
      add(code, "block", `${label} spending would exceed ${limit.value} ${limit.currency}.`);
    }
  }
  if (policy.approval.always_for_kinds?.includes(request.kind)) {
    add("APPROVAL_REQUIRED_KIND", "hold", `Action kind ${request.kind} requires approval.`);
  }
  if (policy.approval.require_above && amount > moneyToCents(policy.approval.require_above)) {
    add("APPROVAL_REQUIRED_AMOUNT", "hold", "The amount exceeds the approval threshold.");
  }
  if (policy.velocity.max_actions_per_hour !== undefined && history.actions_last_hour >= policy.velocity.max_actions_per_hour) {
    add("VELOCITY_EXCEEDED", "hold", "The hourly action limit has been reached.");
  }
  if (policy.schedule) {
    const { days, start_hour, end_hour, tz } = policy.schedule;
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    // Both parts are guaranteed by the formatter options above.
    const day = local.find((part) => part.type === "weekday")!.value.toLowerCase() as typeof days[number];
    const hour = Number(local.find((part) => part.type === "hour")!.value);
    // Overnight windows include late and early hours on the configured local days.
    const withinHours = start_hour <= end_hour
      ? hour >= start_hour && hour < end_hour
      : hour >= start_hour || hour < end_hour;
    if (!days.includes(day) || !withinHours) {
      add("OUTSIDE_SCHEDULE", "hold", `The action is outside the permitted schedule in ${tz}.`);
    }
  }
  const stats = history.amount_stats;
  if (stats.n >= 5 && stats.stddev_cents !== 0 && amount - stats.mean_cents > 3 * stats.stddev_cents) {
    add("AMOUNT_ANOMALY", "warn", "The amount is more than three standard deviations above the historical mean.", "anomaly");
  }
  return { verdict: combineVerdicts(findings), findings };
};
