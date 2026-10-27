import { describe, expect, it } from "vitest";
import { schemaFixtures } from "../fixtures/index.js";

describe("fixtures round-trip against their schemas", () => {
  for (const { name, schema, value } of schemaFixtures) {
    it(`${name} parses and round-trips`, () => {
      const parsed = schema.parse(value);
      expect(parsed).toEqual(value);
      // parse(parse(x)) === parse(x) — schemas must be idempotent, not just permissive once.
      expect(schema.parse(parsed)).toEqual(parsed);
    });
  }

  it("covers more than a token number of schemas", () => {
    expect(schemaFixtures.length).toBeGreaterThanOrEqual(15);
  });
});
