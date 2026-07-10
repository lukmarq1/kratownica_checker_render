import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import crypto from "crypto";
import * as store from "./lockStore";

// ULTIMATE HARDENED + PERSISTENT: WiFi + 24h pamięć + INSTANT VPN BAN + DB-backed
//
// Cała logika blokad/liczników trzyma się teraz w MySQL (patrz lockStore.ts /
// tabela `lock_keys`), więc przetrwa restart serwera i działa spójnie nawet
// jeśli appka kiedyś pojedzie na kilku instancjach. Tylko krótkotrwały cache
// geolokalizacji (`geoCache`) zostaje w pamięci procesu — to nie jest dane
// bezpieczeństwa, tylko optymalizacja liczby zapytań do ipwho.is.

const MAX_ATTEMPTS = 2;
const MAX_SUBNET_ATTEMPTS = 3;
const MAX_GEO_ATTEMPTS = 4;
const MAX_ASN_ATTEMPTS = 6;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const REPEAT_OFFENDER_LOCKOUT_MS = LOCKOUT_MS * 3;
const VPN_DETECTION_WINDOW_MS = 60 * 60 * 1000;
const RECENT_LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

const geoCache = new Map<string, any>();

function getSubnet(ip: string): string | null {
  if (!ip || ip === "unknown" || ip.startsWith("fallback")) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    if (parts.length < 4) return null;
    return `v6:${parts.slice(0, 4).join(":")}::/56`;
  }
  const p = ip.split(".");
  if (p.length !== 4) return null;
  return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}
function getGeoKey(geo: any): string | null {
  if (!geo) return null;
  const city = (geo.city || "unknown").trim();
  const isp = (geo.isp || geo.org || "unknown").trim();
  if (!city || city === "Unknown") return null;
  return `geo:${city}-${isp}`.slice(0, 80);
}
function getAsnKey(geo: any): string | null {
  if (!geo?.as) return null;
  const m = String(geo.as).match(/AS\d+/);
  return m ? `asn:${m[0]}` : null;
}
function getMaxForKey(key: string): number {
  if (key.startsWith("asn:")) return MAX_ASN_ATTEMPTS;
  if (key.startsWith("geo:")) return MAX_GEO_ATTEMPTS;
  if (key.includes("/24") || key.startsWith("v6:")) return MAX_SUBNET_ATTEMPTS;
  return MAX_ATTEMPTS;
}
function lockoutDurationFor(isRepeatedOffender: boolean): number {
  return isRepeatedOffender ? REPEAT_OFFENDER_LOCKOUT_MS : LOCKOUT_MS;
}

async function fetchGeo(ip: string) {
  if (ip.startsWith("fallback") || ip === "unknown" || ip.startsWith("192.168") || ip.startsWith("127.") || ip.startsWith("10.")) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 2000);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: c.signal } as any); clearTimeout(t);
    if (!res.ok) return null; const d = await res.json(); if (!d.success) return null;
    const g = { country: d.country || "Unknown", city: d.city || "Unknown", zip: d.postal || "", timezone: d.timezone?.id || "", isp: d.connection?.isp || "", org: d.connection?.org || "", as: d.connection?.asn ? `AS${d.connection.asn} ${d.connection?.org || ""}` : "", latitude: String(d.latitude || ""), longitude: String(d.longitude || ""), isHosting: d.connection?.hosting || false, isProxy: d.security?.is_proxy || d.security?.is_vpn || d.security?.is_tor || false, isVpnFlag: d.security?.is_vpn || false };
    geoCache.set(ip, g); return g;
  } catch { return null; }
}

async function detectVpnUsage(fp: string, curIp: string, curGeo: any): Promise<boolean> {
  if (!fp) return !!(curGeo?.isHosting || curGeo?.isProxy);
  const recent = await store.getRecentByFingerprint(fp, VPN_DETECTION_WINDOW_MS);
  if (recent.length === 0) return !!(curGeo?.isHosting || curGeo?.isProxy);
  const diffIp = recent.some(h => h.ipAddress !== curIp);
  const diffCountry = curGeo && recent.some(h => h.country !== curGeo.country);
  return !!(diffIp || diffCountry || curGeo?.isHosting || curGeo?.isProxy);
}

