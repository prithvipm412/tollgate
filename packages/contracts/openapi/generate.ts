import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { stringify } from "yaml";
import { registry } from "./registry.js";

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Tollgate API",
    version: "1.0.0",
    description: "Firewall for AI agents moving money through PayPal. See docs/ARCHITECTURE.md and docs/CONTRACT.md.",
  },
  servers: [{ url: "http://localhost:4000", description: "Local gateway" }],
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "../../../docs/openapi.yaml");
writeFileSync(outPath, stringify(document, { aliasDuplicateObjects: false }));
console.log(`wrote ${outPath}`);
