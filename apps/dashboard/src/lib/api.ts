import { ApiErrorSchema } from "@tollgate/contracts";
import type { ApiError } from "@tollgate/contracts";
export class ApiRequestError extends Error {
  constructor(
    public readonly error: ApiError,
    public readonly status: number,
  ) {
    super(error.message);
    this.name = "ApiRequestError";
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new ApiRequestError(
      parsed.success
        ? parsed.data
        : { code: "INTERNAL_ERROR", message: `Request failed (${response.status}).` },
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load data. Please retry.";
}
