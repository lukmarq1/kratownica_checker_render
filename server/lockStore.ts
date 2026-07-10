import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { lockKeys, attemptHistory, type LockKey } from "../drizzle/schema";

// =====================================================================
// Trwały magazyn blokad, oparty o MySQL (tabela `lock_keys`).
// Zastępuje dawne `attemptStore` / `historyStore` (Map/Array w pamięci
// procesu), które gubiły się przy restarcie serwera i były niespójne
// przy >1 instancji.
//
// Jeśli baza jest chwilowo niedostępna, spadamy na awaryjny magazyn
// w pamięci (tylko dla bieżącego procesu) — appka dalej działa, ale
// bez trwałości. To wyłącznie fallback na wypadek przerwy w połączeniu
// z DB, nie stan docelowy.
// =====================================================================

interface MemRecord {
  failedAttempts: number;
  lockedUntil: Date | null;
  totalAttempts: number;
  successfulAttempts: number;
  ips: Set<string>;
  fingerprints: Set<string>;
  isRepeatedOffender: boolean;
}
const memFallback = new Map<string, MemRecord>();

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function keyType(key: string): string {
  if (key.startsWith("asn:")) return "asn";
  if (key.startsWith("geo:")) return "geo";
  if (key.includes("/24") || key.startsWith("v6:")) return "subnet";
  if (key.includes(".") && /^\d+\.\d+\.\d+\.\d+$/.test(key)) return "ip";
  if (key.includes(":")) return "ip"; // raw ipv6 (not bucketed)
  return "device"; // fingerprint / deviceId
}

async function dbOrNull() {
  try {
    return await getDb();
  } catch {
    return null;
  }
}

export async function getRecord(key: string): Promise<{
  failedAttempts: number;
  lockedUntil: Date | null;
  isRepeatedOffender: boolean;
} | null> {
  const db = await dbOrNull();
  if (!db) {
    const rec = memFallback.get(key);
    return rec ? { failedAttempts: rec.failedAttempts, lockedUntil: rec.lockedUntil, isRepeatedOffender: rec.isRepeatedOffender } : null;
  }
  const rows = await db.select().from(lockKeys).where(eq(lockKeys.lockKey, key)).limit(1);
  if (!rows.length) return null;
  return { failedAttempts: rows[0].failedAttempts, lockedUntil: rows[0].lockedUntil, isRepeatedOffender: !!rows[0].isRepeatedOffender };
}

async function getOrCreateRow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, key: string): Promise<LockKey> {
  const existing = await db.select().from(lockKeys).where(eq(lockKeys.lockKey, key)).limit(1);
  if (existing.length) return existing[0];
  await db.insert(lockKeys).values({ lockKey: key, keyType: keyType(key) }).onDuplicateKeyUpdate({ set: { lastSeen: new Date() } });
  const rows = await db.select().from(lockKeys).where(eq(lockKeys.lockKey, key)).limit(1);
  return rows[0];
}

export async function isLocked(key: string): Promise<boolean> {
  const db = await dbOrNull();
  if (!db) {
    const rec = memFallback.get(key);
    if (!rec?.lockedUntil) return false;
    if (rec.lockedUntil.getTime() < Date.now()) { rec.failedAttempts = 0; rec.lockedUntil = null; return false; }
    return true;
  }
  const rows = await db.select().from(lockKeys).where(eq(lockKeys.lockKey, key)).limit(1);
  if (!rows.length || !rows[0].lockedUntil) return false;
  if (rows[0].lockedUntil.getTime() < Date.now()) {
    await db.update(lockKeys).set({ failedAttempts: 0, lockedUntil: null }).where(eq(lockKeys.lockKey, key));
    return false;
  }
  return true;
}

export async function getRemainingLockoutTime(key: string): Promise<number> {
  const db = await dbOrNull();
  if (!db) {
    const rec = memFallback.get(key);
    if (!rec?.lockedUntil) return 0;
    return Math.max(0, rec.lockedUntil.getTime() - Date.now());
  }
  const rows = await db.select().from(lockKeys).where(eq(lockKeys.lockKey, key)).limit(1);
  if (!rows.length || !rows[0].lockedUntil) return 0;
  return Math.max(0, rows[0].lockedUntil.getTime() - Date.now());
}

