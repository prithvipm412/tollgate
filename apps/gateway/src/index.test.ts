import { describe, expect, it } from "vitest";
import { GATEWAY_APP_NAME } from "./index.js";

describe("@tollgate/gateway placeholder", () => {
  it("exports an app name", () => {
    expect(GATEWAY_APP_NAME).toBe("@tollgate/gateway");
  });
});
