import type { ActionRecord } from "@tollgate/contracts";
export function mergeActions(current: ActionRecord[], incoming: ActionRecord[]): ActionRecord[] {
  const records = new Map(current.map((record) => [record.request.action_id, record]));
  for (const record of incoming) {
    const previous = records.get(record.request.action_id);
    if (!previous || record.updated_at >= previous.updated_at)
      records.set(record.request.action_id, record);
  }
  return [...records.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100);
}
export function currency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
