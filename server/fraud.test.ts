import { describe, expect, it } from "vitest";
import { detectFraudAlerts } from "./fraudDetection";

const NOW = Date.parse("2026-10-06T16:00:00.000Z");

describe("fraud detection", () => {
  it("flags the same fingerprint switching IP and device within minutes", () => {
    const alerts = detectFraudAlerts([
      { id: 1, ip: "10.0.0.1", fingerprint: "fp-1", device_id: "phone-a", status: "fail", created_at: new Date(NOW - 90_000) },
      { id: 2, ip: "10.0.0.2", fingerprint: "fp-1", device_id: "phone-b", status: "fail", created_at: new Date(NOW - 30_000) },
      { id: 3, ip: "10.0.0.2", fingerprint: "fp-1", device_id: "phone-b", status: "locked", created_at: new Date(NOW - 10_000) },
    ], NOW);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("critical");
    expect(alerts[0].ips).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(alerts[0].devices).toEqual(["phone-a", "phone-b"]);
    expect(alerts[0].reasons.some((reason) => reason.includes("adresów IP"))).toBe(true);
  });

  it("does not flag a single normal attempt", () => {
    const alerts = detectFraudAlerts([
      { ip: "10.0.0.1", fingerprint: "fp-normal", device_id: "phone-a", status: "success", created_at: new Date(NOW - 30_000) },
    ], NOW);
    expect(alerts).toEqual([]);
  });
});
