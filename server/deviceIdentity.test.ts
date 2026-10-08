import { describe, expect, it } from "vitest";
import { createDeviceId, readSignedDeviceId, signDeviceId } from "./deviceIdentity";

describe("signed device identity", () => {
  it("round-trips a signed device id", () => {
    const id = createDeviceId();
    const token = signDeviceId(id, "test-secret");
    expect(readSignedDeviceId(token, "test-secret")).toBe(id);
  });

  it("rejects a tampered token and a different secret", () => {
    const token = signDeviceId("device-original-1234", "test-secret");
    expect(readSignedDeviceId(`${token}x`, "test-secret")).toBeNull();
    expect(readSignedDeviceId(token, "other-secret")).toBeNull();
  });
});
