import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, angleAttempts, attemptHistory } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _connection: mysql.Connection | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Tworzymy połączenie z obsługą SSL
      const connection = await mysql.createConnection({
        uri: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false // Tymczasowo dla testów
        }
      });
      _connection = connection;
      _db = drizzle(connection);
      console.log("[Database] Connected successfully");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Reszta kodu pozostaje bez zmian...
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getOrCreateAttemptRecord(ipAddress: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const existing = await db
      .select()
      .from(angleAttempts)
      .where(eq(angleAttempts.ipAddress, ipAddress))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    await db.insert(angleAttempts).values({
      ipAddress,
      failedAttempts: 0,
    });

    const created = await db
      .select()
      .from(angleAttempts)
      .where(eq(angleAttempts.ipAddress, ipAddress))
      .limit(1);

    return created[0];
  } catch (error) {
    console.error("[Database] Error in getOrCreateAttemptRecord:", error);
    throw error;
  }
}

export async function isIpLocked(ipAddress: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const record = await db
    .select()
    .from(angleAttempts)
    .where(eq(angleAttempts.ipAddress, ipAddress))
    .limit(1);

  if (!record.length) return false;

  const attempt = record[0];
  if (!attempt.lockedUntil) return false;

  const now = new Date();
  if (now > attempt.lockedUntil) {
    await db
      .update(angleAttempts)
      .set({ lockedUntil: null, failedAttempts: 0 })
      .where(eq(angleAttempts.ipAddress, ipAddress));
    return false;
  }

  return true;
}

export async function getRemainingLockoutTime(ipAddress: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const record = await db
    .select()
    .from(angleAttempts)
    .where(eq(angleAttempts.ipAddress, ipAddress))
    .limit(1);

  if (!record.length || !record[0].lockedUntil) return 0;

  const now = new Date();
  const remaining = record[0].lockedUntil.getTime() - now.getTime();
  return Math.max(0, remaining);
}

export async function recordFailedAttempt(ipAddress: string): Promise<{
  isLocked: boolean;
  remainingAttempts: number;
  lockedUntil?: Date | null;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const record = await getOrCreateAttemptRecord(ipAddress);
  const newFailedCount = (record.failedAttempts || 0) + 1;

  let lockedUntil: Date | null = null;
  if (newFailedCount >= 2) {
    lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  await db
    .update(angleAttempts)
    .set({
      failedAttempts: newFailedCount,
      lastAttemptAt: new Date(),
      lockedUntil,
    })
    .where(eq(angleAttempts.ipAddress, ipAddress));

  return {
    isLocked: newFailedCount >= 2,
    remainingAttempts: Math.max(0, 2 - newFailedCount),
    lockedUntil: lockedUntil || undefined,
  };
}

export async function resetAttempts(ipAddress: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(angleAttempts)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastAttemptAt: new Date(),
    })
    .where(eq(angleAttempts.ipAddress, ipAddress));
}

export async function unlockIp(ipAddress: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[unlockIp] Database not available");
    return;
  }

  try {
    await db
      .update(angleAttempts)
      .set({
        failedAttempts: 0,
        lockedUntil: null,
        lastAttemptAt: new Date(),
      })
      .where(eq(angleAttempts.ipAddress, ipAddress));
    console.log(`[unlockIp] IP ${ipAddress} unlocked successfully`);
  } catch (error) {
    console.error("[unlockIp] Error unlocking IP:", error);
    throw error;
  }
}

export async function recordAttemptHistory(
  ipAddress: string,
  angle: number,
  isCorrect: boolean,
  attemptNumber: number,
  userAgent?: string,
  geoData?: {
    country?: string;
    city?: string;
    latitude?: string;
    longitude?: string;
    isp?: string;
    org?: string;
    as?: string;
    timezone?: string;
    zip?: string;
  },
  parsedUA?: {
    browserFamily?: string;
    osFamily?: string;
    deviceType?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[recordAttemptHistory] Database not available");
    return;
  }

  try {
    await db.insert(attemptHistory).values({
      ipAddress,
      angle: angle.toString(),
      isCorrect: isCorrect ? 1 : 0,
      attemptNumber,
      userAgent: userAgent || "unknown",
      country: geoData?.country || null,
      city: geoData?.city || null,
      latitude: geoData?.latitude || null,
      longitude: geoData?.longitude || null,
      isp: geoData?.isp || null,
      org: geoData?.org || null,
      as: geoData?.as || null,
      timezone: geoData?.timezone || null,
      zip: geoData?.zip || null,
      browserFamily: parsedUA?.browserFamily || null,
      osFamily: parsedUA?.osFamily || null,
      deviceType: parsedUA?.deviceType || null,
    });
  } catch (error) {
    console.error("[recordAttemptHistory] Error recording attempt:", error);
  }
}

export async function getAllAttempts(limit: number = 100, offset: number = 0) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(attemptHistory)
    .orderBy(desc(attemptHistory.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getAdminStats() {
  const db = await getDb();
  if (!db) return null;

  try {
    const allAttempts = await db.select().from(attemptHistory).catch(() => []);
    const uniqueIps = new Set(allAttempts.map((a) => a.ipAddress));
    const successfulAttempts = allAttempts.filter((a) => a.isCorrect === 1).length;
    const lockedRecords = await db.select().from(angleAttempts).catch(() => []);
    const currentlyLockedIps = lockedRecords.filter((r) => r.lockedUntil && r.lockedUntil > new Date()).length;

    return {
      totalAttempts: allAttempts.length,
      uniqueIps: uniqueIps.size,
      successfulAttempts,
      failedAttempts: allAttempts.length - successfulAttempts,
      currentlyLockedIps,
    };
  } catch (error) {
    console.error("[Admin Stats] Error:", error);
    return {
      totalAttempts: 0,
      uniqueIps: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      currentlyLockedIps: 0,
    };
  }
}