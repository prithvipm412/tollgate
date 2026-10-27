import { describe, expect, it } from "vitest";
import { GUARD_AI_PACKAGE_NAME } from "./index.js";

describe("@tollgate/guard-ai placeholder", () => {
  it("exports a package name", () => {
    expect(GUARD_AI_PACKAGE_NAME).toBe("@tollgate/guard-ai");
  });
});
