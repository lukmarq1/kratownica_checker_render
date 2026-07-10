import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const ipBlacklist = mysqlTable("ip_blacklist", {
  id: int("id").autoincrement().primaryKey(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull().unique(),
  reason: text("reason"),
  manuallyUnlocked: int("manuallyUnlocked").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IpBlacklist = typeof ipBlacklist.$inferSelect;
export type InsertIpBlacklist = typeof ipBlacklist.$inferInsert;

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const angleAttempts = mysqlTable("angle_attempts", {
  id: int("id").autoincrement().primaryKey(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull().unique(),
  failedAttempts: int("failedAttempts").notNull().default(0),
  lastAttemptAt: timestamp("lastAttemptAt").defaultNow().notNull(),
  lockedUntil: timestamp("lockedUntil"),
  isRepeatedOffender: int("isRepeatedOffender").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AngleAttempt = typeof angleAttempts.$inferSelect;
export type InsertAngleAttempt = typeof angleAttempts.$inferInsert;

/**
 * 🔥 ROZSZERZONA TABELA – zawiera wszystkie pola geolokalizacyjne
 */
export const attemptHistory = mysqlTable("attempt_history", {
  id: int("id").autoincrement().primaryKey(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(),
  angle: varchar("angle", { length: 10 }).notNull(),
  isCorrect: int("isCorrect").notNull(),
  attemptNumber: int("attemptNumber").notNull(),
  userAgent: text("userAgent"),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  isp: varchar("isp", { length: 100 }),
  // 🔥 NOWE POLA – geolokalizacja szczegółowa
  org: varchar("org", { length: 100 }),
  as: varchar("as", { length: 100 }),
  timezone: varchar("timezone", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  browserFamily: varchar("browserFamily", { length: 50 }),
  osFamily: varchar("osFamily", { length: 50 }),
  deviceType: varchar("deviceType", { length: 50 }),
  fingerprint: varchar("fingerprint", { length: 191 }),
  deviceId: varchar("deviceId", { length: 191 }),
  isVpn: int("isVpn").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AttemptHistory = typeof attemptHistory.$inferSelect;
export type InsertAttemptHistory = typeof attemptHistory.$inferInsert;

export const userDeviceProfiles = mysqlTable("user_device_profiles", {
  id: int("id").autoincrement().primaryKey(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull().unique(),
  totalAttempts: int("totalAttempts").notNull().default(0),
  successfulAttempts: int("successfulAttempts").notNull().default(0),
  failedAttempts: int("failedAttempts").notNull().default(0),
  successRate: varchar("successRate", { length: 10 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  isp: varchar("isp", { length: 100 }),
  browserFamily: varchar("browserFamily", { length: 50 }),
  osFamily: varchar("osFamily", { length: 50 }),
  deviceType: varchar("deviceType", { length: 50 }),
  userAgents: text("userAgents"),
  lastAttemptAt: timestamp("lastAttemptAt"),
  firstAttemptAt: timestamp("firstAttemptAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserDeviceProfile = typeof userDeviceProfiles.$inferSelect;
export type InsertUserDeviceProfile = typeof userDeviceProfiles.$inferInsert;

/**
 * Trwały (przetrwa restart / działa na wielu instancjach) magazyn blokad.
 * Jeden wiersz na "klucz" (fingerprint / deviceId / IP / subnet / geo / ASN).
 * To zastępuje dawny in-memory `attemptStore` z routers.ts.
 */
export const lockKeys = mysqlTable("lock_keys", {
  id: int("id").autoincrement().primaryKey(),
  lockKey: varchar("lockKey", { length: 191 }).notNull().unique(),
  keyType: varchar("keyType", { length: 20 }).notNull(), // fingerprint | device | ip | subnet | geo | asn
  failedAttempts: int("failedAttempts").notNull().default(0),
  lockedUntil: timestamp("lockedUntil"),
  firstSeen: timestamp("firstSeen").defaultNow().notNull(),
  lastSeen: timestamp("lastSeen").defaultNow().notNull(),
  totalAttempts: int("totalAttempts").notNull().default(0),
  successfulAttempts: int("successfulAttempts").notNull().default(0),
  isRepeatedOffender: int("isRepeatedOffender").notNull().default(0),
  ipsJson: text("ipsJson"),
  fingerprintsJson: text("fingerprintsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LockKey = typeof lockKeys.$inferSelect;
export type InsertLockKey = typeof lockKeys.$inferInsert;