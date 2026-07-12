import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { parseUserAgent } from "./userAgentParser";
import crypto from "crypto";

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const VPN_DETECTION_WINDOW_MS = 60 * 60 * 1000;

interface AttemptRecord {
  failedAttempts: number;
  lockedUntil: Date | null;
  firstSeen: Date;
  lastSeen: Date;
  totalAttempts: number;
  successfulAttempts: number;
  ips: Set<string>;
  fingerprints: Set<string>;
  isRepeatedOffender: boolean;
}

interface HistoryEntry {
  id: string;
  ipAddress: string;
  fingerprint: string;
  deviceId: string;
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
  isVpn: boolean;
}

const attemptStore = new Map<string, AttemptRecord>();
const historyStore: HistoryEntry[] = [];
const geoCache = new Map<string, any>();

// === BLOKADA ZAKRESU IP /24 ===
function isIPv4(ip: string){ return /^\d+\.\d+\.\d+\.\d+$/.test(ip); }
function getSubnet(ip: string){ if(!isIPv4(ip)) return ip; return ip.split(".").slice(0,3).join("."); }
function getSubnetKey(ip: string){ return `subnet:${getSubnet(ip)}`; }

function getOrCreateRecord(key: string) {
  let rec = attemptStore.get(key);
  if (!rec) {
    rec = { failedAttempts: 0, lockedUntil: null, firstSeen: new Date(), lastSeen: new Date(), totalAttempts: 0, successfulAttempts: 0, ips: new Set(), fingerprints: new Set(), isRepeatedOffender: false };
    attemptStore.set(key, rec);
  }
  if (rec.lockedUntil && rec.lockedUntil.getTime() < Date.now()) { rec.failedAttempts = 0; rec.lockedUntil = null; }
  rec.lastSeen = new Date();
  return rec;
}
async function isLocked(key: string) {
  const rec = attemptStore.get(key);
  if (!rec?.lockedUntil) return false;
  if (rec.lockedUntil.getTime() < Date.now()) { rec.failedAttempts = 0; rec.lockedUntil = null; return false; }
  return true;
}
async function getRemainingLockoutTime(key: string) {
  const rec = attemptStore.get(key);
  if (!rec?.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil.getTime() - Date.now());
}
async function recordFailedAttempt(key: string, ip: string, fingerprint?: string) {
  const rec = getOrCreateRecord(key);
  rec.failedAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip);
  if (fingerprint) rec.fingerprints.add(fingerprint);
  if (rec.ips.size > 1) rec.isRepeatedOffender = true;
  let isLockedNow = false; let lockedUntil: Date | null = null;
  if (rec.failedAttempts >= MAX_ATTEMPTS) { isLockedNow = true; lockedUntil = new Date(Date.now() + LOCKOUT_MS); rec.lockedUntil = lockedUntil; }
  return { remainingAttempts: Math.max(0, MAX_ATTEMPTS - rec.failedAttempts), isLocked: isLockedNow, lockedUntil };
}
async function resetAttempts(keys: string[], ip: string, fingerprint?: string) {
  for (const key of keys) {
    const rec = getOrCreateRecord(key);
    rec.failedAttempts = 0; rec.lockedUntil = null; rec.successfulAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip);
    if (fingerprint) rec.fingerprints.add(fingerprint);
  }
}
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
function detectVpnUsage(fingerprint: string, currentIp: string, currentGeo: any): boolean {
  if (!fingerprint) return false;
  const recent = historyStore.filter(h => h.fingerprint === fingerprint && Date.now() - h.createdAt.getTime() < VPN_DETECTION_WINDOW_MS);
  if (recent.length === 0) return false;
  const differentIp = recent.some(h => h.ipAddress!== currentIp);
  const differentCountry = currentGeo && recent.some(h => h.country!== currentGeo.country);
  return differentIp || differentCountry || currentGeo?.isHosting || currentGeo?.isProxy;
}
async function addHistory(ip: string, fingerprint: string, deviceId: string, angle: number, correct: boolean, ua: string, parsedUA: any, geo: any, isVpn: boolean) {
  const now = new Date();
  const entry: HistoryEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ipAddress: ip, fingerprint: fingerprint || "unknown", deviceId: deviceId || "unknown", angle, isCorrect: correct? 1 : 0, country: geo?.country || "Unknown", city: geo?.city || "Unknown", zip: geo?.zip || "", timezone: geo?.timezone || "", isp: geo?.isp || "", org: geo?.org || "", as: geo?.as || "", latitude: geo?.latitude || "", longitude: geo?.longitude || "", browserFamily: parsedUA?.browserFamily || parsedUA?.browser || "Unknown", osFamily: parsedUA?.osFamily || parsedUA?.os || "Unknown", deviceType: parsedUA?.deviceType || parsedUA?.device || "desktop", createdAt: now, timestamp: now, userAgent: ua, isVpn };
  historyStore.unshift(entry); if (historyStore.length > 1000) historyStore.pop();
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
      const subnetKey = getSubnetKey(ip);
      const primaryKey = fingerprint || deviceId || ip; const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, fingerprint].filter(Boolean))) as string[];
      for (const k of keysToCheck) { if (await isLocked(k)) { const ms = await getRemainingLockoutTime(k); return { isLocked: true, locked: true, remainingAttempts: 0, attemptsLeft: 0, remainingLockoutMs: ms, remainingMs: ms }; } }
      const rec = attemptStore.get(primaryKey); const attemptsLeft = rec? Math.max(0, MAX_ATTEMPTS - rec.failedAttempts) : MAX_ATTEMPTS;
      return { isLocked: false, locked: false, remainingAttempts: attemptsLeft, attemptsLeft, remainingLockoutMs: 0, remainingMs: 0, maxAttempts: MAX_ATTEMPTS };
    }),
    getStatus: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req); let deviceId = input.deviceId || getDeviceId(ctx.req); const fingerprint = input.fingerprint || "";
      const subnetKey = getSubnetKey(ip);
      const primaryKey = fingerprint || deviceId || ip; const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, fingerprint].filter(Boolean))) as string[];
      for (const k of keysToCheck) { if (await isLocked(k)) { const ms = await getRemainingLockoutTime(k); return { isLocked: true, locked: true, remainingAttempts: 0, attemptsLeft: 0, remainingLockoutMs: ms, remainingMs: ms }; } }
      const rec = attemptStore.get(primaryKey); const attemptsLeft = rec? Math.max(0, MAX_ATTEMPTS - rec.failedAttempts) : MAX_ATTEMPTS;
      return { isLocked: false, locked: false, remainingAttempts: attemptsLeft, attemptsLeft, remainingLockoutMs: 0, remainingMs: 0, maxAttempts: MAX_ATTEMPTS };
    }),
    verify: publicProcedure.input(z.object({ angle: z.number(), fingerprint: z.string().optional(), deviceId: z.string().optional(), browser: z.string().optional(), os: z.string().optional() })).mutation(async ({ ctx, input }) => {
      (ctx as any).user = { id: 1, openId: "public-user", name: "Gość", email: "guest@example.com", loginMethod: "public", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;
      const ip = getClientIp(ctx.req); let deviceId = getDeviceId(ctx.req);
      if (!deviceId) { deviceId = crypto.randomUUID(); if ((ctx.res as any).cookie) (ctx.res as any).cookie('device_id', deviceId, { maxAge: 365*24*60*60*1000, httpOnly: true, sameSite: 'lax', path: '/' }); }
      const fingerprint = input.fingerprint || ""; 
      const subnetKey = getSubnetKey(ip);
      const primaryKey = fingerprint || deviceId || ip;
      const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, fingerprint].filter(Boolean))) as string[];

      for (const k of keysToCheck) { if (await isLocked(k)) { return { success: false, reason: "locked", remainingLockoutMs: await getRemainingLockoutTime(k) }; } }

      const correctAngle = 65; const tolerance = 0.5; const isCorrect = input.angle >= correctAngle - tolerance && input.angle <= correctAngle + tolerance;
      const ua = ctx.req.headers["user-agent"] || "unknown"; const parsedUA = parseUserAgent(ua); if (input.browser) parsedUA.browserFamily = input.browser as any;
      const geo = await fetchGeo(ip); const isVpn = detectVpnUsage(fingerprint, ip, geo);
      await addHistory(ip, fingerprint, deviceId, input.angle, isCorrect, ua, parsedUA, geo, isVpn);

      if (isCorrect) { await resetAttempts(keysToCheck, ip, fingerprint); return { success: true, reason: "correct", angle: input.angle }; }
      else {
        let lastResult: any = null;
        for (const k of keysToCheck) { lastResult = await recordFailedAttempt(k, ip, fingerprint); }
        return { success: false, reason: isVpn? "vpn_detected" : "incorrect", remainingAttempts: lastResult.remainingAttempts, isLocked: lastResult.isLocked, lockedUntil: lastResult.lockedUntil, remainingLockoutMs: lastResult.isLocked? (lastResult.lockedUntil?.getTime() || 0) - Date.now() : 0, isVpn };
      }
    }),
  }),
  admin: router({
    getAttempts: publicProcedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => { return historyStore.slice(input.offset, input.offset + input.limit); }),
    getStats: publicProcedure.query(async () => {
      const total = historyStore.length; const ok = historyStore.filter(h => h.isCorrect === 1).length; const fail = total - ok; const uniq = attemptStore.size; const locked = Array.from(attemptStore.values()).filter(r => r.lockedUntil && r.lockedUntil.getTime() > Date.now()).length; const vpn = historyStore.filter(h => h.isVpn).length;
      return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: fail, currentlyLockedIps: locked, lockedIPs: locked, successRate: total? Math.round((ok / total) * 100) : 0, repeatedOffenders: Array.from(attemptStore.values()).filter(r => r.isRepeatedOffender).length, vpnAttempts: vpn };
    }),
    getAdvancedAnalytics: publicProcedure.query(async () => {
      const total = historyStore.length; const ok = historyStore.filter(h => h.isCorrect === 1).length; const fail = total - ok; const uniq = attemptStore.size;
      const byCountry: Record<string, number> = {}; historyStore.forEach(h => { byCountry[h.country] = (byCountry[h.country] || 0) + 1; }); const geoDist = Object.entries(byCountry).map(([country, count]) => ({ country, count }));
      const byDevice: Record<string, number> = {}; historyStore.forEach(h => { byDevice[h.deviceType] = (byDevice[h.deviceType] || 0) + 1; }); const devDist = Object.entries(byDevice).map(([deviceType, count]) => ({ deviceType, count }));
      const failedMap: Record<string, { total: number; fail: number; country: string; ips: string[]; isVpn: boolean }> = {};
      historyStore.forEach(h => { const k = h.fingerprint || h.deviceId || h.ipAddress; if (!failedMap[k]) failedMap[k] = { total: 0, fail: 0, country: h.country, ips: [], isVpn: false }; failedMap[k].total++; if (h.isCorrect === 0) failedMap[k].fail++; if (!failedMap[k].ips.includes(h.ipAddress)) failedMap[k].ips.push(h.ipAddress); if (h.isVpn) failedMap[k].isVpn = true; });
      const repeat = Object.entries(failedMap).filter(([_, v]) => v.fail >= 2 || v.ips.length > 1).map(([id, v], idx) => ({ id: String(idx), ipAddress: v.ips.join(', '), fingerprint: id, country: v.country, totalAttempts: v.total, failedAttempts: v.fail, isVpn: v.isVpn, ips: v.ips }));
      return { totalAttempts: total, uniqueIps: uniq, uniqueIPs: uniq, successfulAttempts: ok, failedAttempts: fail, successRate: total? String(Math.round((ok / total) * 100)) : "0", repeatOffenders: repeat, geographicDistribution: geoDist, deviceDistribution: devDist, vpnAttempts: historyStore.filter(h => h.isVpn).length };
    }),
    getUserProfile: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ input }) => {
      const key = input.fingerprint || input.deviceId || input.ipAddress; if (!key) return null; const history = historyStore.filter(h => h.fingerprint === key || h.deviceId === key || h.ipAddress === key); if (!history.length) return null; const first = history[0];
      return { country: first.country, city: first.city, isp: first.isp, deviceType: first.deviceType, org: first.org, zip: first.zip, timezone: first.timezone, as: first.as, fingerprint: first.fingerprint, deviceId: first.deviceId, ips: Array.from(new Set(history.map(h => h.ipAddress))), isVpn: history.some(h => h.isVpn), attempts: history.map(h => ({ id: h.id, angle: h.angle, isCorrect: h.isCorrect, createdAt: h.createdAt, ip: h.ipAddress, isVpn: h.isVpn })) };
    }),
    exportData: publicProcedure.query(async () => {
      const headers = ['ID','IP','Fingerprint','DeviceID','Kat','Poprawny','Data','Przegladarka','OS','Miasto','Kraj','VPN'];
      const rows = historyStore.map(h => [h.id, h.ipAddress, h.fingerprint, h.deviceId, String(h.angle), h.isCorrect ? 'TAK' : 'NIE', h.createdAt.toISOString(), h.browserFamily, h.osFamily, h.city, h.country, h.isVpn ? 'TAK' : 'NIE']);
      const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + v + '"').join(','))].join('\n');
      return csv;
    }),
    unlockIp: publicProcedure.input(z.object({ ipAddress: z.string().optional(), fingerprint: z.string().optional(), deviceId: z.string().optional() })).mutation(async ({ input }) => {
      const initialKeys = [input.fingerprint, input.deviceId, input.ipAddress].filter(Boolean) as string[];
      if (initialKeys.length === 0) return { success: false, message: "Brak ID do odblokowania" };
      const keysToDelete = new Set<string>(initialKeys);
      // dodaj też klucze podsieci dla IP
      for (const k of initialKeys){ if(isIPv4(k)) keysToDelete.add(getSubnetKey(k)); if(k.startsWith("subnet:")) keysToDelete.add(k); }

      for (const h of historyStore) {
        const matches = initialKeys.some(k => k === h.ipAddress || k === h.fingerprint || k === h.deviceId);
        if (matches) {
          if (h.ipAddress) { keysToDelete.add(h.ipAddress); if(isIPv4(h.ipAddress)) keysToDelete.add(getSubnetKey(h.ipAddress)); }
          if (h.fingerprint && h.fingerprint !== "unknown") keysToDelete.add(h.fingerprint);
          if (h.deviceId && h.deviceId !== "unknown") keysToDelete.add(h.deviceId);
        }
      }
      for (const [storeKey, rec] of attemptStore.entries()) {
        const shouldDelete = keysToDelete.has(storeKey) || initialKeys.some(k => rec.ips.has(k) || rec.fingerprints.has(k));
        if (shouldDelete) {
          keysToDelete.add(storeKey);
          rec.ips.forEach(ip => { keysToDelete.add(ip); if(isIPv4(ip)) keysToDelete.add(getSubnetKey(ip)); });
          rec.fingerprints.forEach(fp => { if (fp !== "unknown") keysToDelete.add(fp); });
        }
      }
      for (const k of Array.from(keysToDelete)) {
        const rec = attemptStore.get(k);
        if (rec) {
          rec.ips.forEach(ip => { keysToDelete.add(ip); if(isIPv4(ip)) keysToDelete.add(getSubnetKey(ip)); });
          rec.fingerprints.forEach(fp => { if (fp !== "unknown") keysToDelete.add(fp); });
        }
      }
      let deletedCount = 0;
      for (const k of keysToDelete) { if (attemptStore.delete(k)) deletedCount++; }
      return { success: true, deletedKeys: Array.from(keysToDelete), deletedCount };
    }),
    verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => { const adminPin = ENV.adminPin; if (!adminPin) return { success: false, error: "Admin PIN not configured" }; return { success: input.pin === adminPin }; }),
    getLockedIPs: publicProcedure.query(async () => { const locked: string[] = []; for (const [key, rec] of attemptStore.entries()) { if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) locked.push(key); } return locked; }),
  }),
});
export type AppRouter = typeof appRouter;
