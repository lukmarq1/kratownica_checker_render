import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let _db: any = null;

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