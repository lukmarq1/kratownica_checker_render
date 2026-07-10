import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import crypto from "crypto";
import * as store from "./lockStore";

const VPN_DETECTION_WINDOW_MS = 60 * 60 * 1000;
const geoCache = new Map<string, any>();

async function fetchGeo(ip: string) {
  if (ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const controller = new AbortController(); const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal } as any); clearTimeout(t);
    if (!res.ok) return null; const d = await res.json(); if (!d.success) return null;
    const g = { country: d.country || "Unknown", city: d.city || "Unknown", zip: d.postal || "", timezone: d.timezone?.id || "", isp: d.connection?.isp || "", org: d.connection?.org || "", as: d.connection?.asn? `AS${d.connection.asn} ${d.connection?.org || ""}` : "", latitude: String(d.latitude || ""), longitude: String(d.longitude || ""), isHosting: d.connection?.hosting || false, isProxy: d.security?.is_proxy || d.security?.is_vpn || false };
    geoCache.set(ip, g); return g;
  } catch { return null; }
}

function detectVpnUsage(fingerprint: string, currentIp: string, currentGeo: any, recentHistory: any[]): boolean {
  if (!fingerprint) return false;
  const recent = recentHistory.filter(h => h.fingerprint === fingerprint && Date.now() - new Date(h.createdAt).getTime() < VPN_DETECTION_WINDOW_MS);
  if (recent.length === 0) return currentGeo?.isHosting || currentGeo?.isProxy || false;
  const differentIp = recent.some((h: any) => h.ipAddress !== currentIp);
  const differentCountry = currentGeo && recent.some((h: any) => h.country !== currentGeo.country);
  return differentIp || differentCountry || currentGeo?.isHosting || currentGeo?.isProxy;
}

