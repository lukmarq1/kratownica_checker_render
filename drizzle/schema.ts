import { mysqlTable, varchar, int, datetime, tinyint, text, double } from "drizzle-orm/mysql-core";

export const attemptHistory = mysqlTable("attempt_history", {
  id: varchar("id", { length: 191 }).primaryKey(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(),
  fingerprint: varchar("fingerprint", { length: 191 }).notNull().default("unknown"),
  deviceId: varchar("deviceId", { length: 191 }).notNull().default("unknown"),
  angle: double("angle").notNull(),
  isCorrect: tinyint("isCorrect").notNull(),
  country: varchar("country", { length: 191 }).notNull().default("Unknown"),
  city: varchar("city", { length: 191 }).notNull().default("Unknown"),
  zip: varchar("zip", { length: 32 }).default(""),
  timezone: varchar("timezone", { length: 191 }).default(""),
  isp: varchar("isp", { length: 255 }).default(""),
  org: varchar("org", { length: 255 }).default(""),
  as: varchar("as", { length: 255 }).default(""),
  latitude: varchar("latitude", { length: 32 }).default(""),
  longitude: varchar("longitude", { length: 32 }).default(""),
  browserFamily: varchar("browserFamily", { length: 191 }).default("Unknown"),
  osFamily: varchar("osFamily", { length: 191 }).default("Unknown"),
  deviceType: varchar("deviceType", { length: 64 }).default("desktop"),
  userAgent: text("userAgent"),
  isVpn: tinyint("isVpn").notNull().default(0),
  createdAt: datetime("createdAt", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const lockKeys = mysqlTable("lock_keys", {
  id: varchar("id", { length: 191 }).primaryKey(),
  lockedUntil: datetime("lockedUntil", { mode: "date" }).notNull(),
  failedAttempts: int("failedAttempts").notNull().default(0),
  createdAt: datetime("createdAt", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  updatedAt: datetime("updatedAt", { mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
});
