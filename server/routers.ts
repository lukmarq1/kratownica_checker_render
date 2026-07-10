// server/routers.ts - FINAL DB FIX dla Aiven + poprawne liczenie prób
// Naprawia: Pozostało prób 0 vs AKTYWNY 2 oraz pustą historię w adminie
import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./_core/db";
import { attemptHistory, lockKeys } from "../drizzle/schema";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import { systemRouter } from "./_core/systemRouter";
import { ENV } from "./_core/env";

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const CORRECT_ANGLE = 65;
const ANGLE_TOLERANCE = 2;

function getClientIp(req: any): string {
  const xff = req.headers["x-forwarded-for"];
  let ip = "unknown";
  if (xff) {
    const ips = Array.isArray(xff) ? xff : String(xff).split(",");
    const first = (ips[0] || "").trim();
    if (first && first !== "unknown") ip = first;
  }
  if (ip === "unknown" && req.ip && req.ip !== "unknown") ip = req.ip;
  if (ip === "unknown") {
    const ua = req.headers["user-agent"] || "";
    ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 8)}`;
  }
  return ip;
}

function dbOrNull() {
  try {
    const db = getDb();
    if (!db) {
      console.log("[routers] DB null -> in-memory fallback (should not happen after fix)");
      return null;
    }
    return db;
  } catch (e) {
    console.error("[routers] getDb error", e);
    return null;
  }
}

async function fetchGeo(ip: string) {
  if (!ip || ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal } as any);
    clearTimeout(t);
    if (!res.ok) return null;
    const d: any = await res.json();
    if (!d.success) return null;
    return {
      country: d.country || "Unknown",
      city: d.city || "Unknown",
      zip: d.postal || "",
      timezone: d.timezone?.id || "",
      isp: d.connection?.isp || "",
      org: d.connection?.org || "",
      as: d.connection?.asn ? `AS${d.connection.asn} ${d.connection?.org || ""}` : "",
      latitude: String(d.latitude || ""),
      longitude: String(d.longitude || ""),
    };
  } catch {
    return null;
  }
}

async function getLockRecord(db: any, key: string) {
  if (!key) return null;
  try {
    const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1);
    return rows[0] || null;
  } catch (e) {
    console.error("[getLockRecord] error", e);
    return null;
  }
}

async function checkAnyLocked(db: any, keys: string[]) {
  for (const k of keys) {
    if (!k) continue;
    const rec = await getLockRecord(db, k);
    if (rec && rec.lockedUntil) {
      const until = new Date(rec.lockedUntil).getTime();
      if (until > Date.now()) return { locked: true, until, key: k, rec };
    }
  }
  return { locked: false, until: 0 };
}

async function getMaxFailed(db: any, keys: string[]) {
  let maxFailed = 0;
  for (const k of keys) {
    if (!k) continue;
    const rec = await getLockRecord(db, k);
    if (rec?.failedAttempts && rec.failedAttempts > maxFailed) maxFailed = rec.failedAttempts;
  }
  return maxFailed;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }: any) => ctx.user || null),
    logout: publicProcedure.mutation(async ({ ctx }: any) => {
      return { success: true };
    }),
  }),

  angle: router({
    status: publicProcedure
      .input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() }).optional())
      .query(async ({ input, ctx }: any) => {
        const req: any = ctx?.req;
        const ip = req ? getClientIp(req) : "unknown";
        const fingerprint = input?.fingerprint;
        const deviceId = input?.deviceId;
        const keys = [fingerprint, deviceId, ip].filter(Boolean) as string[];

        const db = dbOrNull();
        if (!db) {
          return { isLocked: false, locked: false, remainingAttempts: MAX_ATTEMPTS, attemptsLeft: MAX_ATTEMPTS, remainingLockoutMs: 0, remainingMs: 0 };
        }

        const lockCheck = await checkAnyLocked(db, keys);
        if (lockCheck.locked) {
          return {
            isLocked: true,
            locked: true,
            remainingAttempts: 0,
            attemptsLeft: 0,
            remainingLockoutMs: Math.max(0, lockCheck.until - Date.now()),
            remainingMs: Math.max(0, lockCheck.until - Date.now()),
          };
        }

        const failed = await getMaxFailed(db, keys);
        const remaining = Math.max(0, MAX_ATTEMPTS - failed);
        return {
          isLocked: false,
          locked: false,
          remainingAttempts: remaining,
          attemptsLeft: remaining,
          remainingLockoutMs: 0,
          remainingMs: 0,
        };
      }),

    verify: publicProcedure
      .input(
        z.object({
          angle: z.number().min(0).max(360),
          fingerprint: z.string().optional(),
          deviceId: z.string().optional(),
          browser: z.any().optional(),
        })
      )
      .mutation(async ({ input, ctx }: any) => {
        const req: any = ctx?.req;
        const ip = getClientIp(req);
        const ua = req?.headers?.["user-agent"] || "";
        const parsedUA = parseUserAgent(ua);
        const fingerprint = input.fingerprint || "unknown";
        const deviceId = input.deviceId || "unknown";
        const keys = [fingerprint, deviceId, ip].filter(Boolean) as string[];
        const primaryKey = fingerprint !== "unknown" ? fingerprint : deviceId !== "unknown" ? deviceId : ip;

        const db = dbOrNull();
        if (!db) {
          // fallback in-memory - should not happen now
          const isCorrect = Math.abs(input.angle - CORRECT_ANGLE) <= ANGLE_TOLERANCE;
          return { success: isCorrect, reason: isCorrect ? "ok" : "incorrect", remainingAttempts: isCorrect ? MAX_ATTEMPTS : MAX_ATTEMPTS - 1 };
        }

        // 1. Check lock
        const lockCheck = await checkAnyLocked(db, keys);
        if (lockCheck.locked) {
          const geo = await fetchGeo(ip);
          try {
            await db.insert(attemptHistory).values({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              ipAddress: ip,
              fingerprint,
              deviceId,
              angle: input.angle,
              isCorrect: 0,
              country: geo?.country || "Unknown",
              city: geo?.city || "Unknown",
              zip: geo?.zip || "",
              timezone: geo?.timezone || "",
              isp: geo?.isp || "",
              org: geo?.org || "",
              as: geo?.as || "",
              latitude: geo?.latitude || "",
              longitude: geo?.longitude || "",
              browserFamily: parsedUA?.browserFamily || "Unknown",
              osFamily: parsedUA?.osFamily || "Unknown",
              deviceType: parsedUA?.deviceType || "desktop",
              userAgent: ua,
              isVpn: 0,
              createdAt: new Date(),
            } as any);
          } catch (e) {
            console.error("[verify] history insert failed on locked", e);
          }
          return {
            success: false,
            reason: "locked" as const,
            remainingAttempts: 0,
            remainingLockoutMs: Math.max(0, lockCheck.until - Date.now()),
          };
        }

        const isCorrect = Math.abs(input.angle - CORRECT_ANGLE) <= ANGLE_TOLERANCE;
        const geo = await fetchGeo(ip);

        // 2. Always add history - with minimal fields first to avoid schema mismatch
        try {
          await db.insert(attemptHistory).values({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            ipAddress: ip,
            fingerprint,
            deviceId,
            angle: input.angle,
            isCorrect: isCorrect ? 1 : 0,
            country: geo?.country || "Unknown",
            city: geo?.city || "Unknown",
            zip: geo?.zip || "",
            timezone: geo?.timezone || "",
            isp: geo?.isp || "",
            org: geo?.org || "",
            as: geo?.as || "",
            latitude: geo?.latitude || "",
            longitude: geo?.longitude || "",
            browserFamily: parsedUA?.browserFamily || "Unknown",
            osFamily: parsedUA?.osFamily || "Unknown",
            deviceType: parsedUA?.deviceType || "desktop",
            userAgent: ua,
            isVpn: 0,
            createdAt: new Date(),
          } as any);
          console.log("[verify] history inserted", { ip, fingerprint: fingerprint.slice(0, 8), angle: input.angle, isCorrect });
        } catch (e: any) {
          console.error("[verify] history insert FAILED", e?.message, e);
          // Try minimal insert without geo fields
          try {
            await db.insert(attemptHistory).values({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              ipAddress: ip,
              fingerprint,
              deviceId,
              angle: input.angle,
              isCorrect: isCorrect ? 1 : 0,
              country: "Unknown",
              city: "Unknown",
              createdAt: new Date(),
            } as any);
            console.log("[verify] minimal history insert ok");
          } catch (e2) {
            console.error("[verify] minimal insert also failed", e2);
          }
        }

        if (isCorrect) {
          // Reset all keys on success
          try {
            for (const k of keys) {
              await db.delete(lockKeys).where(eq(lockKeys.id, k));
            }
            console.log("[verify] reset locks for", keys);
          } catch (e) {
            console.error("[verify] reset failed", e);
          }
          return { success: true, reason: "ok" as const };
        } else {
          // Record failed attempt
          try {
            const existing = await getLockRecord(db, primaryKey);
            const prevFailed = existing?.failedAttempts || 0;
            const newFailed = prevFailed + 1;
            let lockedUntil: Date | null = null;
            let isLockedNow = false;

            if (newFailed >= MAX_ATTEMPTS) {
              lockedUntil = new Date(Date.now() + LOCKOUT_MS);
              isLockedNow = true;
            }

            // Upsert lockKeys - only 3 columns to avoid schema mismatch
            try {
              await db
                .insert(lockKeys)
                .values({
                  id: primaryKey,
                  failedAttempts: newFailed,
                  lockedUntil: lockedUntil || new Date(Date.now() + 60 * 1000),
                } as any)
                .onDuplicateKeyUpdate({
                  set: {
                    failedAttempts: newFailed,
                    lockedUntil: lockedUntil || new Date(Date.now() + 60 * 1000),
                  } as any,
                });
            } catch (upsertErr: any) {
              console.error("[recordFailed] upsert failed, trying delete+insert", upsertErr?.message);
              await db.delete(lockKeys).where(eq(lockKeys.id, primaryKey));
              await db.insert(lockKeys).values({
                id: primaryKey,
                failedAttempts: newFailed,
                lockedUntil: lockedUntil || new Date(Date.now() + 60 * 1000),
              } as any);
            }

            console.log("[verify] failed attempt recorded", { primaryKey: primaryKey.slice(0, 8), newFailed, isLockedNow });

            return {
              success: false,
              reason: isLockedNow ? ("locked" as const) : ("incorrect" as const),
              remainingAttempts: Math.max(0, MAX_ATTEMPTS - newFailed),
              remainingLockoutMs: isLockedNow && lockedUntil ? lockedUntil.getTime() - Date.now() : 0,
            };
          } catch (e) {
            console.error("[verify] recordFailed error", e);
            return { success: false, reason: "incorrect" as const, remainingAttempts: 0 };
          }
        }
      }),
  }),

  admin: router({
    getAttempts: publicProcedure
      .input(z.object({ limit: z.number().optional(), offset: z.number().optional() }).optional())
      .query(async ({ input }: any) => {
        const db = dbOrNull();
        if (!db) return [];
        try {
          const limit = input?.limit || 100;
          const offset = input?.offset || 0;
          const rows = await db.select().from(attemptHistory).orderBy(desc(attemptHistory.createdAt)).limit(limit).offset(offset);
          console.log("[admin.getAttempts] rows", rows.length);
          return rows;
        } catch (e) {
          console.error("[admin.getAttempts] failed", e);
          return [];
        }
      }),

    getLockedIPs: publicProcedure.query(async () => {
      const db = dbOrNull();
      if (!db) return [];
      try {
        const rows = await db.select().from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
        const ids = rows.map((r: any) => r.id);
        console.log("[admin.getLockedIPs] locked", ids.length);
        return ids;
      } catch (e) {
        console.error("[admin.getLockedIPs] failed", e);
        return [];
      }
    }),

    getStats: publicProcedure.query(async () => {
      const db = dbOrNull();
      if (!db) return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0, lockedIPs: 0, successRate: 0, repeatedOffenders: 0, vpnAttempts: 0 };
      try {
        const totalRows = await db.select({ count: sql<number>`count(*)` }).from(attemptHistory);
        const total = Number(totalRows[0]?.count || 0);
        const okRows = await db.select({ count: sql<number>`count(*)` }).from(attemptHistory).where(eq(attemptHistory.isCorrect, 1));
        const ok = Number(okRows[0]?.count || 0);
        const lockedRows = await db.select({ count: sql<number>`count(*)` }).from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
        const locked = Number(lockedRows[0]?.count || 0);
        const uniqRows = await db.select({ count: sql<number>`count(distinct ${attemptHistory.ipAddress})` }).from(attemptHistory);
        const uniq = Number(uniqRows[0]?.count || 0);
        return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: total - ok, currentlyLockedIps: locked, lockedIPs: locked, successRate: total ? Math.round((ok / total) * 100) : 0, repeatedOffenders: 0, vpnAttempts: 0 };
      } catch (e) {
        console.error("[getStats] failed", e);
        return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0, lockedIPs: 0, successRate: 0, repeatedOffenders: 0, vpnAttempts: 0 };
      }
    }),

    getAdvancedAnalytics: publicProcedure.query(async () => {
      const db = dbOrNull();
      if (!db) return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, successRate: "0", repeatOffenders: [], geographicDistribution: [], deviceDistribution: [], vpnAttempts: 0 };
      try {
        const rows = await db.select().from(attemptHistory).limit(1000);
        const total = rows.length;
        const ok = rows.filter((r: any) => r.isCorrect === 1).length;
        const byCountry: Record<string, number> = {};
        rows.forEach((r: any) => { byCountry[r.country || "Unknown"] = (byCountry[r.country || "Unknown"] || 0) + 1; });
        const geoDist = Object.entries(byCountry).map(([country, count]) => ({ country, count }));
        const byDevice: Record<string, number> = {};
        rows.forEach((r: any) => { byDevice[r.deviceType || "desktop"] = (byDevice[r.deviceType || "desktop"] || 0) + 1; });
        const devDist = Object.entries(byDevice).map(([deviceType, count]) => ({ deviceType, count }));
        return { totalAttempts: total, uniqueIps: new Set(rows.map((r: any) => r.ipAddress)).size, uniqueIPs: new Set(rows.map((r: any) => r.ipAddress)).size, successfulAttempts: ok, failedAttempts: total - ok, successRate: total ? String(Math.round((ok / total) * 100)) : "0", repeatOffenders: [], geographicDistribution: geoDist, deviceDistribution: devDist, vpnAttempts: 0 };
      } catch (e) {
        console.error("[getAdvancedAnalytics] failed", e);
        return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, successRate: "0", repeatOffenders: [], geographicDistribution: [], deviceDistribution: [], vpnAttempts: 0 };
      }
    }),

    unlockIp: publicProcedure
      .input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() }))
      .mutation(async ({ input }: any) => {
        const db = dbOrNull();
        if (!db) return { success: false, message: "No DB" };
        const keys = [input.fingerprint, input.deviceId, input.ipAddress].filter(Boolean) as string[];
        if (!keys.length) return { success: false, message: "Brak ID" };
        let deleted = 0;
        try {
          for (const k of keys) {
            await db.delete(lockKeys).where(eq(lockKeys.id, k));
            deleted++;
            // Also try to delete related fingerprint/ip combos from history's lockKeys if they exist
            // Find history entries matching this key to clean related
            const related = await db.select().from(attemptHistory).where(sql`${attemptHistory.fingerprint} = ${k} OR ${attemptHistory.ipAddress} = ${k} OR ${attemptHistory.deviceId} = ${k}`).limit(20);
            for (const r of related as any[]) {
              if (r.fingerprint && r.fingerprint !== k) { await db.delete(lockKeys).where(eq(lockKeys.id, r.fingerprint)).catch(() => {}); }
              if (r.ipAddress && r.ipAddress !== k) { await db.delete(lockKeys).where(eq(lockKeys.id, r.ipAddress)).catch(() => {}); }
            }
          }
          console.log("[unlockIp] deleted", deleted, keys);
          return { success: true, deletedCount: deleted, deletedKeys: keys };
        } catch (e: any) {
          console.error("[unlockIp] failed", e);
          return { success: false, message: e?.message };
        }
      }),

    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }: any) => {
      const adminPin = ENV.adminPin;
      if (!adminPin) return { success: false, error: "Admin PIN not configured" };
      return { success: input.pin === adminPin };
    }),
  }),
});

export type AppRouter = typeof appRouter;
