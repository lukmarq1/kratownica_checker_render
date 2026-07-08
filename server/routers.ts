import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";

// --- IN-MEMORY STORE - DZIALA BEZ BAZY AIVEN ---
const attemptStore = new Map<string, { failedAttempts: number; lockedUntil: Date | null }>();
const historyStore: Array<{ ipAddress: string; angle: number; isCorrect: boolean; timestamp: Date; userAgent: string }> = [];

function getOrCreateRecord(ip: string) {
  let rec = attemptStore.get(ip);
  if (!rec) {
    rec = { failedAttempts: 0, lockedUntil: null };
    attemptStore.set(ip, rec);
  }
  // Jesli blokada wygasla - reset
  if (rec.lockedUntil && rec.lockedUntil.getTime() < Date.now()) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
  }
  return {
    ipAddress: ip,
    failedAttempts: rec.failedAttempts,
    lockedUntil: rec.lockedUntil,
    id: ip,
  };
}

async function isIpLocked(ip: string) {
  const rec = attemptStore.get(ip);
  if (!rec ||!rec.lockedUntil) return false;
  if (rec.lockedUntil.getTime() < Date.now()) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
    return false;
  }
  return true;
}

async function getRemainingLockoutTime(ip: string) {
  const rec = attemptStore.get(ip);
  if (!rec ||!rec.lockedUntil) return 0;
  const remaining = rec.lockedUntil.getTime() - Date.now();
  return remaining > 0? remaining : 0;
}

async function recordFailedAttempt(ip: string) {
  let rec = attemptStore.get(ip);
  if (!rec) {
    rec = { failedAttempts: 0, lockedUntil: null };
    attemptStore.set(ip, rec);
  }
  rec.failedAttempts += 1;
  let isLocked = false;
  let lockedUntil: Date | null = null;
  if (rec.failedAttempts >= 3) {
    isLocked = true;
    lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    rec.lockedUntil = lockedUntil;
  }
  return {
    remainingAttempts: Math.max(0, 3 - rec.failedAttempts),
    isLocked,
    lockedUntil,
  };
}

async function resetAttempts(ip: string) {
  const rec = attemptStore.get(ip);
  if (rec) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
  } else {
    attemptStore.set(ip, { failedAttempts: 0, lockedUntil: null });
  }
}

async function recordAttemptHistory(ip: string, angle: number, isCorrect: boolean) {
  historyStore.unshift({
    ipAddress: ip,
    angle,
    isCorrect,
    timestamp: new Date(),
    userAgent: "in-memory",
  });
  if (historyStore.length > 200) historyStore.pop();
}

async function getAllAttempts(limit: number, offset: number) {
  return historyStore.slice(offset, offset + limit);
}

async function getAdminStats() {
  return {
    totalAttempts: historyStore.length,
    successfulAttempts: historyStore.filter((h) => h.isCorrect).length,
    failedAttempts: historyStore.filter((h) =>!h.isCorrect).length,
    uniqueIPs: attemptStore.size,
    lockedIPs: Array.from(attemptStore.values()).filter((r) => r.lockedUntil && r.lockedUntil.getTime() > Date.now()).length,
  };
}

async function unlockIp(ip: string) {
  attemptStore.delete(ip);
}

function getClientIp(req: any): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  let ip = "unknown";
  if (xForwardedFor) {
    const ips = Array.isArray(xForwardedFor)? xForwardedFor : xForwardedFor.split(",");
    const firstIp = (ips[0] || "").trim();
    if (firstIp && firstIp!== "unknown") ip = firstIp;
  }
  if (ip === "unknown" && req.ip && req.ip!== "unknown") {
    ip = req.ip;
  }
  if (ip === "unknown") {
    const ua = req.headers["user-agent"] || "";
    ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 16)}`;
  }
  return ip;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(() => null),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, {...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  angle: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const ipAddress = getClientIp(ctx.req);
      const locked = await isIpLocked(ipAddress);
      const remainingMs = locked? await getRemainingLockoutTime(ipAddress) : 0;
      const record = getOrCreateRecord(ipAddress);
      return {
        isLocked: locked,
        failedAttempts: record.failedAttempts || 0,
        remainingAttempts: Math.max(0, 3 - (record.failedAttempts || 0)),
        remainingLockoutMs: remainingMs,
      };
    }),

    verify: publicProcedure
     .input(
        z.object({
          angle: z.number().min(0).max(360),
          browser: z.string().optional(),
        })
      )
     .mutation(async ({ input, ctx }) => {
        const ipAddress = getClientIp(ctx.req);

        const isLockedNow = await isIpLocked(ipAddress);
        if (isLockedNow) {
          const remainingMs = await getRemainingLockoutTime(ipAddress);
          return {
            success: false,
            reason: "locked",
            remainingLockoutMs: remainingMs,
          };
        }

        const correctAngle = 65;
        const tolerance = 0.5;
        const isCorrect = input.angle >= correctAngle - tolerance && input.angle <= correctAngle + tolerance;

        const record = getOrCreateRecord(ipAddress);
        const attemptNumber = (record.failedAttempts || 0) + 1;

        if (isCorrect) {
          await resetAttempts(ipAddress);
          await recordAttemptHistory(ipAddress, input.angle, true);
          return {
            success: true,
            reason: "correct",
            angle: input.angle,
          };
        } else {
          const result = await recordFailedAttempt(ipAddress);
          await recordAttemptHistory(ipAddress, input.angle, false);
          return {
            success: false,
            reason: "incorrect",
            remainingAttempts: result.remainingAttempts,
            isLocked: result.isLocked,
            lockedUntil: result.lockedUntil,
            remainingLockoutMs: result.isLocked? (result.lockedUntil?.getTime() || 0) - Date.now() : 0,
          };
        }
      }),
  }),

  admin: router({
    getAttempts: publicProcedure
     .input(z.object({ limit: z.number().default(100), offset: z.number().default(0) }))
     .query(async ({ input }) => {
        return await getAllAttempts(input.limit, input.offset);
      }),
    getStats: publicProcedure.query(async () => {
      return await getAdminStats();
    }),
    getAdvancedAnalytics: publicProcedure.query(async () => {
      return await getAdminStats();
    }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string() })).query(async () => {
      return null;
    }),
    exportData: publicProcedure.query(async () => {
      return historyStore;
    }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string() })).mutation(async ({ input }) => {
      await unlockIp(input.ipAddress);
      return { success: true, ipAddress: input.ipAddress };
    }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => {
      const adminPin = ENV.adminPin;
      if (!adminPin) {
        return { success: false, error: "Admin PIN not configured" };
      }
      const isValid = input.pin === adminPin;
      return { success: isValid };
    }),
    getLockedIPs: publicProcedure.query(async () => {
      const locked: string[] = [];
      for (const [ip, rec] of attemptStore.entries()) {
        if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) {
          locked.push(ip);
        }
      }
      return locked;
    }),
  }),
});

export type AppRouter = typeof appRouter;