import type { LlmClient as LlmClientContract } from "@tollgate/contracts";
import { z } from "zod";

export class LlmTimeoutError extends Error {
  override name = "LlmTimeoutError";
  constructor(readonly timeoutMs: number) {
    super(`LLM completion exceeded ${timeoutMs}ms.`);
  }
}

export class LlmProviderError extends Error {
  override name = "LlmProviderError";
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LlmValidationError extends Error {
  override name = "LlmValidationError";
  constructor(readonly validationError: z.ZodError) {
    super("LLM response remained invalid after one repair attempt.", { cause: validationError });
  }
}

export interface LlmClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injection point for offline tests; production defaults to global fetch. */
  fetch?: typeof fetch;
}

const CompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
type Message = { role: "system" | "user" | "assistant"; content: string };

/** OpenAI-compatible transport. Configuration is supplied by the caller. */
export class LlmClient implements LlmClientContract {
  constructor(private readonly options: LlmClientOptions) {}

  async completeJson<T>({
    system,
    user,
    schema,
    timeoutMs,
  }: Parameters<LlmClientContract["completeJson"]>[0] & { schema: z.ZodType<T> }): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new RangeError("timeoutMs must be a positive timer-safe duration.");
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new LlmTimeoutError(timeoutMs));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.complete(schema, system, user, controller.signal), deadline]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private async complete<T>(
    schema: z.ZodType<T>,
    system: string,
    user: string,
    signal: AbortSignal,
  ): Promise<T> {
    const messages: Message[] = [
      { role: "system", content: `${system}\nReturn only a JSON object, without Markdown fences.` },
      { role: "user", content: user },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      let content: string;
      try {
        const response = await (this.options.fetch ?? fetch)(
          `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.options.model,
              response_format: { type: "json_object" },
              messages,
            }),
            signal,
          },
        );
        if (!response.ok)
          throw new LlmProviderError(
            `LLM provider returned HTTP ${response.status}.`,
            response.status,
          );
        content = CompletionSchema.parse(await response.json()).choices[0]!.message.content;
      } catch (error) {
        if (error instanceof LlmProviderError) throw error;
        throw new LlmProviderError(
          "LLM provider request or completion envelope failed.",
          undefined,
          { cause: error },
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        const error = new z.ZodError([
          { code: "custom", path: [], message: "Response must be valid JSON." },
        ]);
        if (attempt === 1) throw new LlmValidationError(error);
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content: `Correct the JSON response. Validation error: ${error.message}`,
          },
        );
        continue;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      if (attempt === 1) throw new LlmValidationError(result.error);
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `Return corrected JSON matching the requested schema. Zod validation error: ${result.error.message}`,
        },
      );
    }
    throw new LlmProviderError("LLM completion did not produce a result.");
  }
}
