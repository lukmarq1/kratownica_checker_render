import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import mysql from "mysql2/promise";
import crypto from "crypto";

const MAX_ATTEMPTS = 2;
const BASE_LOCKOUT_MS = 24 * 60 * 60 * 1000; // 1 dzień - pierwsza kara
const REPEAT_LOCKOUT_MS = 3 * 24 * 60 * 60 * 1000; // 3 dni - recydywa / VPN / zmiana sieci
const COOKIE_NAME = "__Host-kratownica_did";
const CORRECT_ANGLE = 65;
const TOLERANCE = 2;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

let pool: mysql.Pool | null = null;
function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Brak DATABASE_URL");
  const u = new URL(raw);
  pool = mysql.createPool({
    host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "defaultdb",
    ssl: { rejectUnauthorized: false } as any, waitForConnections: true, connectionLimit: 5,
  });
  return pool;
}
async function ensureTable() {
  const p = getPool();
  // MAX przechowywanie - tabele bez limitu, indeksy dla szybkości
  await p.query(`CREATE TABLE IF NOT EXISTS lockouts (lock_key VARCHAR(255) PRIMARY KEY, failed_attempts INT NOT NULL DEFAULT 0, locked_until DATETIME NULL, last_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, is_subnet TINYINT(1) DEFAULT 0, total_locks INT NOT NULL DEFAULT 0, total_attempts INT NOT NULL DEFAULT 0, ips_json TEXT NULL, INDEX idx_locked_until (locked_until))`);
  await p.query(`CREATE TABLE IF NOT EXISTS device_networks (fingerprint VARCHAR(255) PRIMARY KEY, first_ip VARCHAR(45) NOT NULL, first_subnet VARCHAR(45) NOT NULL, last_ip VARCHAR(45) NOT NULL, last_subnet VARCHAR(45) NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await p.query(`CREATE TABLE IF NOT EXISTS attempt_logs (id INT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45), subnet VARCHAR(45), angle INT, status ENUM('success','fail','locked','vpn') DEFAULT 'fail', browser VARCHAR(100), fingerprint VARCHAR(255), device_id VARCHAR(255), localization VARCHAR(100), created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_created (created_at), INDEX idx_ip (ip), INDEX idx_fp (fingerprint))`);
  // migracja dla istniejącej bazy - nie kasuje danych, tylko dodaje kolumny
  try { await p.query(`ALTER TABLE lockouts ADD COLUMN total_locks INT NOT NULL DEFAULT 0`); } catch {}
  try { await p.query(`ALTER TABLE lockouts ADD COLUMN total_attempts INT NOT NULL DEFAULT 0`); } catch {}
  try { await p.query(`ALTER TABLE lockouts ADD COLUMN ips_json TEXT NULL`); } catch {}
}
function getClientIp(req: any): string {
  const h = req.headers || {};
  const candidates = [h["x-forwarded-for"], h["x-real-ip"], h["cf-connecting-ip"], h["x-client-ip"], h["true-client-ip"]];
  for (const c of candidates) { if (typeof c === "string" && c.length) return c.split(",")[0].trim(); if (Array.isArray(c) && c.length) return c[0].split(",")[0].trim(); }
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "0.0.0.0";
}
function isIPv4(ip: string) { return /^\d+\.\d+\.\d+\.\d+$/.test(ip); }
function getSubnet(ip: string) { if (!isIPv4(ip)) return ip; return ip.split(".").slice(0, 3).join("."); }
function getSubnetKey(ip: string) { return `subnet:${getSubnet(ip)}`; }
function parseCookies(req: any): Record<string, string> { const h = req.headers?.cookie || ""; const out: Record<string, string> = {}; h.split(";").forEach((p: string) => { const [k,...v] = p.trim().split("="); if (k) out[k] = decodeURIComponent(v.join("=")); }); return out; }
function ensureDoubleCookie(ctx: any, inputDeviceId?: string) {
  const cookies = parseCookies(ctx.req); let cookieId = cookies[COOKIE_NAME]; let deviceId = inputDeviceId || (ctx.req.headers?.["x-device-id"] as string) || cookieId;
  if (!cookieId) { cookieId = deviceId || crypto.randomUUID(); try { ctx.res?.setHeader?.("Set-Cookie", `${COOKIE_NAME}=${cookieId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60*60*24*365}`); } catch {} }
  if (!deviceId) deviceId = cookieId; return { deviceId: deviceId!, cookieId: cookieId! };
}
async function getRecord(key: string) { await ensureTable(); const [rows] = await getPool().query<any[]>(`SELECT * FROM lockouts WHERE lock_key =?`, [key]); return (rows as any[])[0] || null; }
async function isLocked(key: string) { const rec = await getRecord(key); if (!rec?.locked_until) return false; return new Date(rec.locked_until).getTime() > Date.now(); }
async function getRemaining(key: string) { const rec = await getRecord(key); if (!rec?.locked_until) return 0; return Math.max(0, new Date(rec.locked_until).getTime() - Date.now()); }

// NOWE: wylicz czy recydywa -> 3 dni
async function getRepeatDuration(keys: string[], fingerprint: string, ip: string): Promise<number> {
  const p = getPool();
  // 1) czy którykolwiek klucz już był blokowany?
  for (const k of keys) {
    const r = await getRecord(k);
    if (r && (r.total_locks > 0 || r.total_attempts >= 4)) return REPEAT_LOCKOUT_MS;
  }
  // 2) czy zmieniał IP / subnet? (VPN / telefon)
  if (fingerprint) {
    try {
      const [rows] = await p.query<any[]>(`SELECT first_ip, last_ip, first_subnet, last_subnet FROM device_networks WHERE fingerprint=?`, [fingerprint]);
      const dn = (rows as any[])[0];
      if (dn && (dn.first_ip !== dn.last_ip || dn.first_subnet !== dn.last_subnet)) return REPEAT_LOCKOUT_MS;
      // 3) czy w historii ma >=2 faili? (kombinował w przeszłości)
      const [logs] = await p.query<any[]>(`SELECT COUNT(*) as c FROM attempt_logs WHERE fingerprint=? AND status IN ('fail','locked','vpn')`, [fingerprint]);
      if ((logs as any[])[0]?.c >= 2) return REPEAT_LOCKOUT_MS;
    } catch {}
  }
  // 4) czy to IP ma już różne fingerprinty? (ten sam IP, różne przeglądarki = obchodzenie)
  try {
    const subnet = getSubnet(ip);
    const [srows] = await p.query<any[]>(`SELECT COUNT(DISTINCT fingerprint) as c FROM attempt_logs WHERE subnet=? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`, [subnet]);
    if ((srows as any[])[0]?.c >= 3) return REPEAT_LOCKOUT_MS;
  } catch {}
  return BASE_LOCKOUT_MS;
}

async function lockKeys(keys: string[], fingerprint?: string, ip?: string) {
  if (!keys.length) return BASE_LOCKOUT_MS; await ensureTable(); const p = getPool();
  const duration = await getRepeatDuration(keys, fingerprint || "", ip || "");
  const until = new Date(Date.now() + duration);
  for (const k of keys) {
    await p.query(`INSERT INTO lockouts (lock_key, failed_attempts, locked_until, last_attempt_at, is_subnet, total_locks, total_attempts) VALUES (?,?,?,NOW(),?,1,?) ON DUPLICATE KEY UPDATE failed_attempts=VALUES(failed_attempts), locked_until=VALUES(locked_until), last_attempt_at=NOW(), total_locks = total_locks + 1, total_attempts = total_attempts + 1`, [k, MAX_ATTEMPTS, until, k.startsWith("subnet:")?1:0, MAX_ATTEMPTS]);
  }
  return duration;
}
async function incrementFail(keys: string[], fingerprint?: string, ip?: string) {
  if (!keys.length) return { locked: false, duration: BASE_LOCKOUT_MS }; await ensureTable(); const p = getPool(); let shouldLock = false;
  for (const k of keys) { const rec = await getRecord(k); const fails = (rec?.failed_attempts||0)+1; if (fails >= MAX_ATTEMPTS) shouldLock = true; }
  if (shouldLock) { const dur = await lockKeys(keys, fingerprint, ip); return { locked: true, duration: dur }; }
  for (const k of keys) { const rec = await getRecord(k); const fails = (rec?.failed_attempts||0)+1; await p.query(`INSERT INTO lockouts (lock_key, failed_attempts, last_attempt_at, total_attempts) VALUES (?,?,NOW(),1) ON DUPLICATE KEY UPDATE failed_attempts=?, last_attempt_at=NOW(), total_attempts = total_attempts + 1`, [k, fails, fails]); }
  return { locked: false, duration: BASE_LOCKOUT_MS };
}
async function clearLock(keys: string[]) { if (!keys.length) return; await ensureTable(); const p = getPool(); const placeholders = keys.map(() => "?").join(","); await p.query(`DELETE FROM lockouts WHERE lock_key IN (${placeholders})`, keys); }
async function logAttempt(data: { ip: string, angle: number, status: 'success'|'fail'|'locked'|'vpn', browser?: string, fingerprint?: string, deviceId?: string }) {
  try { await ensureTable(); const p = getPool(); const subnet = getSubnet(data.ip); await p.query(`INSERT INTO attempt_logs (ip, subnet, angle, status, browser, fingerprint, device_id, localization) VALUES (?,?,?,?,?,?,?,?)`, [data.ip, subnet, data.angle, data.status, data.browser||null, data.fingerprint||null, data.deviceId||null, subnet]); } catch(e){ console.error("logAttempt error", e); }
}
async function checkVpnAndUpdate(fingerprint: string, ip: string) {
  if (!fingerprint || fingerprint === "fp-fallback") return { isVpn: false }; await ensureTable(); const p = getPool(); const subnet = getSubnet(ip);
  const [rows] = await p.query<any[]>(`SELECT * FROM device_networks WHERE fingerprint =?`, [fingerprint]); const existing = (rows as any[])[0];
  if (!existing) { await p.query(`INSERT INTO device_networks (fingerprint, first_ip, first_subnet, last_ip, last_subnet) VALUES (?,?,?,?,?)`, [fingerprint, ip, subnet, ip, subnet]); return { isVpn: false }; }
  const changed = existing.last_ip !== ip || existing.last_subnet !== subnet;
  await p.query(`UPDATE device_networks SET last_ip=?, last_subnet=? WHERE fingerprint=?`, [ip, subnet, fingerprint]);
  return { isVpn: changed && existing.first_subnet !== subnet, isRepeat: true };
}

export const angleRouter = router({
  status: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => {
    const ip = getClientIp(ctx.req); const { deviceId, cookieId } = ensureDoubleCookie(ctx, input.deviceId); const fingerprint = input.fingerprint || ""; const subnetKey = getSubnetKey(ip);
    const primaryKey = fingerprint || deviceId || cookieId || ip; const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, cookieId, fingerprint].filter(Boolean))) as string[];
    for (const k of keysToCheck) { if (await isLocked(k)) { return { isLocked: true, locked: true, remainingAttempts: 0, attemptsLeft: 0, remainingLockoutMs: await getRemaining(k), remainingMs: await getRemaining(k) }; } }
    const rec = await getRecord(primaryKey); const left = rec? Math.max(0, MAX_ATTEMPTS - rec.failed_attempts) : MAX_ATTEMPTS;
    return { isLocked: false, locked: false, remainingAttempts: left, attemptsLeft: left, remainingLockoutMs: 0, remainingMs: 0, maxAttempts: MAX_ATTEMPTS };
  }),
  getStatus: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).query(async ({ ctx, input }) => {
    const ip = getClientIp(ctx.req); const { deviceId, cookieId } = ensureDoubleCookie(ctx, input.deviceId); const fingerprint = input.fingerprint || ""; const subnetKey = getSubnetKey(ip);
    const primaryKey = fingerprint || deviceId || cookieId || ip; const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, cookieId, fingerprint].filter(Boolean))) as string[];
    for (const k of keysToCheck) { if (await isLocked(k)) { return { isLocked: true, locked: true, remainingAttempts: 0, attemptsLeft: 0, remainingLockoutMs: await getRemaining(k), remainingMs: await getRemaining(k) }; } }
    const rec = await getRecord(primaryKey); const left = rec? Math.max(0, MAX_ATTEMPTS - rec.failed_attempts) : MAX_ATTEMPTS;
    return { isLocked: false, locked: false, remainingAttempts: left, attemptsLeft: left, remainingLockoutMs: 0, remainingMs: 0, maxAttempts: MAX_ATTEMPTS };
  }),
  verify: publicProcedure.input(z.object({ angle: z.number(), fingerprint: z.string().optional(), deviceId: z.string().optional(), browser: z.string().optional(), os: z.string().optional() })).mutation(async ({ ctx, input }) => {
    (ctx as any).user = { id: 1, openId: "public-user", name: "Gość", email: "guest@example.com", loginMethod: "public", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;
    const ip = getClientIp(ctx.req); const { deviceId, cookieId } = ensureDoubleCookie(ctx, input.deviceId); const fingerprint = input.fingerprint || "";
    const subnetKey = getSubnetKey(ip); const primaryKey = fingerprint || deviceId || cookieId || ip;
    const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, cookieId, fingerprint].filter(Boolean))) as string[];
    for (const k of keysToCheck) { if (await isLocked(k)) { return { success: false, reason: "locked" as const, remainingLockoutMs: await getRemaining(k) }; } }
    const isCorrect = Math.abs(input.angle - CORRECT_ANGLE) <= TOLERANCE;
    const vpnInfo = await checkVpnAndUpdate(fingerprint, ip);
    if (isCorrect) { await clearLock(keysToCheck); await logAttempt({ ip, angle: input.angle, status: 'success', browser: input.browser, fingerprint, deviceId }); return { success: true, reason: "correct" as const }; }
    else { const res = await incrementFail(keysToCheck, fingerprint, ip); await logAttempt({ ip, angle: input.angle, status: res.locked ? 'locked' : vpnInfo.isVpn ? 'vpn' : 'fail', browser: input.browser, fingerprint, deviceId }); if (res.locked) return { success: false, reason: "locked" as const, remainingLockoutMs: res.duration, remainingAttempts: 0, isRepeat: res.duration === REPEAT_LOCKOUT_MS, lockoutDays: res.duration/86400000 }; const rec = await getRecord(primaryKey); const left = rec? Math.max(0, MAX_ATTEMPTS - rec.failed_attempts) : MAX_ATTEMPTS - 1; return { success: false, reason: vpnInfo.isVpn ? "vpn_detected" as const : "invalid_angle" as const, remainingAttempts: left }; }
  }),
});

export const adminRouter = router({
  verifyPin: publicProcedure.input(z.object({ pin: z.string() })).mutation(async ({ input }) => { if (input.pin === ADMIN_PIN) return { ok: true, success: true }; throw new Error("Nieprawidłowy PIN"); }),
  list: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT lock_key, lock_key as ip, lock_key as fingerprint, failed_attempts, locked_until, last_attempt_at, is_subnet, total_locks, total_attempts FROM lockouts WHERE locked_until > NOW() ORDER BY last_attempt_at DESC LIMIT 100`); return rows as any; } catch { return [] as any; } }),
  getBlocked: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT lock_key, lock_key as ip, lock_key as fingerprint, failed_attempts, locked_until, last_attempt_at, total_locks FROM lockouts WHERE locked_until > NOW()`); return rows as any; } catch { return [] as any; } }),
  getBlockedDevices: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT lock_key, lock_key as ip, lock_key as fingerprint, failed_attempts, locked_until, last_attempt_at, is_subnet, total_locks FROM lockouts WHERE locked_until > NOW()`); return rows as any; } catch { return [] as any; } }),
  getAllBlocked: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT * FROM lockouts WHERE locked_until > NOW()`); return rows as any; } catch { return [] as any; } }),
  // MAX przechowywanie - 10k rekordów zamiast 100, bez kasowania
  history: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT id, COALESCE(ip, fingerprint, device_id, '0.0.0.0') as ip, angle, status, COALESCE(browser, device_id, fingerprint, '-') as device, fingerprint, COALESCE(localization, subnet, '-') as localization, created_at as time, created_at FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; } catch { return [] as any; } }),
  getLogs: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT * FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; } catch { return [] as any; } }),
  getHistory: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT * FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; } catch { return [] as any; } }),
  getAttempts: publicProcedure.query(async () => { try { await ensureTable(); const [rows] = await getPool().query(`SELECT * FROM attempt_logs ORDER BY created_at DESC LIMIT 10000`); return rows as any; } catch { return [] as any; } }),
  unblock: publicProcedure.input(z.object({ key: z.string().optional(), ip: z.string().optional(), fingerprint: z.string().optional() }).or(z.string())).mutation(async ({ input }) => {
    await ensureTable(); const p = getPool(); const key = typeof input === 'string' ? input : (input.key || input.ip || input.fingerprint || ''); if (!key) return { ok: true };
    if (key.startsWith("subnet:")) { await p.query(`DELETE FROM lockouts WHERE lock_key=? OR lock_key LIKE?`, [key, `${key.replace("subnet:","")}.%`]); } else { await clearLock([key]); await p.query(`DELETE FROM lockouts WHERE lock_key LIKE ?`, [`%${key}%`]); }
    return { ok: true };
  }),
  clearAll: publicProcedure.mutation(async () => { await ensureTable(); const p = getPool(); await p.query(`DELETE FROM lockouts`); await p.query(`DELETE FROM device_networks`); await p.query(`DELETE FROM attempt_logs`); return { ok: true }; }),
  clearLogs: publicProcedure.mutation(async () => { await ensureTable(); await getPool().query(`DELETE FROM attempt_logs`); return { ok: true }; }),
  clearHistory: publicProcedure.mutation(async () => { await ensureTable(); await getPool().query(`DELETE FROM attempt_logs`); return { ok: true }; }),
  forceUnblockMe: publicProcedure.input(z.object({ fingerprint: z.string().optional(), deviceId: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const ip = getClientIp(ctx.req); const { deviceId, cookieId } = ensureDoubleCookie(ctx, input.deviceId); const fingerprint = input.fingerprint || ""; const subnetKey = getSubnetKey(ip); const primaryKey = fingerprint || deviceId || cookieId || ip;
    const keysToCheck = Array.from(new Set([primaryKey, ip, subnetKey, deviceId, cookieId, fingerprint].filter(Boolean))) as string[];
    await clearLock(keysToCheck); return { ok: true };
  }),
  adminUnblock: publicProcedure.input(z.object({ key: z.string() })).mutation(async ({ input }) => { await ensureTable(); await clearLock([input.key]); return { ok: true }; }),
  adminClearAll: publicProcedure.mutation(async () => { await ensureTable(); const p = getPool(); await p.query(`DELETE FROM lockouts`); await p.query(`DELETE FROM attempt_logs`); return { ok: true }; }),
});

export const appRouter = router({ angle: angleRouter, admin: adminRouter, status: angleRouter.status, getStatus: angleRouter.getStatus, verify: angleRouter.verify, });
export type AppRouter = typeof appRouter;
