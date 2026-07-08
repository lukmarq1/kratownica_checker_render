import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";

// ============ IN-MEMORY DATABASE - ZASTĘPUJE AIVEN ============
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
  isCorrect: boolean;
  timestamp: Date;
  userAgent: string;
  browser?: string;
  browserFamily?: string;
  os?: string;
  device?: string;
  country?: string;
  city?: string;
  attemptNumber: number;
  geo?: any;
}

const attemptStore = new Map<string, AttemptRecord>();
const historyStore: HistoryEntry[] = [];

function getOrCreateRecord(ip: string) {
  let rec = attemptStore.get(ip);
  if (!rec) {
    rec = {
      failedAttempts: 0,
      lockedUntil: null,
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalAttempts: 0,
      successfulAttempts: 0,
    };
    attemptStore.set(ip, rec);
  }
  if (rec.lockedUntil && rec.lockedUntil.getTime() < Date.now()) {
    rec.failedAttempts = 0;
    rec.lockedUntil = null;
  }
  rec.lastSeen = new Date();
  return {
    id: ip,
    ipAddress: ip,
    failedAttempts: rec.failedAttempts,
    lockedUntil: rec.lockedUntil,
    firstSeen: rec.firstSeen,
    lastSeen: rec.lastSeen,
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
    rec = {
      failedAttempts: 0,
      lockedUntil: null,
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalAttempts: 0,
      successfulAttempts: 0,
    };
    attemptStore.set(ip, rec);
  }
  rec.failedAttempts += 1;
  rec.totalAttempts += 1;
  rec.lastSeen = new Date();
  let isLocked = false;
  let lockedUntil: Date | null = null;
  if (rec.failedAttempts >= 3) {
    isLocked = true;
    lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    rec.lockedUntil = lockedUntil;
  }
  return { remainingAttempts: Math.max(0, 3 - rec.failedAttempts), isLocked, lockedUntil };
}

async function resetAttempts(ip: string) {
  let rec = attemptStore.get(ip);
  if (!rec) {
    rec = {
      failedAttempts: 0,
      lockedUntil: null,
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalAttempts: 0,
      successfulAttempts: 0,
    };
    attemptStore.set(ip, rec);
  }
  rec.failedAttempts = 0;
  rec.lockedUntil = null;
  rec.successfulAttempts += 1;
  rec.totalAttempts += 1;
  rec.lastSeen = new Date();
}

async function recordAttemptHistory(
  ip: string,
  angle: number,
  isCorrect: boolean,
  attemptNumber: number,
  userAgent: string,
  geoData?: any,
  parsedUA?: any
) {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ipAddress: ip,
    angle,
    isCorrect,
    timestamp: new Date(),
    userAgent,
    browser: parsedUA?.browser || parsedUA?.browserFamily,
    browserFamily: parsedUA?.browserFamily,
    os: parsedUA?.os,
    device: parsedUA?.device,
    country: geoData?.country_name || geoData?.country,
    city: geoData?.city,
    attemptNumber,
    geo: geoData,
  };
  historyStore.unshift(entry);
  if (historyStore.length > 1000) historyStore.pop();
}

async function getAllAttempts(limit: number, offset: number) {
  return historyStore.slice(offset, offset + limit);
}

async function getAdminStats() {
  const total = historyStore.length;
  const successful = historyStore.filter((h) => h.isCorrect).length;
  const failed = total - successful;
  const uniqueIPs = attemptStore.size;
  const locked = Array.from(attemptStore.values()).filter((r) => r.lockedUntil && r.lockedUntil.getTime() > Date.now()).length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayAttempts = historyStore.filter((h) => h.timestamp.getTime() >= today.getTime()).length;

  return {
    totalAttempts: total,
    successfulAttempts: successful,
    failedAttempts: failed,
    uniqueIPs,
    lockedIPs: locked,
    successRate: total > 0? (successful / total) * 100 : 0,
    todayAttempts,
    totalIPs: uniqueIPs,
  };
}

async function getAdvancedAnalytics() {
  const stats = await getAdminStats();

  // Attempts by hour
  const byHour: Record<number, number> = {};
  for (let i = 0; i < 24; i++) byHour[i] = 0;
  historyStore.forEach((h) => { byHour[h.timestamp.getHours()]++; });

  // Attempts by browser
  const byBrowser: Record<string, number> = {};
  historyStore.forEach((h) => {
    const b = h.browserFamily || h.browser || "Unknown";
    byBrowser[b] = (byBrowser[b] || 0) + 1;
  });

  // Attempts by OS
  const byOS: Record<string, number> = {};
  historyStore.forEach((h) => {
    const os = h.os || "Unknown";
    byOS[os] = (byOS[os] || 0) + 1;
  });

  // Top failed IPs
  const failedByIp: Record<string, number> = {};
  historyStore.filter(h =>!h.isCorrect).forEach(h => {
    failedByIp[h.ipAddress] = (failedByIp[h.ipAddress] || 0) + 1;
  });
  const topFailedIPs = Object.entries(failedByIp).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ip, count]) => ({ ip, count }));

  return {
   ...stats,
    attemptsByHour: byHour,
    attemptsByBrowser: byBrowser,
    attemptsByOS: byOS,
    topFailedIPs,
    recentAttempts: historyStore.slice(0, 20),
    attemptsByCountry: {},
  };
}