function getClientIp(req: any): string {
  const xff = req.headers["x-forwarded-for"]; let ip = "unknown";
  if (xff) { const ips = Array.isArray(xff)? xff : xff.split(","); const first = (ips[0] || "").trim(); if (first && first!== "unknown") ip = first; }
  if (ip === "unknown" && req.ip && req.ip!== "unknown") ip = req.ip;
  if (ip === "unknown") { const ua = req.headers["user-agent"] || ""; ip = `fallback-${Buffer.from(ua).toString("base64").slice(0, 8)}`; }
  return ip;
}
function getDeviceId(req: any): string {
  const cookies = req.headers.cookie || ""; const match = cookies.match(/device_id=([^;]+)/); return match? match[1] : "";
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async ({ ctx }) => { return (ctx as any).user || null; }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions((ctx.req as any));
      if ((ctx.res as any).clearCookie) (ctx.res as any).clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  angle: router({
    status: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req); let deviceId = input.deviceId || getDeviceId(ctx.req); const fingerprint = input.fingerprint || "";
      const primaryKey = fingerprint || deviceId || ip; const keysToCheck = Array.from(new Set([primaryKey, ip, deviceId, fingerprint].filter(Boolean))) as string[];
      for (const k of keysToCheck) { if (await store.isLocked(k)) return { isLocked: true, locked: true, remainingLockoutMs: await store.getRemainingLockoutTime(k), remainingMs: await store.getRemainingLockoutTime(k) }; }
      return { isLocked: false, locked: false, remainingAttempts: 2, attemptsLeft: 2, maxAttempts: 2 };
    }),
    verify: publicProcedure.input(z.object({ angle: z.number(), fingerprint: z.string().optional(), deviceId: z.string().optional(), browser: z.string().optional() })).mutation(async ({ ctx, input }) => {
      (ctx as any).user = { id: 1, openId: "public-user", name: "Gość", email: "guest@example.com", loginMethod: "public", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;
      const ip = getClientIp(ctx.req); let deviceId = getDeviceId(ctx.req);
      if (!deviceId) { deviceId = crypto.randomUUID(); if ((ctx.res as any).cookie) (ctx.res as any).cookie('device_id', deviceId, { maxAge: 365*24*60*60*1000, httpOnly: true, sameSite: 'lax', path: '/' }); }
      const fingerprint = input.fingerprint || ""; const primaryKey = fingerprint || deviceId || ip;
      const keysToCheck = Array.from(new Set([primaryKey, ip, deviceId, fingerprint].filter(Boolean))) as string[];

      for (const k of keysToCheck) { if (await store.isLocked(k)) { return { success: false, reason: "locked", remainingLockoutMs: await store.getRemainingLockoutTime(k) }; } }

      const correctAngle = 65; const tolerance = 0.5; const isCorrect = input.angle >= correctAngle - tolerance && input.angle <= correctAngle + tolerance;
      const ua = ctx.req.headers["user-agent"] || "unknown"; const parsedUA = parseUserAgent(ua);
      const geo = await fetchGeo(ip);
      const recent = await store.getAllHistory(50,0);
      const isVpn = detectVpnUsage(fingerprint, ip, geo, recent);

      await store.addHistory(ip, fingerprint, deviceId, input.angle, isCorrect, ua, parsedUA, geo, isVpn);

      if (isVpn) {
        for (const k of keysToCheck) await store.recordFailedAttempt(k, ip, fingerprint);
        // wymuś blokadę 24h dla wszystkich kluczy
        for (const k of keysToCheck) { await store.recordFailedAttempt(k, ip, fingerprint); }
        return { success: false, reason: "vpn_detected", remainingLockoutMs: 24*60*60*1000 };
      }

      if (isCorrect) { await store.resetAttempts(keysToCheck); return { success: true, reason: "correct", angle: input.angle }; }
      else {
        let lastResult: any = null;
        for (const k of keysToCheck) { lastResult = await store.recordFailedAttempt(k, ip, fingerprint); }
        return { success: false, reason: "incorrect", remainingAttempts: lastResult.remainingAttempts, isLocked: lastResult.isLocked, lockedUntil: lastResult.lockedUntil, remainingLockoutMs: lastResult.isLocked? (lastResult.lockedUntil?.getTime() || 0) - Date.now() : 0, isVpn: false };
      }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => {
      return await store.getAllHistory(input.limit, input.offset);
    }),
    getStats: publicProcedure.query(async () => { return await store.getStats(); }),
    getAdvancedAnalytics: publicProcedure.query(async () => {
      const history = await store.getAllHistory(1000,0);
      const total = history.length; const ok = history.filter((h:any)=>h.isCorrect===1).length;
      const byCountry: Record<string, number> = {}; history.forEach((h:any)=>{ byCountry[h.country]=(byCountry[h.country]||0)+1; });
      const byDevice: Record<string, number> = {}; history.forEach((h:any)=>{ byDevice[h.deviceType]=(byDevice[h.deviceType]||0)+1; });
      return {
        totalAttempts: total,
        uniqueIps: new Set(history.map((h:any)=>h.ipAddress)).size,
        uniqueIPs: new Set(history.map((h:any)=>h.ipAddress)).size,
        successfulAttempts: ok,
        failedAttempts: total-ok,
        successRate: total? String(Math.round((ok/total)*100)):"0",
        repeatOffenders: [],
        geographicDistribution: Object.entries(byCountry).map(([country,count])=>({country,count})),
        deviceDistribution: Object.entries(byDevice).map(([deviceType,count])=>({deviceType,count})),
        vpnAttempts: history.filter((h:any)=>h.isVpn===1).length
      };
    }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ input }) => {
      const key = input.fingerprint || input.deviceId || input.ipAddress; if (!key) return null;
      const history = await store.getAllHistory(1000,0);
      const filtered = history.filter((h:any)=>h.fingerprint===key || h.deviceId===key || h.ipAddress===key);
      if (!filtered.length) return null; const first:any = filtered[0];
      return { country: first.country, city: first.city, isp: first.isp, deviceType: first.deviceType, org: first.org, zip: first.zip, timezone: first.timezone, as: first.as, fingerprint: first.fingerprint, deviceId: first.deviceId, ips: Array.from(new Set(filtered.map((h:any)=>h.ipAddress))), isVpn: filtered.some((h:any)=>h.isVpn), attempts: filtered.map((h:any)=>({id:h.id, angle:h.angle, isCorrect:h.isCorrect, createdAt:h.createdAt, ip:h.ipAddress, isVpn:h.isVpn})) };
    }),
    exportData: publicProcedure.query(async () => {
      const history = await store.getAllHistory(1000,0);
      const headers = ["ID","IP","Fingerprint","DeviceID","Kat","Poprawny","Data","Przegladarka","OS","Miasto","Kraj","VPN"];
      const rows = history.map((h:any)=>[h.id, h.ipAddress, h.fingerprint, h.deviceId, String(h.angle), h.isCorrect?"TAK":"NIE", new Date(h.createdAt).toISOString(), h.browserFamily, h.osFamily, h.city, h.country, h.isVpn?"TAK":"NIE"]);
      return [headers.join(","),...rows.map(r=>r.map(v=>`"${v}"`).join(","))].join("\n");
    }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).mutation(async ({ input }) => {
      const keys = [input.fingerprint, input.deviceId, input.ipAddress].filter(Boolean) as string[];
      if (!keys.length) return { success: false, message: "Brak ID" };
      // znajdź powiązane w historii żeby odblokować wszystko
      const history = await store.getAllHistory(1000,0);
      const related = new Set<string>(keys);
      for (const h of history) {
        const anyH:any = h as any;
        if (keys.some(k=>k===anyH.ipAddress || k===anyH.fingerprint || k===anyH.deviceId)) {
          if (anyH.ipAddress) related.add(anyH.ipAddress);
          if (anyH.fingerprint && anyH.fingerprint!=="unknown") related.add(anyH.fingerprint);
          if (anyH.deviceId && anyH.deviceId!=="unknown") related.add(anyH.deviceId);
        }
      }
      const res = await store.unlockKeys(Array.from(related));
      return { success: true, deletedKeys: Array.from(related), deletedCount: res.deletedCount };
    }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => { const adminPin = ENV.adminPin; if (!adminPin) return { success: false, error: "Admin PIN not configured" }; return { success: input.pin === adminPin }; }),
    getLockedIPs: publicProcedure.query(async () => { return await store.getLockedAll(); }),
  }),
});
export type AppRouter = typeof appRouter;
