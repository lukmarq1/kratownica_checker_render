// server/db.ts - POPRAWIONE ŚCIEŻKI
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ENV } from "./_core/env";

let pool: mysql.Pool | null = null;
let db: any = null;

export function getDb() {
  if (db) return db;
  const rawUrl = ENV.databaseUrl || process.env.DATABASE_URL || "";
  if (!rawUrl) {
    console.log("[Database] No DATABASE_URL set - using in-memory mode");
    return null;
  }
  try {
    const urlWithoutQuery = rawUrl.split("?")[0];
    const isAiven = rawUrl.includes("aivencloud.com") || rawUrl.includes("ssl-mode");
    if (!pool) {
      if (isAiven) {
        console.log("[Database] Detected Aiven, enabling SSL");
        pool = mysql.createPool({
          uri: urlWithoutQuery,
          ssl: { rejectUnauthorized: true },
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        });
      } else {
        pool = mysql.createPool(rawUrl);
      }
    }
    db = drizzle(pool as any);
    console.log("[Database] Connected to MySQL - pool created");
    return db;
  } catch (e) {
    console.error("[Database] Failed to create pool", e);
    return null;
  }
}