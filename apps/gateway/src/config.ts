import { z } from "zod";
const text = z.string().trim().min(1);
const protocol = (value: string, allowed: string[]) => {
  try {
    return allowed.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const url = z
  .string()
  .url()
  .refine((value) => protocol(value, ["http:", "https:"]));
export const ConfigSchema = z.object({
  PAYPAL_CLIENT_ID: text,
  PAYPAL_CLIENT_SECRET: text,
  PAYPAL_ENV: z.literal("sandbox"),
  PAYPAL_WEBHOOK_ID: text,
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => protocol(value, ["postgres:", "postgresql:"])),
  LLM_BASE_URL: url,
  LLM_API_KEY: text,
  LLM_MODEL: text,
  NTFY_SERVER: url,
  NTFY_TOPIC: text,
  ADMIN_PASSWORD: text,
  SESSION_SECRET: z.string().min(32),
  APPROVAL_TOKEN_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: url,
  DASHBOARD_URL: url,
});
export type Config = z.infer<typeof ConfigSchema>;
export class ConfigError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super(
      `Invalid configuration: ${issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) throw new ConfigError(result.error.issues);
  return result.data;
}