export async function recordFailedAttempt(
  key: string,
  ip: string,
  fingerprint: string | undefined,
  max: number,
  lockoutMsFor: (isRepeatedOffender: boolean) => number
): Promise<{ remainingAttempts: number; isLocked: boolean; lockedUntil: Date | null }> {
  const db = await dbOrNull();
  if (!db) {
    let rec = memFallback.get(key);
    if (!rec) { rec = { failedAttempts: 0, lockedUntil: null, totalAttempts: 0, successfulAttempts: 0, ips: new Set(), fingerprints: new Set(), isRepeatedOffender: false }; memFallback.set(key, rec); }
    rec.failedAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip);
    if (fingerprint) rec.fingerprints.add(fingerprint);
    if (rec.ips.size > 1) rec.isRepeatedOffender = true;
    let locked = false; let lockedUntil: Date | null = null;
    if (rec.failedAttempts >= max) { locked = true; lockedUntil = new Date(Date.now() + lockoutMsFor(rec.isRepeatedOffender)); rec.lockedUntil = lockedUntil; }
    return { remainingAttempts: Math.max(0, max - rec.failedAttempts), isLocked: locked, lockedUntil };
  }

  const row = await getOrCreateRow(db, key);
  const ips = new Set(parseJsonArray(row.ipsJson)); ips.add(ip);
  const fps = new Set(parseJsonArray(row.fingerprintsJson)); if (fingerprint) fps.add(fingerprint);
  const isRepeatedOffender = ips.size > 1 || !!row.isRepeatedOffender;
  const newFailed = row.failedAttempts + 1;
  let lockedUntil: Date | null = null;
  if (newFailed >= max) lockedUntil = new Date(Date.now() + lockoutMsFor(isRepeatedOffender));

  await db.update(lockKeys).set({
    failedAttempts: newFailed,
    totalAttempts: row.totalAttempts + 1,
    lastSeen: new Date(),
    lockedUntil,
    isRepeatedOffender: isRepeatedOffender ? 1 : 0,
    ipsJson: JSON.stringify(Array.from(ips)),
    fingerprintsJson: JSON.stringify(Array.from(fps)),
  }).where(eq(lockKeys.lockKey, key));

  return { remainingAttempts: Math.max(0, max - newFailed), isLocked: !!lockedUntil, lockedUntil };
}

export async function forceLock(key: string, ip: string, fingerprint: string | undefined, max: number, lockedUntil: Date) {
  const db = await dbOrNull();
  if (!db) {
    let rec = memFallback.get(key);
    if (!rec) { rec = { failedAttempts: 0, lockedUntil: null, totalAttempts: 0, successfulAttempts: 0, ips: new Set(), fingerprints: new Set(), isRepeatedOffender: false }; memFallback.set(key, rec); }
    rec.failedAttempts = max; rec.lockedUntil = lockedUntil; rec.ips.add(ip); if (fingerprint) rec.fingerprints.add(fingerprint);
    return;
  }
  const row = await getOrCreateRow(db, key);
  const ips = new Set(parseJsonArray(row.ipsJson)); ips.add(ip);
  const fps = new Set(parseJsonArray(row.fingerprintsJson)); if (fingerprint) fps.add(fingerprint);
  await db.update(lockKeys).set({
    failedAttempts: max,
    lockedUntil,
    lastSeen: new Date(),
    ipsJson: JSON.stringify(Array.from(ips)),
    fingerprintsJson: JSON.stringify(Array.from(fps)),
  }).where(eq(lockKeys.lockKey, key));
}

