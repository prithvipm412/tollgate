import { describe, expect, it } from "vitest";
import { POLICY_PACKAGE_NAME } from "./index.js";

describe("@tollgate/policy placeholder", () => {
  it("exports a package name", () => {
    expect(POLICY_PACKAGE_NAME).toBe("@tollgate/policy");
  });
});
