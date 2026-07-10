import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./_core/db";
import { attemptHistory, lockKeys } from "../../drizzle/schema";

const MAX_ATTEMPTS = 2;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;

// fallback w pamięci jeśli DB nie działa
const memLocks = new Map<string, { lockedUntil: number; failed: number }>();
const memHistory: any[] = [];

function dbOrNull() {
  try {
    const db = getDb();
    if (!db) {
      console.log("[Database] Skipped - in-memory mode");
      return null;
    }
    return db;
  } catch (e) {
    console.log("[Database] Error getting DB, fallback to memory", e);
    return null;
  }
}

export async function addHistory(
  ip: string,
  fingerprint: string,
  deviceId: string,
  angle: number,
  isCorrect: boolean,
  ua: string,
  parsedUA: any,
  geo: any,
  isVpn: boolean
) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ipAddress: ip || "unknown",
    fingerprint: fingerprint || "unknown",
    deviceId: deviceId || "unknown",
    angle,
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
    browserFamily: parsedUA?.browserFamily || parsedUA?.browser || "Unknown",
    osFamily: parsedUA?.osFamily || parsedUA?.os || "Unknown",
    deviceType: parsedUA?.deviceType || parsedUA?.device || "desktop",
    userAgent: ua,
    isVpn: isVpn ? 1 : 0,
    createdAt: new Date(),
  };

  const db = dbOrNull();
  if (!db) {
    memHistory.unshift({ ...entry, createdAt: new Date(), timestamp: new Date() });
    if (memHistory.length > 1000) memHistory.pop();
    return;
  }

  try {
    await db.insert(attemptHistory).values(entry as any);
  } catch (e) {
    console.error("[DB] addHistory failed, fallback to memory", e);
    memHistory.unshift({ ...entry, createdAt: new Date(), timestamp: new Date() });
  }
}

export async function getAllHistory(limit = 100, offset = 0) {
  const db = dbOrNull();
  if (!db) return memHistory.slice(offset, offset + limit);
  try {
    const rows = await db
      .select()
      .from(attemptHistory)
      .orderBy(desc(attemptHistory.createdAt))
      .limit(limit)
      .offset(offset);
    return rows;
  } catch (e) {
    console.error("[DB] getAllHistory failed", e);
    return memHistory.slice(offset, offset + limit);
  }
}

export async function getStats() {
  const history = await getAllHistory(1000, 0);
  const db = dbOrNull();
  let lockedCount = 0;
  let uniqueKeys = 0;

  if (!db) {
    lockedCount = Array.from(memLocks.values()).filter(v => v.lockedUntil > Date.now()).length;
    uniqueKeys = memLocks.size;
  } else {
    try {
      const lockedRows = await db.select().from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
      lockedCount = lockedRows.length;
      const allRows = await db.select({ id: lockKeys.id }).from(lockKeys);
      uniqueKeys = allRows.length;
    } catch {}
  }

  const total = history.length;
  const ok = history.filter((h: any) => h.isCorrect === 1).length;
  const vpn = history.filter((h: any) => h.isVpn === 1).length;
  return {
    totalAttempts: total,
    uniqueIps: uniqueKeys,
    uniqueIPs: uniqueKeys,
    successfulAttempts: ok,
    failedAttempts: total - ok,
    currentlyLockedIps: lockedCount,
    lockedIPs: lockedCount,
    successRate: total ? Math.round((ok / total) * 100) : 0,
    repeatedOffenders: 0,
    vpnAttempts: vpn,
  };
}

export async function isLocked(key: string) {
  if (!key) return false;
  const db = dbOrNull();
  if (!db) {
    const rec = memLocks.get(key);
    if (!rec) return false;
    if (rec.lockedUntil < Date.now()) { memLocks.delete(key); return false; }
    return true;
  }
  try {
    const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1);
    if (!rows.length) return false;
    const until = new Date(rows[0].lockedUntil).getTime();
    if (until < Date.now()) {
      await db.delete(lockKeys).where(eq(lockKeys.id, key));
      return false;
    }
    return true;
  } catch { return false; }
}