async function getUserProfileWithTracking(ipAddress: string) {
  const rec = attemptStore.get(ipAddress);
  const history = historyStore.filter((h) => h.ipAddress === ipAddress);
  if (!rec && history.length === 0) return null;

  return {
    ipAddress,
    totalAttempts: history.length,
    successfulAttempts: history.filter(h => h.isCorrect).length,
    failedAttempts: history.filter(h =>!h.isCorrect).length,
    firstSeen: rec?.firstSeen || history[history.length - 1]?.timestamp,
    lastSeen: rec?.lastSeen || history[0]?.timestamp,
    isLocked: rec?.lockedUntil? rec.lockedUntil.getTime() > Date.now() : false,
    lockedUntil: rec?.lockedUntil,
    failedAttemptsCount: rec?.failedAttempts || 0,
    history: history.slice(0, 50),
    browsers: [...new Set(history.map(h => h.browser).filter(Boolean))],
  };
}

async function exportAttemptDataAsCSV() {
  const headers = ["ID", "IP", "Kąt", "Poprawny", "Data", "Przeglądarka", "OS", "Miasto", "Kraj"];
  const rows = historyStore.map(h => [
    h.id,
    h.ipAddress,
    h.angle.toString(),
    h.isCorrect? "TAK" : "NIE",
    h.timestamp.toISOString(),
    h.browser || "",
    h.os || "",
    h.city || "",
    h.country || "",
  ]);
  const csv = [headers.join(","),...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
  return csv;
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
  if (ip === "unknown" && req.ip && req.ip!== "unknown") ip = req.ip;
  if (ip === "unknown") {
    const ua = req.headers["user-agent"] || "";
    ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 16)}`;
  }
  return ip;
}

async function fetchGeolocationSafe(ip: string) {
  // Bez zewnętrznego API żeby nie blokować - zwraca null, ale nie wiesza serwera
  // Jesli chcesz geo, mozna odkomentowac ponizej z timeoutem
  return null;
  /*
  if (ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.")) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: controller.signal } as any);
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  */
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
     .input(z.object({ angle: z.number().min(0).max(360), browser: z.string().optional() }))
     .mutation(async ({ input, ctx }) => {
        ctx.user = {
          id: 1, openId: "public-user", name: "Gość",
          email: "guest@example.com", loginMethod: "public", role: "user",
          createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
        } as any;

        const ipAddress = getClientIp(ctx.req);

        const isLockedNow = await isIpLocked(ipAddress);
        if (isLockedNow) {
          const remainingMs = await getRemainingLockoutTime(ipAddress);
          return { success: false, reason: "locked", remainingLockoutMs: remainingMs };
        }

        const correctAngle = 65;
        const tolerance = 0.5;
        const isCorrect = input.angle >= correctAngle - tolerance && input.angle <= correctAngle + tolerance;

        let geoData = null;
        try { geoData = await fetchGeolocationSafe(ipAddress); } catch {}

        const userAgent = ctx.req.headers["user-agent"] || "unknown";
        const parsedUA = parseUserAgent(userAgent);
        if (input.browser) parsedUA.browserFamily = input.browser;

        const record = getOrCreateRecord(ipAddress);
        const attemptNumber = (record.failedAttempts || 0) + 1;

        if (isCorrect) {
          await resetAttempts(ipAddress);
          await recordAttemptHistory(ipAddress, input.angle, true, attemptNumber, userAgent, geoData || undefined, parsedUA);
          return { success: true, reason: "correct", angle: input.angle };
        } else {
          const result = await recordFailedAttempt(ipAddress);
          await recordAttemptHistory(ipAddress, input.angle, false, attemptNumber, userAgent, geoData || undefined, parsedUA);
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
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => {
      return await getAllAttempts(input.limit, input.offset);
    }),
    getStats: publicProcedure.query(async () => { return await getAdminStats(); }),
    getAdvancedAnalytics: publicProcedure.query(async () => { return await getAdvancedAnalytics(); }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string() })).query(async ({ input }) => {
      return await getUserProfileWithTracking(input.ipAddress);
    }),
    exportData: publicProcedure.query(async () => { return await exportAttemptDataAsCSV(); }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string() })).mutation(async ({ input }) => {
      await unlockIp(input.ipAddress);
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