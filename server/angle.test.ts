import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getOrCreateAttemptRecord,
  isIpLocked,
  getRemainingLockoutTime,
  recordFailedAttempt,
  resetAttempts,
} from "./db";

// Mock database for testing
const mockDb: Record<string, any> = {};

describe("Angle verification system", () => {
  beforeEach(() => {
    // Reset mock data before each test
    Object.keys(mockDb).forEach((key) => delete mockDb[key]);
  });

  describe("Attempt tracking", () => {
    it("should create a new attempt record for an IP", async () => {
      const testIp = "192.168.1.1";
      const record = await getOrCreateAttemptRecord(testIp);
      expect(record).toBeDefined();
      expect(record.ipAddress).toBe(testIp);
      expect(record.failedAttempts).toBe(0);
      expect(record.lockedUntil).toBeNull();
    });

    it("should return existing record for same IP", async () => {
      const testIp = "192.168.1.1";
      const record1 = await getOrCreateAttemptRecord(testIp);
      const record2 = await getOrCreateAttemptRecord(testIp);
      expect(record1.id).toBe(record2.id);
    });
  });

  describe("Failed attempts and lockout", () => {
    it("should increment failed attempts on first failure", async () => {
      const testIp = "192.168.1.2";
      const result = await recordFailedAttempt(testIp);
      expect(result.remainingAttempts).toBe(2);
      expect(result.isLocked).toBe(false);
    });

    it("should increment to 2 failed attempts", async () => {
      const testIp = "192.168.1.3";
      await recordFailedAttempt(testIp);
      const result = await recordFailedAttempt(testIp);
      expect(result.remainingAttempts).toBe(1);
      expect(result.isLocked).toBe(false);
    });

    it("should lock after 3 failed attempts", async () => {
      const testIp = "192.168.1.4";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      const result = await recordFailedAttempt(testIp);
      expect(result.remainingAttempts).toBe(0);
      expect(result.isLocked).toBe(true);
      expect(result.lockedUntil).toBeDefined();
    });

    it("should have 24-hour lockout duration", async () => {
      const testIp = "192.168.1.5";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      const result = await recordFailedAttempt(testIp);
      
      if (result.lockedUntil) {
        const now = new Date();
        const lockoutDuration = result.lockedUntil.getTime() - now.getTime();
        // Should be approximately 24 hours (86400000 ms)
        // Allow 1 minute tolerance for test execution time
        expect(lockoutDuration).toBeGreaterThan(86400000 - 60000);
        expect(lockoutDuration).toBeLessThanOrEqual(86400000);
      }
    });
  });

  describe("Lockout status", () => {
    it("should not be locked before 3 attempts", async () => {
      const testIp = "192.168.1.6";
      await recordFailedAttempt(testIp);
      const locked = await isIpLocked(testIp);
      expect(locked).toBe(false);
    });

    it("should be locked after 3 attempts", async () => {
      const testIp = "192.168.1.7";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      const locked = await isIpLocked(testIp);
      expect(locked).toBe(true);
    });

    it("should return remaining lockout time", async () => {
      const testIp = "192.168.1.8";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      
      const remainingMs = await getRemainingLockoutTime(testIp);
      expect(remainingMs).toBeGreaterThan(0);
      expect(remainingMs).toBeLessThanOrEqual(86400000);
    });
  });

  describe("Attempt reset", () => {
    it("should reset attempts on success", async () => {
      const testIp = "192.168.1.9";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      
      await resetAttempts(testIp);
      const record = await getOrCreateAttemptRecord(testIp);
      
      expect(record.failedAttempts).toBe(0);
      expect(record.lockedUntil).toBeNull();
    });

    it("should allow new attempts after reset", async () => {
      const testIp = "192.168.1.10";
      await recordFailedAttempt(testIp);
      await recordFailedAttempt(testIp);
      await resetAttempts(testIp);
      
      const result = await recordFailedAttempt(testIp);
      expect(result.remainingAttempts).toBe(2);
      expect(result.isLocked).toBe(false);
    });
  });

  describe("IP isolation", () => {
    it("should track attempts separately per IP", async () => {
      const ip1 = "192.168.1.11";
      const ip2 = "192.168.1.12";
      
      await recordFailedAttempt(ip1);
      await recordFailedAttempt(ip1);
      await recordFailedAttempt(ip2);
      
      const record1 = await getOrCreateAttemptRecord(ip1);
      const record2 = await getOrCreateAttemptRecord(ip2);
      
      expect(record1.failedAttempts).toBe(2);
      expect(record2.failedAttempts).toBe(1);
    });

    it("should not lock IP2 when IP1 is locked", async () => {
      const ip1 = "192.168.1.13";
      const ip2 = "192.168.1.14";
      
      // Lock IP1
      await recordFailedAttempt(ip1);
      await recordFailedAttempt(ip1);
      await recordFailedAttempt(ip1);
      
      const locked1 = await isIpLocked(ip1);
      const locked2 = await isIpLocked(ip2);
      
      expect(locked1).toBe(true);
      expect(locked2).toBe(false);
    });
  });
});
