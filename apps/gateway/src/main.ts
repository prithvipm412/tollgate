import postgres from "postgres";
import { createPayPalClient } from "@tollgate/paypal";
import { createPostgresStore } from "./postgres-store.js";
import { GatewayService } from "./service.js";
import { buildGateway, loadConfig } from "./index.js";
import type { AuthAgent } from "./index.js";
const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { connect_timeout: 3, max: 5 });
const service = new GatewayService(createPostgresStore(sql), config, {
  paypal: createPayPalClient({
    clientId: config.PAYPAL_CLIENT_ID,
    clientSecret: config.PAYPAL_CLIENT_SECRET,
    webhookId: config.PAYPAL_WEBHOOK_ID,
  }),
});
const app = buildGateway(
  config,
  {
    ping: () => sql`select 1`,
    async findAgentByKeyHash(hash) {
      const rows = await sql<
        AuthAgent[]
      >`select id, status from agents where key_hash = ${hash} limit 1`;
      return rows[0];
    },
    close: () => sql.end({ timeout: 3 }),
  },
  service,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: "0.0.0.0", port: Number(new URL(config.PUBLIC_BASE_URL).port || 4000) });