function getClientIp(req: any): string {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return Array.isArray(cf) ? cf[0] : cf;
  const trustedHops = ENV.trustedProxyHops; // ustaw TRUSTED_PROXY_HOPS w env, jeśli topologia proxy się zmieni
  const xff = req.headers["x-forwarded-for"];
  if (xff && trustedHops > 0) {
    const list = (Array.isArray(xff) ? xff.join(",") : xff).split(",").map((s: string) => s.trim()).filter(Boolean);
    const idx = list.length - trustedHops;
    if (idx >= 0 && list[idx]) return list[idx];
  }
  if (req.ip && req.ip !== "unknown") return req.ip;
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  const ua = req.headers["user-agent"] || "";
  return `fallback-${Buffer.from(ua).toString("base64").slice(0, 8)}`;
}
function getDeviceId(req: any): string { const c = req.headers.cookie || ""; const m = c.match(/device_id=([^;]+)/); return m ? m[1] : ""; }
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) { crypto.timingSafeEqual(bufA, bufA); return false; }
  return crypto.timingSafeEqual(bufA, bufB);
}
function sanitizeLockResponse(base: Record<string, any>) {
  const { blockedBy, allBlockedBy, ...safe } = base;
  return safe;
}

async function handleGetStatus(ctx: any, input: any) {
  const ip = getClientIp(ctx.req); let deviceId = input.deviceId || getDeviceId(ctx.req); const fingerprint = input.fingerprint || "";
  const subnet = getSubnet(ip); const geo = await fetchGeo(ip); const geoKey = getGeoKey(geo);
  const asnKey = (geo?.isHosting || geo?.isProxy || geo?.isVpnFlag) ? getAsnKey(geo) : null;
  const baseKeys = [fingerprint, deviceId, ip, subnet, geoKey, asnKey].filter(Boolean) as string[];
  const linkedKeys = await store.getRecentLinkedKeys(fingerprint, deviceId, RECENT_LINK_WINDOW_MS);
  const keysToCheck = Array.from(new Set([...baseKeys, ...linkedKeys]));
  for (const k of keysToCheck) {
    if (await store.isLocked(k)) {
      const remaining = await store.getRemainingLockoutTime(k);
      return sanitizeLockResponse({ isLocked: true, locked: true, remainingLockoutMs: remaining, remainingMs: remaining, blockedBy: k, remainingAttempts: 0, attemptsLeft: 0, maxAttempts: MAX_ATTEMPTS });
    }
  }
  const primary = fingerprint || deviceId || ip;
  const rec = primary ? await store.getRecord(primary) : null;
  const failed = rec?.failedAttempts || 0;
  const left = Math.max(0, MAX_ATTEMPTS - failed);
  return { isLocked: false, locked: false, failedAttempts: failed, remainingAttempts: left, attemptsLeft: left, remainingLockoutMs: 0, remainingMs: 0, maxAttempts: MAX_ATTEMPTS };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async ({ ctx }) => (ctx as any).user || null),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const o = getSessionCookieOptions((ctx.req as any));
      if ((ctx.res as any).clearCookie) (ctx.res as any).clearCookie(COOKIE_NAME, { ...o, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  angle: router({
    getStatus: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => handleGetStatus(ctx, input)),
    status: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => handleGetStatus(ctx, input)),
    verify: publicProcedure.input(z.object({ angle: z.number(), fingerprint: z.string().optional(), deviceId: z.string().optional(), browser: z.string().optional(), os: z.string().optional() })).mutation(async ({ ctx, input }) => {
      (ctx as any).user = { id: 1, openId: "public-user", name: "Gość", email: "guest@example.com", loginMethod: "public", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;
      const ip = getClientIp(ctx.req); let deviceId = getDeviceId(ctx.req);
      if (!deviceId) { deviceId = crypto.randomUUID(); if ((ctx.res as any).cookie) (ctx.res as any).cookie('device_id', deviceId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }); }
      const fingerprint = input.fingerprint || ""; const subnet = getSubnet(ip);
      const ua = ctx.req.headers["user-agent"] || "unknown"; const parsed = parseUserAgent(ua); if (input.browser) parsed.browserFamily = input.browser as any;
      const geo = await fetchGeo(ip); const geoKey = getGeoKey(geo);
      const isInstantVpnBan = !!(geo?.isHosting || geo?.isProxy || geo?.isVpnFlag);
      const asnKey = isInstantVpnBan ? getAsnKey(geo) : null;

      if (isInstantVpnBan) {
        const banKeys = [fingerprint, deviceId, ip, subnet, geoKey, asnKey].filter(Boolean) as string[];
        const linkedKeys = await store.getRecentLinkedKeys(fingerprint, deviceId, RECENT_LINK_WINDOW_MS);
        const allBanKeys = Array.from(new Set([...banKeys, ...linkedKeys]));
        for (const k of allBanKeys) {
          await store.forceLock(k, ip, fingerprint, getMaxForKey(k), new Date(Date.now() + lockoutDurationFor(true)));
        }
        await store.addHistory({ ip, fingerprint, deviceId, angle: input.angle, isCorrect: false, userAgent: ua, parsed, geo, isVpn: true });
        return sanitizeLockResponse({ success: false, reason: "vpn_detected", isVpn: true, isLocked: true, locked: true, remainingAttempts: 0, remaining: 0, remainingLockoutMs: LOCKOUT_MS, blockedBy: ip, message: `VPN/Proxy/Hosting wykryty - blokada 24h` });
      }

      const baseKeys = [fingerprint, deviceId, ip, subnet, geoKey].filter(Boolean) as string[];
      const linkedKeys = await store.getRecentLinkedKeys(fingerprint, deviceId, RECENT_LINK_WINDOW_MS);
      const keysToCheck = Array.from(new Set([...baseKeys, ...linkedKeys]));
      for (const k of keysToCheck) {
        if (await store.isLocked(k)) {
          const remaining = await store.getRemainingLockoutTime(k);
          return sanitizeLockResponse({ success: false, reason: "locked", remainingLockoutMs: remaining, blockedBy: k });
        }
      }

      const correctAngle = 65; const tol = 0.5; const isCorrect = input.angle >= correctAngle - tol && input.angle <= correctAngle + tol;
      const isVpn = await detectVpnUsage(fingerprint, ip, geo);
      await store.addHistory({ ip, fingerprint, deviceId, angle: input.angle, isCorrect, userAgent: ua, parsed, geo, isVpn });

      if (isCorrect) {
        await store.resetAttempts(keysToCheck, ip, fingerprint);
        return { success: true, reason: "correct", angle: input.angle };
      } else {
        const all: Array<{ key: string; r: { remainingAttempts: number; isLocked: boolean; lockedUntil: Date | null } }> = [];
        for (const k of keysToCheck) {
          const r = await store.recordFailedAttempt(k, ip, fingerprint, getMaxForKey(k), lockoutDurationFor);
          all.push({ key: k, r });
        }
        const locked = all.filter(x => x.r.isLocked);
        if (locked.length > 0) {
          const first = locked[0];
          return sanitizeLockResponse({ success: false, reason: "locked", remainingAttempts: 0, remaining: 0, isLocked: true, locked: true, lockedUntil: first.r.lockedUntil, remainingLockoutMs: first.r.lockedUntil ? first.r.lockedUntil.getTime() - Date.now() : LOCKOUT_MS, isVpn, blockedBy: first.key, allBlockedBy: locked.map(x => x.key) });
        }
        const min = Math.min(...all.map(x => x.r.remainingAttempts));
        return { success: false, reason: isVpn ? "vpn_detected" : "incorrect", remainingAttempts: min, remaining: min, isLocked: false, locked: false, isVpn };
      }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => store.getAllHistory(input.limit, input.offset)),
    getStats: publicProcedure.query(async () => {
      const history = await store.getAllHistory(5000, 0);
      const total = history.length;
      const ok = history.filter((h: any) => h.isCorrect === 1).length;
      const fail = total - ok;
      const uniq = await store.countDistinctKeys();
      const locked = await store.countLockedNow();
      const repeatedOffenders = await store.countRepeatedOffenders();
      const vpn = history.filter((h: any) => h.isVpn === 1).length;
      return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: fail, currentlyLockedIps: locked, lockedIPs: locked, successRate: total ? Math.round((ok / total) * 100) : 0, repeatedOffenders, vpnAttempts: vpn };
    }),
    getAdvancedAnalytics: publicProcedure.query(async () => {
      const history: any[] = await store.getAllHistory(5000, 0);
      const total = history.length; const ok = history.filter(h => h.isCorrect === 1).length; const fail = total - ok;
      const uniq = await store.countDistinctKeys();
      const byCountry: Record<string, number> = {}; history.forEach(h => { const c = h.country || "Unknown"; byCountry[c] = (byCountry[c] || 0) + 1; }); const geoDist = Object.entries(byCountry).map(([country, count]) => ({ country, count }));
      const byDevice: Record<string, number> = {}; history.forEach(h => { const d = h.deviceType || "Unknown"; byDevice[d] = (byDevice[d] || 0) + 1; }); const devDist = Object.entries(byDevice).map(([deviceType, count]) => ({ deviceType, count }));
      const failedMap: Record<string, { total: number; fail: number; country: string; ips: string[]; isVpn: boolean }> = {};
      history.forEach(h => {
        const k = h.fingerprint || h.deviceId || h.ipAddress;
        if (!failedMap[k]) failedMap[k] = { total: 0, fail: 0, country: h.country || "Unknown", ips: [], isVpn: false };
        failedMap[k].total++;
        if (h.isCorrect === 0) failedMap[k].fail++;
        if (!failedMap[k].ips.includes(h.ipAddress)) failedMap[k].ips.push(h.ipAddress);
        if (h.isVpn) failedMap[k].isVpn = true;
      });
      const repeat = Object.entries(failedMap).filter(([_, v]) => v.fail >= 2 || v.ips.length > 1).map(([id, v], idx) => ({ id: String(idx), ipAddress: v.ips.join(', '), fingerprint: id, country: v.country, totalAttempts: v.total, failedAttempts: v.fail, isVpn: v.isVpn, ips: v.ips }));
      return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: fail, successRate: total ? String(Math.round((ok / total) * 100)) : "0", repeatOffenders: repeat, geographicDistribution: geoDist, deviceDistribution: devDist, vpnAttempts: history.filter(h => h.isVpn).length };
    }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ input }) => {
      const key = input.fingerprint || input.deviceId || input.ipAddress; if (!key) return null;
      const all: any[] = await store.getAllHistory(5000, 0);
      const history = all.filter(h => h.fingerprint === key || h.deviceId === key || h.ipAddress === key);
      if (!history.length) return null;
      const first = history[0];
      return { country: first.country, city: first.city, isp: first.isp, deviceType: first.deviceType, org: first.org, zip: first.zip, timezone: first.timezone, as: first.as, fingerprint: first.fingerprint, deviceId: first.deviceId, ips: Array.from(new Set(history.map(h => h.ipAddress))), isVpn: history.some(h => h.isVpn), attempts: history.map(h => ({ id: h.id, angle: h.angle, isCorrect: h.isCorrect, createdAt: h.createdAt, ip: h.ipAddress, isVpn: h.isVpn })) };
    }),
    exportData: publicProcedure.query(async () => {
      const history: any[] = await store.getAllHistory(5000, 0);
      const headers = ["ID", "IP", "Fingerprint", "DeviceID", "Kat", "Poprawny", "Data", "Przegladarka", "OS", "Miasto", "Kraj", "VPN"];
      const rows = history.map(h => [h.id, h.ipAddress, h.fingerprint, h.deviceId, String(h.angle), h.isCorrect ? "TAK" : "NIE", h.createdAt?.toISOString?.() ?? String(h.createdAt), h.browserFamily, h.osFamily, h.city, h.country, h.isVpn ? "TAK" : "NIE"]);
      return [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional(), subnet: z.string().optional(), geoKey: z.string().optional() })).mutation(async ({ input }) => {
      const initial = [input.fingerprint, input.deviceId, input.ipAddress, input.subnet, input.geoKey].filter(Boolean) as string[];
      if (initial.length === 0) return { success: false, message: "Brak ID" };
      if (input.ipAddress) { const s = getSubnet(input.ipAddress); if (s) initial.push(s); }
      const toDel = await store.findRelatedKeysFromHistory(initial);
      const deletedCount = await store.deleteKeys(toDel);
      return { success: true, deletedKeys: Array.from(toDel), deletedCount };
    }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => {
      const p = ENV.adminPin; if (!p) return { success: false, error: "Admin PIN not configured" };
      return { success: safeEqual(input.pin, p) };
    }),
    getLockedIPs: publicProcedure.query(async () => (await store.getLockedAll()).map(l => l.key)),
    getLockedAll: publicProcedure.query(async () => store.getLockedAll()),
  }),
});
export type AppRouter = typeof appRouter;