export async function getRemainingLockoutTime(key: string) {
  if (!key) return 0;
  const db = dbOrNull();
  if (!db) {
    const rec = memLocks.get(key);
    if (!rec) return 0;
    return Math.max(0, rec.lockedUntil - Date.now());
  }
  try {
    const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1);
    if (!rows.length) return 0;
    return Math.max(0, new Date(rows[0].lockedUntil).getTime() - Date.now());
  } catch { return 0; }
}

export async function recordFailedAttempt(key: string, ip: string, fingerprint?: string) {
  const db = dbOrNull();
  const lockedUntilDate = new Date(Date.now() + LOCKOUT_MS);

  if (!db) {
    const rec = memLocks.get(key) || { failed: 0, lockedUntil: 0 };
    rec.failed += 1;
    if (rec.failed >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCKOUT_MS;
    memLocks.set(key, rec);
    return {
      remainingAttempts: Math.max(0, MAX_ATTEMPTS - rec.failed),
      isLocked: rec.failed >= MAX_ATTEMPTS,
      lockedUntil: rec.failed >= MAX_ATTEMPTS ? new Date(rec.lockedUntil) : null,
    };
  }

  try {
    const rows = await db.select().from(lockKeys).where(eq(lockKeys.id, key)).limit(1);
    let failed = 1;
    if (rows.length) failed = (rows[0].failedAttempts || 0) + 1;

    if (failed >= MAX_ATTEMPTS) {
      await db.insert(lockKeys).values({ id: key, lockedUntil: lockedUntilDate, failedAttempts: failed } as any)
        .onDuplicateKeyUpdate({ set: { lockedUntil: lockedUntilDate, failedAttempts: failed } as any });
      return { remainingAttempts: 0, isLocked: true, lockedUntil: lockedUntilDate };
    } else {
      await db.insert(lockKeys).values({ id: key, lockedUntil: new Date(Date.now() + 60*1000), failedAttempts: failed } as any)
        .onDuplicateKeyUpdate({ set: { failedAttempts: failed, lockedUntil: new Date(Date.now() + 60*1000) } as any });
      // od razu nadpisz na realną blokadę tylko gdy >= MAX, inaczej ustawiamy przyszłą datę ale isLocked=false, więc trzymamy licznik
      // prościej: jeśli nie zablokowany, usuń blokadę ale zostaw licznik
      if (failed < MAX_ATTEMPTS) {
        // nie blokujemy jeszcze, ale licznik zostaje
        return { remainingAttempts: Math.max(0, MAX_ATTEMPTS - failed), isLocked: false, lockedUntil: null };
      }
      return { remainingAttempts: 0, isLocked: true, lockedUntil: lockedUntilDate };
    }
  } catch (e) {
    console.error("[DB] recordFailedAttempt error", e);
    return { remainingAttempts: 0, isLocked: true, lockedUntil: lockedUntilDate };
  }
}

export async function resetAttempts(keys: string[]) {
  const db = dbOrNull();
  if (!db) { keys.forEach(k => memLocks.delete(k)); return; }
  try {
    for (const k of keys) await db.delete(lockKeys).where(eq(lockKeys.id, k));
  } catch {}
}

export async function getLockedAll() {
  const db = dbOrNull();
  if (!db) return Array.from(memLocks.entries()).filter(([, v]) => v.lockedUntil > Date.now()).map(([k]) => k);
  try {
    const rows = await db.select({ id: lockKeys.id }).from(lockKeys).where(sql`${lockKeys.lockedUntil} > NOW()`);
    return rows.map(r => r.id);
  } catch { return []; }
}

export async function unlockKeys(keys: string[]) {
  const db = dbOrNull();
  if (!db) { keys.forEach(k => memLocks.delete(k)); return { deletedCount: keys.length }; }
  let count = 0;
  for (const k of keys) {
    try { await db.delete(lockKeys).where(eq(lockKeys.id, k)); count++; } catch {}
  }
  return { deletedCount: count };
}
