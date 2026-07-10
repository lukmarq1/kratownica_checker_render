// server/_core/db.ts - FIXED dla Aiven MySQL
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { ENV } from "./env";

let pool: mysql.Pool | null = null;
let db: any = null;

export function getDb() {
  if (db) return db;
  
  const rawUrl = ENV.databaseUrl || process.env.DATABASE_URL || "";
  if (!rawUrl) {
    console.log("[Database] No DATABASE_URL set");
    return null;
  }

  try {
    // Aiven URL ma postać: mysql://user:pass@host:port/db?ssl-mode=REQUIRED
    // mysql2 nie rozumie ?ssl-mode=REQUIRED, trzeba usunąć query i dodać ssl: true
    const urlWithoutQuery = rawUrl.split("?")[0];
    const isAiven = rawUrl.includes("aivencloud.com") || rawUrl.includes("ssl-mode");

    if (!pool) {
      if (isAiven) {
        console.log("[Database] Detected Aiven, enabling SSL");
        pool = mysql.createPool({
          uri: urlWithoutQuery,
          ssl: {
            // Aiven używa Let's Encrypt, rejectUnauthorized: true jest OK
            // jeśli masz problemy z certem, zmień na { rejectUnauthorized: false }
            rejectUnauthorized: true,
          },
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

// Helper do testu połączenia
export async function testConnection() {
  const database = getDb();
  if (!database) return false;
  try {
    // proste query
    await (database as any).execute("SELECT 1");
    console.log("[Database] Test query OK");
    return true;
  } catch (e) {
    console.error("[Database] Test query failed", e);
    return false;
  }
}
