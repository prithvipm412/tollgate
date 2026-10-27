import { afterEach, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("preserves the API error message for inline display", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "Incorrect password." }), {
          status: 401,
        }),
      ),
  );
  await expect(api("/auth/login")).rejects.toMatchObject({
    message: "Incorrect password.",
    status: 401,
  });
});
it("turns non-JSON upstream failures into typed errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
  await expect(api("/actions")).rejects.toBeInstanceOf(ApiRequestError);
});
