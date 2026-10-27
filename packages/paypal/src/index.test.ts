import { describe, expect, it } from "vitest";
import { PAYPAL_PACKAGE_NAME } from "./index.js";

describe("@tollgate/paypal placeholder", () => {
  it("exports a package name", () => {
    expect(PAYPAL_PACKAGE_NAME).toBe("@tollgate/paypal");
  });
});
