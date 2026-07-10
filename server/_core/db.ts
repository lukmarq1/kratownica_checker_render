// server/db.ts - FINAL FIX dla Aiven + Render + debug logi
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let ENV: any = {};
try {
  const mod = require("./_core/env");
  ENV = mod.ENV || mod.default || {};
} catch {}

let pool: mysql.Pool | null = null;
let dbInstance: any = null;

function log(...args: any[]) {
  console.log("[Database]",...args);
}

export function getDb() {
  if (dbInstance) return dbInstance;

  const envUrl = ENV?.databaseUrl || ENV?.DATABASE_URL || "";
  const procUrl = (typeof process!== "undefined"? (process as any).env?.DATABASE_URL : "") || "";
  const rawUrl = (envUrl || procUrl || "").trim();

  log(`ENV.databaseUrl present: ${!!envUrl} len=${String(envUrl).length}`);
  log(`process.env.DATABASE_URL present: ${!!procUrl} len=${String(procUrl).length}`);

  if (!rawUrl) {
    log("No DATABASE_URL set - using in-memory mode");
    log("Available env keys containing DATABASE:", Object.keys((process as any).env || {}).filter((k: string) => k.includes("DATABASE")));
    return null;
  }

  try {
    const urlWithoutQuery = rawUrl.split("?")[0];
    const hasQuery = rawUrl.includes("?");
    const queryPart = hasQuery? rawUrl.split("?").slice(1).join("?") : "";
    const isAiven = rawUrl.includes("aivencloud.com") || queryPart.includes("ssl-mode") || rawUrl.includes("aiven");

    if (!pool) {
      if (isAiven) {
        log("Detected Aiven, enabling SSL (stripping query, rejectUnauthorized:true)");
        pool = mysql.createPool({
          uri: urlWithoutQuery,
          ssl: { rejectUnauthorized: true },
          waitForConnections: true,
          connectionLimit: 5,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        } as any);
      } else {
        log("Using standard MySQL pool (non-Aiven)");
        pool = mysql.createPool(rawUrl);
      }
    }

    dbInstance = drizzle(pool as any);
    log("Connected to MySQL - pool created");
    return dbInstance;
  } catch (e: any) {
    log("Failed to create pool", e?.message || e);
    console.error(e);
    return null;
  }
}

export async function getUserByOpenId(_openId: string) { return null as any; }
export async function upsertUser(_data: any) { return null as any; }
export async function getUserById(_id: string) { return null as any; }

const dbExport: any = { getDb, getUserByOpenId, upsertUser, getUserById };
export default dbExport;