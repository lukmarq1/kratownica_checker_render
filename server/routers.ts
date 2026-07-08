import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;

interface AttemptRecord {
  failedAttempts: number;
  lockedUntil: Date | null;
  firstSeen: Date;
  lastSeen: Date;
  totalAttempts: number;
  successfulAttempts: number;
}

interface HistoryEntry {
  id: string;
  ipAddress: string;
  angle: number;
  isCorrect: number;
  country: string;
  city: string;
  zip: string;
  timezone: string;
  isp: string;
  org: string;
  as: string;
  latitude: string;
  longitude: string;
  browserFamily: string;
  osFamily: string;
  deviceType: string;
  createdAt: Date;
  timestamp: Date;
  userAgent: string;
}

const attemptStore = new Map<string, AttemptRecord>();
const historyStore: HistoryEntry[] = [];
const geoCache = new Map<string, any>();

function getOrCreateRecord(ip: string) {
  let rec = attemptStore.get(ip);
  if (!rec) {
    rec = { failedAttempts: 0, lockedUntil: null, firstSeen: new Date(), lastSeen: new Date(), totalAttempts: 0, successfulAttempts: 0 };
    attemptStore.set(ip, rec);
  }
  if (rec.lockedUntil && rec.lockedUntil.getTime() < Date.now()) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
  }
  rec.lastSeen = new Date();
  return rec;
}

async function isIpLocked(ip: string) {
  const rec = attemptStore.get(ip);
  if (!rec?.lockedUntil) return false;
  if (rec.lockedUntil.getTime() < Date.now()) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
    return false;
  }
  return true;
}

async function getRemainingLockoutTime(ip: string) {
  const rec = attemptStore.get(ip);
  if (!rec?.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil.getTime() - Date.now());
}

async function recordFailedAttempt(ip: string) {
  const rec = getOrCreateRecord(ip);
  rec.failedAttempts += 1;
  rec.totalAttempts += 1;
  let isLocked = false;
  let lockedUntil: Date | null = null;
  if (rec.failedAttempts >= MAX_ATTEMPTS) {
    isLocked = true;
    lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    rec.lockedUntil = lockedUntil;
  }
  return { remainingAttempts: Math.max(0, MAX_ATTEMPTS - rec.failedAttempts), isLocked, lockedUntil };
}

async function resetAttempts(ip: string) {
  const rec = getOrCreateRecord(ip);
  rec.failedAttempts = 0;
  rec.lockedUntil = null;
  rec.successfulAttempts += 1;
  rec.totalAttempts += 1;
}

async function fetchGeo(ip: string) {
  if (ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  if (ip === "185.166.170.118") {
    const hardcoded = {
      country: "Poland", city: "Ostrołęka", zip: "07-410", timezone: "Europe/Warsaw",
      isp: "Ynet Management Pawel Skrodzki", org: "YNET MANAGEMENT PAWEL SKRODZKI",
      as: "AS57896 YNET MANAGEMENT PAWEL SKRODZKI", latitude: "53.0842", longitude: "21.5634"
    };
    geoCache.set(ip, hardcoded);
    return hardcoded;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal } as any);
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.success) return null;
    const g = {
      country: d.country || "Unknown",
      city: d.city || "Unknown",
      zip: d.postal || "",
      timezone: d.timezone?.id || "",
      isp: d.connection?.isp || "",
      org: d.connection?.org || "",
      as: d.connection?.asn? `AS${d.connection.asn} ${d.connection?.org || ""}` : "",
      latitude: String(d.latitude || ""),
      longitude: String(d.longitude || ""),
    };
    geoCache.set(ip, g);
    return g;
  } catch { return null; }
}

async function addHistory(ip: string, angle: number, correct: boolean, ua: string, parsedUA: any, geo: any) {
  const now = new Date();
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ipAddress: ip,
    angle,
    isCorrect: correct? 1 : 0,
    country: geo?.country || "Unknown",
    city: geo?.city || "Unknown",
    zip: geo?.zip || "",
    timezone: geo?.timezone || "",
    isp: geo?.isp || "",
    org: geo?.org || "",
    as: geo?.as || "",
    latitude: geo?.latitude || "",
    longitude: geo?.longitude || "",
    browserFamily: parsedUA?.browserFamily || parsedUA?.browser || "Unknown",
    osFamily: parsedUA?.osFamily || parsedUA?.os || "Unknown",
    deviceType: parsedUA?.deviceType || parsedUA?.device || "desktop",
    createdAt: now,
    timestamp: now,
    userAgent: ua,
  };
  historyStore.unshift(entry);
  if (historyStore.length > 1000) historyStore.pop();
}

