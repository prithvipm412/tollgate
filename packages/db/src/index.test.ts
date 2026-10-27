import { describe, expect, it } from "vitest";
import { DB_PACKAGE_NAME } from "./index.js";

describe("@tollgate/db placeholder", () => {
  it("exports a package name", () => {
    expect(DB_PACKAGE_NAME).toBe("@tollgate/db");
  });
});
