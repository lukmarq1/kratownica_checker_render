// server/routers.ts - WERSJA DB z POPRAWIONYMI importami
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import { getDb } from "./db";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { attemptHistory, lockKeys } from "../drizzle/schema";

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const VPN_DETECTION_WINDOW_MS = 60 * 60 * 1000;
const geoCache = new Map<string, any>();

function dbOrNull() {
  try { const db = getDb(); return db || null; } catch (e) { console.error("[Database] getDb error", e); return null; }
}
async function fetchGeo(ip: string) {
  if (!ip || ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const controller = new AbortController(); const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal } as any); clearTimeout(t);
    if (!res.ok) return null; const d = await res.json(); if (!d.success) return null;
    const g = { country: d.country || "Unknown", city: d.city || "Unknown", zip: d.postal || "", timezone: d.timezone?.id || "", isp: d.connection?.isp || "", org: d.connection?.org || "", as: d.connection?.asn? `AS${d.connection.asn} ${d.connection?.org || ""}` : "", latitude: String(d.latitude || ""), longitude: String(d.longitude || ""), isHosting: d.connection?.hosting || false, isProxy: d.security?.is_proxy || d.security?.is_vpn || false };
    geoCache.set(ip, g); return g;
  } catch { return null; }
}
function getClientIp(req: any): string {
  const xff = req.headers["x-forwarded-for"]; let ip = "unknown";
  if (xff) { const ips = Array.isArray(xff)? xff : xff.split(","); const first = (ips[0] || "").trim(); if (first && first!== "unknown") ip = first; }
  if (ip === "unknown" && req.ip && req.ip!== "unknown") ip = req.ip;
  if (ip === "unknown") { const ua = req.headers["user-agent"] || ""; ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 8)}`; }
  return ip;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async opts => {
      const { ctx } = opts; const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, cookieOptions); return { success: true } as const;
    }),
  }),
  angle: router({
    status: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() }).optional()).query(async ({ input }) => {
      const db = dbOrNull();
      const keys = [input?.fingerprint, input?.deviceId].filter(Boolean) as string[];
      if (keys.length === 0 ||!db) return { isLocked: false, locked: false, remainingAttempts: MAX_ATTEMPTS, remainingLockoutMs: 0, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS };
      try {
        for (const key of keys) {
          const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1);
          if (rows.length) {
            const until = new Date(rows[0].lockedUntil as any).getTime();
            if (until > Date.now()) return { isLocked: true, locked: true, remainingAttempts: 0, remainingLockoutMs: until - Date.now(), remainingMs: until - Date.now(), attemptsLeft: 0 };
            else await db.delete(lockKeys).where(eq(lockKeys.id, key));
          }
        }
        return { isLocked: false, locked: false, remainingAttempts: MAX_ATTEMPTS, remainingLockoutMs: 0, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS };
      } catch (e) { console.error("[status] DB error", e); return { isLocked: false, locked: false, remainingAttempts: MAX_ATTEMPTS, remainingLockoutMs: 0, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS }; }
    }),
    verify: publicProcedure.input(z.object({ angle: z.number(), browser: z.any().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).mutation(async ({ input, ctx }) => {
      const req: any = ctx.req; const ip = getClientIp(req); const ua = req.headers["user-agent"] || ""; const parsedUA = parseUserAgent(ua);
      const fingerprint = input.fingerprint || ""; const deviceId = input.deviceId || ""; const db = dbOrNull();
      const CORRECT_ANGLE = 65; const isCorrect = Math.abs(input.angle - CORRECT_ANGLE) <= 2;
      let geo = null; try { geo = await fetchGeo(ip); } catch {}
      let isVpn = false;
      if (fingerprint && db) {
        try {
          const oneHourAgo = new Date(Date.now() - VPN_DETECTION_WINDOW_MS);
          const recent = await db.select().from(attemptHistory).where(and(eq(attemptHistory.fingerprint, fingerprint), gt(attemptHistory.createdAt, oneHourAgo))).limit(10);
          if (recent.length > 0) { const diffIp = recent.some((r: any) => r.ipAddress!== ip); const diffCountry = geo && recent.some((r: any) => r.country!== geo.country); if (diffIp || diffCountry || geo?.isHosting || geo?.isProxy) isVpn = true; }
        } catch {}
      }
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, ipAddress: ip, fingerprint: fingerprint || "unknown", deviceId: deviceId || "unknown", angle: input.angle, isCorrect: isCorrect? 1 : 0, country: geo?.country || "Unknown", city: geo?.city || "Unknown", zip: geo?.zip || "", timezone: geo?.timezone || "", isp: geo?.isp || "", org: geo?.org || "", as: geo?.as || "", latitude: geo?.latitude || "", longitude: geo?.longitude || "", browserFamily: parsedUA?.browserFamily || parsedUA?.browser || "Unknown", osFamily: parsedUA?.osFamily || parsedUA?.os || "Unknown", deviceType: parsedUA?.deviceType || parsedUA?.device || "desktop", userAgent: ua, isVpn: isVpn? 1 : 0, createdAt: new Date(), };
      if (db) { try { await db.insert(attemptHistory).values(entry as any); } catch (e) { console.error("[verify] insert history failed", e); } }
      if (isCorrect) {
        if (db) { try { const keys = [fingerprint, deviceId, ip].filter(Boolean) as string[]; for (const k of keys) await db.delete(lockKeys).where(eq(lockKeys.id, k)); } catch {} }
        return { success: true };
      } else {
        if (!db) return { success: false, remainingAttempts: 1, reason: "incorrect" };
        try {
          const key = fingerprint || deviceId || ip; const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1); let failed = 1; if (rows.length) failed = (rows[0].failedAttempts || 0) + 1;
          if (failed >= MAX_ATTEMPTS) { const lockedUntil = new Date(Date.now() + LOCKOUT_MS); await db.insert(lockKeys).values({ id: key, lockedUntil, failedAttempts: failed, createdAt: new Date(), updatedAt: new Date() } as any).onDuplicateKeyUpdate({ set: { lockedUntil, failedAttempts: failed, updatedAt: new Date() } as any }); return { success: false, reason: isVpn? "vpn_detected" as const : "locked" as const, remainingLockoutMs: LOCKOUT_MS, remainingAttempts: 0 }; }
          else { const tmpUntil = new Date(Date.now() + 60000); await db.insert(lockKeys).values({ id: key, lockedUntil: tmpUntil, failedAttempts: failed, createdAt: new Date(), updatedAt: new Date() } as any).onDuplicateKeyUpdate({ set: { failedAttempts: failed, updatedAt: new Date() } as any }); return { success: false, remainingAttempts: MAX_ATTEMPTS - failed, reason: "incorrect" as const }; }
        } catch (e) { console.error("[verify] lock handling failed", e); return { success: false, remainingAttempts: 0, reason: "incorrect" }; }
      }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) }).optional()).query(async ({ input }) => { const db = dbOrNull(); if (!db) return []; try { const rows = await db.select().from(attemptHistory).orderBy(desc(attemptHistory.createdAt)).limit(input?.limit || 100).offset(input?.offset || 0); return rows; } catch (e) { console.error("[getAttempts] failed", e); return []; } }),
    getLockedIPs: publicProcedure.query(async () => { const db = dbOrNull(); if (!db) return []; try { const rows = await db.select({ id: lockKeys.id }).from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`); return rows.map((r: any) => r.id); } catch { return []; } }),
    getStats: publicProcedure.query(async () => { const db = dbOrNull(); if (!db) return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0, lockedIPs: 0, successRate: 0, repeatedOffenders: 0, vpnAttempts: 0 }; try { const totalRows = await db.select({ count: sql<number>`count(*)` }).from(attemptHistory); const total = Number(totalRows[0]?.count || 0); const okRows = await db.select({ count: sql<number>`count(*)` }).from(attemptHistory).where(eq(attemptHistory.isCorrect, 1)); const ok = Number(okRows[0]?.count || 0); const lockedRows = await db.select({ count: sql<number>`count(*)` }).from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`); const locked = Number(lockedRows[0]?.count || 0); const uniqRows = await db.select({ count: sql<number>`count(distinct ${attemptHistory.ipAddress})` }).from(attemptHistory); const uniq = Number(uniqRows[0]?.count || 0); const vpnRows = await db.select({ count: sql<number>`count(*)` }).from(attemptHistory).where(eq(attemptHistory.isVpn, 1)); const vpn = Number(vpnRows[0]?.count || 0); return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: total - ok, currentlyLockedIps: locked, lockedIPs: locked, successRate: total? Math.round((ok / total) * 100) : 0, repeatedOffenders: 0, vpnAttempts: vpn }; } catch (e) { console.error("[getStats] failed", e); return { totalAttempts: 0, uniqueIps: 0, uniqueIPs: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0, lockedIPs: 0, successRate: 0, repeatedOffenders: 0, vpnAttempts: 0 }; } }),
    getAdvancedAnalytics: publicProcedure.query(async () => { return { totalAttempts: 0, uniqueIps: 0, successfulAttempts: 0, failedAttempts: 0, successRate: "0", repeatOffenders: [], geographicDistribution: [], deviceDistribution: [], vpnAttempts: 0 }; }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async () => null),
    exportData: publicProcedure.query(async () => ""),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).mutation(async ({ input }) => { const db = dbOrNull(); if (!db) return { success: false }; const keys = [input.ipAddress, input.fingerprint, input.deviceId].filter(Boolean) as string[]; let deleted = 0; for (const k of keys) { try { await db.delete(lockKeys).where(eq(lockKeys.id, k)); deleted++; } catch {} } return { success: true, deletedCount: deleted, deletedKeys: keys }; }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => { const adminPin = ENV.adminPin; if (!adminPin) return { success: false, error: "Admin PIN not configured" }; return { success: input.pin === adminPin }; }),
  }),
});
export type AppRouter = typeof appRouter;