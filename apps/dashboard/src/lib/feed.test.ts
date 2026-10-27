import { describe, expect, it } from "vitest";
import type { ActionRecord } from "@tollgate/contracts";
import { currency, mergeActions } from "./feed";
const record = (id: string, updated: string, status: ActionRecord["status"] = "received") =>
  ({ request: { action_id: id }, created_at: id, updated_at: updated, status }) as ActionRecord;
describe("feed reconciliation", () => {
  it("keeps a newer streamed action when an older initial fetch arrives", () => {
    const live = record("a", "2026-10-27T12:00:00Z", "executed");
    expect(mergeActions([live], [record("a", "2026-10-27T11:00:00Z")])).toEqual([live]);
  });
  it("updates the same action without duplicating it and bounds the feed", () => {
    const initial = Array.from({ length: 110 }, (_, i) => record(String(i).padStart(3, "0"), "1"));
    const result = mergeActions(initial, [record("109", "2", "executed")]);
    expect(result).toHaveLength(100);
    expect(result[0]?.status).toBe("executed");
  });
  it("formats protected integer cents as USD", () => {
    expect(currency(535000)).toBe("$5,350.00");
    expect(currency(1)).toBe("$0.01");
  });
});
