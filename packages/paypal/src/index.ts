import type { PayPalClient } from "@tollgate/contracts";

export class PayPalError extends Error {
  readonly code = "PAYPAL_ERROR";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export interface PayPalOptions {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
type Input<K extends keyof PayPalClient> = Parameters<PayPalClient[K]>[0];
type Resource = { id: string; status: string; links?: { rel: string; href: string }[] };

/** Sandbox only: callers cannot accidentally select the live money endpoint. */
export function createPayPalClient(options: PayPalOptions): PayPalClient {
  const base = "https://api-m.sandbox.paypal.com";
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let token: { value: string; expires: number } | undefined;
  let fetching: Promise<string> | undefined;
  async function request(path: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(base + path, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new PayPalError("PayPal transport failed");
      }
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.arrayBuffer();
        await sleep(100 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new PayPalError("PayPal request failed", response.status);
      const body = await response.text();
      try {
        return body ? (JSON.parse(body) as unknown) : undefined;
      } catch {
        throw new PayPalError("Invalid PayPal response");
      }
    }
  }
  async function accessToken(): Promise<string> {
    if (token && token.expires > now()) return token.value;
    if (!fetching)
      fetching = (async () => {
        const started = now();
        const result = (await request("/v1/oauth2/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        })) as { access_token?: string; expires_in?: number };
        if (
          !result?.access_token ||
          typeof result.expires_in !== "number" ||
          result.expires_in <= 0
        )
          throw new PayPalError("Invalid OAuth response");
        token = {
          value: result.access_token,
          expires: started + result.expires_in * 1000 - 30_000,
        };
        return token.value;
      })();
    try {
      return await fetching;
    } finally {
      fetching = undefined;
    }
  }
  async function api<T>(
    path: string,
    body?: unknown,
    actionId?: string,
    method = "POST",
  ): Promise<T> {
    return (await request(path, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(actionId ? { "PayPal-Request-Id": actionId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })) as T;
  }
  const amount = (value: Input<"createOrder">["amount"]) => ({
    currency_code: value.currency,
    value: value.value,
  });
  function resource(result: Resource): Resource {
    if (!result?.id || !result.status) throw new PayPalError("Incomplete PayPal resource");
    return result;
  }
  return {
    async createPayout(input) {
      if (input.recipient.type === "capture_id")
        throw new PayPalError("A payout requires an email or PayPal payer ID");
      const created = await api<{ batch_header: { payout_batch_id: string } }>(
        "/v1/payments/payouts",
        {
          sender_batch_header: { sender_batch_id: input.action_id },
          items: [
            {
              sender_item_id: input.action_id,
              recipient_type: input.recipient.type === "email" ? "EMAIL" : "PAYPAL_ID",
              receiver: input.recipient.value,
              amount: input.amount,
            },
          ],
        },
        input.action_id,
      );
      if (!created?.batch_header?.payout_batch_id) throw new PayPalError("Missing payout batch ID");
      const detail = await api<{ items: { payout_item_id: string; transaction_status: string }[] }>(
        `/v1/payments/payouts/${encodeURIComponent(created.batch_header.payout_batch_id)}`,
        undefined,
        undefined,
        "GET",
      );
      const item = detail?.items?.[0];
      if (!item?.payout_item_id || !item.transaction_status)
        throw new PayPalError("Missing payout item");
      return { payout_item_id: item.payout_item_id, status: item.transaction_status };
    },
    async refundCapture(input) {
      const result = resource(
        await api<Resource>(
          `/v2/payments/captures/${encodeURIComponent(input.capture_id)}/refund`,
          input.amount ? { amount: amount(input.amount) } : {},
          input.action_id,
        ),
      );
      return { refund_id: result.id, status: result.status };
    },
    async createAndSendInvoice(input) {
      if (input.recipient.type !== "email")
        throw new PayPalError("Invoicing requires an email recipient");
      const result = resource(
        await api<Resource>(
          "/v2/invoicing/invoices",
          {
            detail: {
              currency_code: input.amount.currency,
              ...(input.memo ? { note: input.memo } : {}),
            },
            primary_recipients: [{ billing_info: { email_address: input.recipient.value } }],
            items: [{ name: "Payment", quantity: "1", unit_amount: amount(input.amount) }],
          },
          input.action_id,
        ),
      );
      await api(
        `/v2/invoicing/invoices/${encodeURIComponent(result.id)}/send`,
        { send_to_recipient: true },
        input.action_id,
      );
      return { invoice_id: result.id, status: "SENT" };
    },
    async createOrder(input) {
      const result = resource(
        await api<Resource>(
          "/v2/checkout/orders",
          {
            intent: "CAPTURE",
            purchase_units: [{ amount: amount(input.amount) }],
          },
          input.action_id,
        ),
      );
      const approve = result.links?.find((link) => link.rel === "approve");
      return {
        order_id: result.id,
        status: result.status,
        ...(approve ? { approve_url: approve.href } : {}),
      };
    },
    async verifyWebhook(input) {
      try {
        const headers = Object.fromEntries(
          Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
        );
        const fields = [
          "auth-algo",
          "cert-url",
          "transmission-id",
          "transmission-sig",
          "transmission-time",
        ];
        if (!options.webhookId || fields.some((field) => !headers[`paypal-${field}`])) return false;
        const body: Record<string, unknown> = {
          webhook_id: options.webhookId,
          webhook_event: JSON.parse(input.body) as unknown,
        };
        for (const field of fields) body[field.replaceAll("-", "_")] = headers[`paypal-${field}`];
        const result = await api<{ verification_status: string }>(
          "/v1/notifications/verify-webhook-signature",
          body,
        );
        return result?.verification_status === "SUCCESS";
      } catch {
        return false;
      }
    },
  };
}
