import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LlmClient as Contract } from "@tollgate/contracts";
import { LlmClient, LlmTimeoutError, LlmProviderError, LlmValidationError } from "./index.js";

const schema = z.object({ count: z.number() });
const opts = { system: "Return a count.", user: "Count items.", schema, timeoutMs: 1000 };
const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }));
function setup(...contents: string[]) {
  const transport = vi.fn<typeof fetch>();
  contents.forEach((content) => transport.mockResolvedValueOnce(completion(content)));
  const client: Contract = new LlmClient({
    baseUrl: "https://llm.example/v1/",
    apiKey: "test-key",
    model: "test-model",
    fetch: transport,
  });
  return { client, transport };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("LlmClient", () => {
  it("sends JSON-mode requests and returns schema-validated data", async () => {
    const { client, transport } = setup('{"count":2}');
    expect(await client.completeJson(opts)).toEqual({ count: 2 });
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(request!.body as string)).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: expect.stringContaining(opts.system) },
        { role: "user", content: opts.user },
      ],
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['{"count":"two"}', "not JSON"])("repairs malformed output once: %s", async (bad) => {
    const { client, transport } = setup(bad, '{"count":2}');
    expect(await client.completeJson(opts)).toEqual({ count: 2 });
    expect(transport).toHaveBeenCalledTimes(2);
    const body = JSON.parse(transport.mock.calls[1]![1]!.body as string);
    expect(body.messages[2]).toEqual({ role: "assistant", content: bad });
    expect(body.messages[3].content).toMatch(/correct.*JSON/i);
    expect(body.messages[3].content).toContain(bad.startsWith("{") ? "count" : "valid JSON");
  });

  it.each(['{"count":false}', "```json\n{}\n```"])(
    "throws after failed repair: %s",
    async (bad) => {
      const { client, transport } = setup(bad, bad);
      await expect(client.completeJson(opts)).rejects.toBeInstanceOf(LlmValidationError);
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  it.each([401, 429, 500])("surfaces HTTP %s without retrying", async (status) => {
    const { client, transport } = setup();
    transport.mockResolvedValue(new Response("provider error", { status }));
    await expect(client.completeJson(opts)).rejects.toMatchObject({
      name: "LlmProviderError",
      status,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "envelope", "body"])("surfaces %s failures", async (failure) => {
    const { client, transport } = setup();
    if (failure === "network") transport.mockRejectedValue(new Error("network"));
    else transport.mockResolvedValue(new Response(failure === "body" ? "not JSON" : "{}"));
    await expect(client.completeJson(opts)).rejects.toBeInstanceOf(LlmProviderError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch", "body", "repair"])("enforces one deadline during %s", async (stage) => {
    vi.useFakeTimers();
    const { client, transport } = setup();
    const pending = () => new Promise<Response>(() => {});
    if (stage === "body")
      transport.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
    else if (stage === "repair")
      transport
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return completion("{}");
        })
        .mockImplementation(pending);
    else transport.mockImplementation(pending);
    const result = client.completeJson({ ...opts, timeoutMs: 100 });
    const assertion = expect(result).rejects.toBeInstanceOf(LlmTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(stage === "repair" ? 2 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up deadlines after success and failure", async () => {
    vi.useFakeTimers();
    const { client } = setup('{"count":1}', "{}", "{}");
    await client.completeJson(opts);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.completeJson(opts)).rejects.toBeInstanceOf(LlmValidationError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, Infinity, NaN, 2_147_483_648])(
    "rejects invalid duration %s",
    async (timeoutMs) => {
      const { client, transport } = setup();
      await expect(client.completeJson({ ...opts, timeoutMs })).rejects.toBeInstanceOf(RangeError);
      expect(transport).not.toHaveBeenCalled();
    },
  );
});
