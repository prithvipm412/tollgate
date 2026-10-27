import { describe, expect, it } from "vitest";
import { DASHBOARD_APP_NAME } from "./index.js";

describe("@tollgate/dashboard placeholder", () => {
  it("exports an app name", () => {
    expect(DASHBOARD_APP_NAME).toBe("@tollgate/dashboard");
  });
});
