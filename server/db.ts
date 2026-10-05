import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { User } from "../drizzle/schema";

let _db: any = null;

type AttemptRecord = {
  id: string;
  ipAddress: string;
  failedAttempts: number;
  lockedUntil: Date | null;
};

const TEST_MAX_ATTEMPTS = 2;
const TEST_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const attemptRecords = new Map<string, AttemptRecord>();
const users = new Map<string, User>();

export async function getUserByOpenId(openId: string): Promise<User | null> {
  return users.get(openId) ?? null;
}

export async function upsertUser(input: Partial<User> & { openId: string }): Promise<User> {
  const now = new Date();
  const existing = users.get(input.openId);
  const user: User = {
    id: existing?.id ?? users.size + 1,
    openId: input.openId,
    name: input.name ?? existing?.name ?? null,
    email: input.email ?? existing?.email ?? null,
    loginMethod: input.loginMethod ?? existing?.loginMethod ?? null,
    role: input.role ?? existing?.role ?? "user",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSignedIn: input.lastSignedIn ?? existing?.lastSignedIn ?? now,
  };
  users.set(input.openId, user);
  return user;
}

export async function getOrCreateAttemptRecord(ipAddress: string): Promise<AttemptRecord> {
  const existing = attemptRecords.get(ipAddress);
  if (existing) return { ...existing };
  const record: AttemptRecord = {
    id: `attempt-${ipAddress}`,
    ipAddress,
    failedAttempts: 0,
    lockedUntil: null,
  };
  attemptRecords.set(ipAddress, record);
  return { ...record };
}

export async function recordFailedAttempt(ipAddress: string) {
  const record = await getOrCreateAttemptRecord(ipAddress);
  if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
    return { remainingAttempts: 0, isLocked: true, lockedUntil: record.lockedUntil };
  }

  record.failedAttempts += 1;
  if (record.failedAttempts >= TEST_MAX_ATTEMPTS) {
    record.lockedUntil = new Date(Date.now() + TEST_LOCKOUT_MS);
    attemptRecords.set(ipAddress, record);
    return { remainingAttempts: 0, isLocked: true, lockedUntil: record.lockedUntil };
  }

  attemptRecords.set(ipAddress, record);
  return { remainingAttempts: TEST_MAX_ATTEMPTS - record.failedAttempts, isLocked: false, lockedUntil: null };
}

export async function isIpLocked(ipAddress: string): Promise<boolean> {
  const record = await getOrCreateAttemptRecord(ipAddress);
  return Boolean(record.lockedUntil && record.lockedUntil.getTime() > Date.now());
}

export async function getRemainingLockoutTime(ipAddress: string): Promise<number> {
  const record = await getOrCreateAttemptRecord(ipAddress);
  return record.lockedUntil ? Math.max(0, record.lockedUntil.getTime() - Date.now()) : 0;
}

export async function resetAttempts(ipAddress: string): Promise<void> {
  const record = await getOrCreateAttemptRecord(ipAddress);
  attemptRecords.set(ipAddress, { ...record, failedAttempts: 0, lockedUntil: null });
}

function log(m: string) { console.log(`[Database] ${m}`); }

export function getDb() {
  if (_db) return _db;
  const raw = process.env.DATABASE_URL || "";
  if (!raw) { log("No DATABASE_URL"); return null; }
  log(`process.env.DATABASE_URL present: true len=${raw.length}`);

  const isAiven = raw.includes("aivencloud.com") || raw.includes("aiven");
  let clean = raw;
  const q = clean.indexOf("?");
  if (q !== -1 && isAiven) clean = clean.slice(0, q);

  if (isAiven) log("Detected Aiven, enabling SSL (rejectUnauthorized:false)");

  try {
    const pool = mysql.createPool({
      uri: clean,
      ssl: isAiven ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
    } as any);
    _db = drizzle(pool);
    log("Connected to MySQL - pool created");
    return _db;
  } catch (e: any) {
    log(`Pool error ${e?.message}`);
    return null;
  }
}