export async function resetAttempts(keys: string[], ip: string, fingerprint?: string): Promise<void> {
  const relevant = keys.filter(k => !k.startsWith("geo:") && !k.startsWith("asn:"));
  const db = await dbOrNull();
  if (!db) {
    for (const k of relevant) {
      let rec = memFallback.get(k);
      if (!rec) { rec = { failedAttempts: 0, lockedUntil: null, totalAttempts: 0, successfulAttempts: 0, ips: new Set(), fingerprints: new Set(), isRepeatedOffender: false }; memFallback.set(k, rec); }
      rec.failedAttempts = 0; rec.lockedUntil = null; rec.successfulAttempts += 1; rec.totalAttempts += 1; rec.ips.add(ip);
      if (fingerprint) rec.fingerprints.add(fingerprint);
    }
    return;
  }
  for (const k of relevant) {
    const row = await getOrCreateRow(db, k);
    const ips = new Set(parseJsonArray(row.ipsJson)); ips.add(ip);
    const fps = new Set(parseJsonArray(row.fingerprintsJson)); if (fingerprint) fps.add(fingerprint);
    await db.update(lockKeys).set({
      failedAttempts: 0,
      lockedUntil: null,
      successfulAttempts: row.successfulAttempts + 1,
      totalAttempts: row.totalAttempts + 1,
      lastSeen: new Date(),
      ipsJson: JSON.stringify(Array.from(ips)),
      fingerprintsJson: JSON.stringify(Array.from(fps)),
    }).where(eq(lockKeys.lockKey, k));
  }
}

export async function addHistory(entry: {
  ip: string; fingerprint: string; deviceId: string; angle: number; isCorrect: boolean;
  userAgent: string; parsed: any; geo: any; isVpn: boolean;
}): Promise<void> {
  const db = await dbOrNull();
  if (!db) return; // brak DB = historia nie jest krytyczna dla bezpieczeństwa, pomijamy w fallbacku
  await db.insert(attemptHistory).values({
    ipAddress: entry.ip,
    angle: String(entry.angle),
    isCorrect: entry.isCorrect ? 1 : 0,
    attemptNumber: 0,
    userAgent: entry.userAgent,
    country: entry.geo?.country || null,
    city: entry.geo?.city || null,
    latitude: entry.geo?.latitude || null,
    longitude: entry.geo?.longitude || null,
    isp: entry.geo?.isp || null,
    org: entry.geo?.org || null,
    as: entry.geo?.as || null,
    timezone: entry.geo?.timezone || null,
    zip: entry.geo?.zip || null,
    browserFamily: entry.parsed?.browserFamily || entry.parsed?.browser || "Unknown",
    osFamily: entry.parsed?.osFamily || entry.parsed?.os || "Unknown",
    deviceType: entry.parsed?.deviceType || entry.parsed?.device || "desktop",
    fingerprint: entry.fingerprint || "unknown",
    deviceId: entry.deviceId || "unknown",
    isVpn: entry.isVpn ? 1 : 0,
  });
}

function subnetOf(ip: string): string | null {
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

export async function getRecentLinkedKeys(fingerprint: string, deviceId: string, windowMs: number): Promise<string[]> {
  const db = await dbOrNull();
  const keys = new Set<string>();
  const since = new Date(Date.now() - windowMs);
  if (!db) return [];
  if (!fingerprint && !deviceId) return [];
  // Drizzle nie ma tu wygodnego "OR" bez importu `or`, robimy dwa zapytania i łączymy.
  const rows: any[] = [];
  if (fingerprint) rows.push(...await db.select().from(attemptHistory).where(eq(attemptHistory.fingerprint, fingerprint)).orderBy(desc(attemptHistory.createdAt)).limit(200));
  if (deviceId) rows.push(...await db.select().from(attemptHistory).where(eq(attemptHistory.deviceId, deviceId)).orderBy(desc(attemptHistory.createdAt)).limit(200));

  for (const h of rows) {
    if (!h.createdAt || h.createdAt < since) continue;
    if (h.ipAddress) { keys.add(h.ipAddress); const s = subnetOf(h.ipAddress); if (s) keys.add(s); }
    if (h.city && h.city !== "Unknown") keys.add(`geo:${h.city}-${h.isp || h.org || "unknown"}`.slice(0, 80));
  }
  return Array.from(keys);
}

export async function getLockedAll(): Promise<Array<{ key: string; type: string; lockedUntil: Date; failedAttempts: number; isRepeatedOffender: boolean }>> {
  const db = await dbOrNull();
  if (!db) {
    const out: any[] = [];
    for (const [k, rec] of memFallback.entries()) {
      if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) out.push({ key: k, type: keyType(k), lockedUntil: rec.lockedUntil, failedAttempts: rec.failedAttempts, isRepeatedOffender: rec.isRepeatedOffender });
    }
    return out;
  }
  const rows = await db.select().from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
  return rows.map(r => ({ key: r.lockKey, type: r.keyType, lockedUntil: r.lockedUntil as Date, failedAttempts: r.failedAttempts, isRepeatedOffender: !!r.isRepeatedOffender }));
}

