import { z } from "zod";

/** Cursor-paginated list envelope used by every list endpoint. */
export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
export type Page<T> = { items: T[]; next_cursor: string | null };