function getClientIp(req: any): string {
  const xff = req.headers["x-forwarded-for"];
  let ip = "unknown";
  if (xff) {
    const ips = Array.isArray(xff)? xff : xff.split(",");
    const first = (ips[0] || "").trim();
    if (first && first!== "unknown") ip = first;
  }
  if (ip === "unknown" && req.ip && req.ip!== "unknown") ip = req.ip;
  if (ip === "unknown") {
    const ua = req.headers["user-agent"] || "";
    ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 8)}`;
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
      const ip = getClientIp(ctx.req);
      const locked = await isIpLocked(ip);
      const remainingMs = locked? await getRemainingLockoutTime(ip) : 0;
      const rec = getOrCreateRecord(ip);
      return {
        isLocked: locked,
        failedAttempts: rec.failedAttempts,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - rec.failedAttempts),
        remainingLockoutMs: remainingMs,
      };
    }),
    verify: publicProcedure.input(z.object({ angle: z.number().min(0).max(360), browser: z.string().optional() })).mutation(async ({ input, ctx }) => {
      (ctx as any).user = { id: 1, openId: "public-user", name: "Gość", email: "guest@example.com", loginMethod: "public", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;
      const ip = getClientIp(ctx.req);
      if (await isIpLocked(ip)) {
        return { success: false, reason: "locked", remainingLockoutMs: await getRemainingLockoutTime(ip) };
      }
      const correctAngle = 65;
      const tolerance = 0.5;
      const isCorrect = input.angle >= correctAngle - tolerance && input.angle <= correctAngle + tolerance;
      const ua = ctx.req.headers["user-agent"] || "unknown";
      const parsedUA = parseUserAgent(ua);
      if (input.browser) parsedUA.browserFamily = input.browser;
      const geo = await fetchGeo(ip);
      await addHistory(ip, input.angle, isCorrect, ua, parsedUA, geo);
      if (isCorrect) {
        await resetAttempts(ip);
        return { success: true, reason: "correct", angle: input.angle };
      } else {
        const r = await recordFailedAttempt(ip);
        return { success: false, reason: "incorrect", remainingAttempts: r.remainingAttempts, isLocked: r.isLocked, lockedUntil: r.lockedUntil, remainingLockoutMs: r.isLocked? (r.lockedUntil?.getTime() || 0) - Date.now() : 0 };
      }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => {
      return historyStore.slice(input.offset, input.offset + input.limit);
    }),
    getStats: publicProcedure.query(async () => {
      const total = historyStore.length;
      const ok = historyStore.filter(h => h.isCorrect === 1).length;
      const fail = total - ok;
      const uniq = attemptStore.size;
      const locked = Array.from(attemptStore.values()).filter(r => r.lockedUntil && r.lockedUntil.getTime() > Date.now()).length;
      return {
        totalAttempts: total,
        uniqueIps: uniq, uniqueIPs: uniq,
        successfulAttempts: ok, failedAttempts: fail,
        currentlyLockedIps: locked, lockedIPs: locked,
        successRate: total? Math.round((ok / total) * 100) : 0,
        repeatedOffenders: 0,
      };
    }),
    getAdvancedAnalytics: publicProcedure.query(async () => {
      const total = historyStore.length;
      const ok = historyStore.filter(h => h.isCorrect === 1).length;
      const fail = total - ok;
      const uniq = attemptStore.size;
      const byCountry: Record<string, number> = {};
      historyStore.forEach(h => { byCountry[h.country] = (byCountry[h.country] || 0) + 1; });
      const geoDist = Object.entries(byCountry).map(([country, count]) => ({ country, count }));
      const byDevice: Record<string, number> = {};
      historyStore.forEach(h => { byDevice[h.deviceType] = (byDevice[h.deviceType] || 0) + 1; });
      const devDist = Object.entries(byDevice).map(([deviceType, count]) => ({ deviceType, count }));
      const failedMap: Record<string, { total: number; fail: number; country: string }> = {};
      historyStore.forEach(h => {
        if (!failedMap[h.ipAddress]) failedMap[h.ipAddress] = { total: 0, fail: 0, country: h.country };
        failedMap[h.ipAddress].total++; if (h.isCorrect === 0) failedMap[h.ipAddress].fail++;
      });
      const repeat = Object.entries(failedMap).filter(([_, v]) => v.fail >= 2).map(([ipAddress, v], idx) => ({ id: String(idx), ipAddress, country: v.country, totalAttempts: v.total, failedAttempts: v.fail }));
      return {
        totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq,
        successfulAttempts: ok, failedAttempts: fail,
        successRate: total? String(Math.round((ok / total) * 100)) : "0",
        repeatOffenders: repeat, geographicDistribution: geoDist, deviceDistribution: devDist,
      };
    }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string() })).query(async ({ input }) => {
      const history = historyStore.filter(h => h.ipAddress === input.ipAddress);
      if (!history.length) return null;
      const first = history[0];
      return {
        country: first.country, city: first.city, isp: first.isp,
        deviceType: first.deviceType, org: first.org, zip: first.zip, timezone: first.timezone, as: first.as,
        attempts: history.map(h => ({ id: h.id, angle: h.angle, isCorrect: h.isCorrect, createdAt: h.createdAt })),
      };
    }),
    exportData: publicProcedure.query(async () => {
      const headers = ["ID","IP","Kat","Poprawny","Data","Przegladarka","OS","Miasto","Kraj"];
      const rows = historyStore.map(h => [h.id, h.ipAddress, String(h.angle), h.isCorrect? "TAK":"NIE", h.createdAt.toISOString(), h.browserFamily, h.osFamily, h.city, h.country]);
      return [headers.join(","),...rows.map(r => r.map(v=>`"${v}"`).join(","))].join("\n");
    }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string() })).mutation(async ({ input }) => {
      attemptStore.delete(input.ipAddress);
      return { success: true, ipAddress: input.ipAddress };
    }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => {
      const adminPin = ENV.adminPin;
      if (!adminPin) return { success: false, error: "Admin PIN not configured" };
      return { success: input.pin === adminPin };
    }),
    getLockedIPs: publicProcedure.query(async () => {
      const locked: string[] = [];
      for (const [ip, rec] of attemptStore.entries()) {
        if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) locked.push(ip);
      }
      return locked;
    }),
  }),
});
export type AppRouter = typeof appRouter;