export async function deleteKeys(keys: Set<string>): Promise<number> {
  const db = await dbOrNull();
  if (!db) {
    let c = 0;
    for (const k of keys) if (memFallback.delete(k)) c++;
    return c;
  }
  let c = 0;
  for (const k of keys) {
    await db.delete(lockKeys).where(eq(lockKeys.lockKey, k));
    c += 1;
  }
  return c;
}

export async function findRelatedKeysFromHistory(seedKeys: string[]): Promise<Set<string>> {
  const db = await dbOrNull();
  const out = new Set<string>(seedKeys);
  if (!db) return out;
  for (const seed of seedKeys) {
    const byIp = await db.select().from(attemptHistory).where(eq(attemptHistory.ipAddress, seed)).limit(200);
    const byFp = await db.select().from(attemptHistory).where(eq(attemptHistory.fingerprint, seed)).limit(200);
    const byDev = await db.select().from(attemptHistory).where(eq(attemptHistory.deviceId, seed)).limit(200);
    for (const h of [...byIp, ...byFp, ...byDev]) {
      if (h.ipAddress) { out.add(h.ipAddress); const s = subnetOf(h.ipAddress); if (s) out.add(s); }
      if (h.fingerprint && h.fingerprint !== "unknown") out.add(h.fingerprint);
      if (h.deviceId && h.deviceId !== "unknown") out.add(h.deviceId);
      if (h.city && h.city !== "Unknown") out.add(`geo:${h.city}-${h.isp || h.org || "unknown"}`.slice(0, 80));
    }
  }
  return out;
}

export async function getRecentByFingerprint(fingerprint: string, windowMs: number): Promise<Array<{ ipAddress: string; country: string | null }>> {
  const db = await dbOrNull();
  if (!db || !fingerprint) return [];
  const since = new Date(Date.now() - windowMs);
  const rows = await db.select().from(attemptHistory).where(eq(attemptHistory.fingerprint, fingerprint)).orderBy(desc(attemptHistory.createdAt)).limit(50);
  return rows.filter(h => h.createdAt && h.createdAt >= since).map(h => ({ ipAddress: h.ipAddress, country: h.country }));
}

export async function getAllHistory(limit: number, offset: number) {
  const db = await dbOrNull();
  if (!db) return [];
  return db.select().from(attemptHistory).orderBy(desc(attemptHistory.createdAt)).limit(limit).offset(offset);
}

export async function countLockedNow(): Promise<number> {
  const db = await dbOrNull();
  if (!db) {
    let c = 0;
    for (const rec of memFallback.values()) if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) c++;
    return c;
  }
  const rows = await db.select().from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
  return rows.length;
}

export async function countRepeatedOffenders(): Promise<number> {
  const db = await dbOrNull();
  if (!db) {
    let c = 0;
    for (const rec of memFallback.values()) if (rec.isRepeatedOffender) c++;
    return c;
  }
  const rows = await db.select().from(lockKeys).where(eq(lockKeys.isRepeatedOffender, 1));
  return rows.length;
}

export async function countDistinctKeys(): Promise<number> {
  const db = await dbOrNull();
  if (!db) return memFallback.size;
  const rows = await db.select({ id: lockKeys.id }).from(lockKeys);
  return rows.length;
}
