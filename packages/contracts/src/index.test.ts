import { describe, expect, it } from "vitest";
import { CONTRACTS_PACKAGE_NAME } from "./index.js";

describe("@tollgate/contracts placeholder", () => {
  it("exports a package name", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@tollgate/contracts");
  });
});
