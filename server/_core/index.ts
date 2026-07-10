import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";

function findPublicPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "dist", "public"),
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "..", "dist", "public"),
    path.resolve(process.cwd(), "src", "dist", "public"),
    "/opt/render/project/dist/public",
    "/opt/render/project/src/dist/public",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      return p;
    }
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

async function getApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const publicPath = findPublicPath();
  console.log("[Static] CWD:", process.cwd());
  console.log("[Static] Serving from:", publicPath);
  console.log("[Static] Exists:", fs.existsSync(publicPath));

  app.use(express.static(publicPath));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    const indexFile = path.join(publicPath, "index.html");
    if (!fs.existsSync(indexFile)) {
      return res.status(404).send(`Frontend not found. Checked: ${publicPath}`);
    }
    res.sendFile(indexFile);
  });

  return app;
}

async function startServer() {
  const app = await getApp();
  const port = Number(process.env.PORT) || 10000;

  // --- FIX: Prawdziwa inicjalizacja bazy z obsługą Aiven ---
  try {
    const dbMod = await import("./db");
    const getDb = dbMod.getDb || (dbMod.default && dbMod.default.getDb);
    if (typeof getDb === "function") {
      const db = getDb();
      if (db) {
        console.log("[Database] Connected - will use MySQL (via _core/db.ts)");
      } else {
        console.log("[Database] No DATABASE_URL or init failed - running in-memory mode");
        console.log("[Database] ENV check: DATABASE_URL present =",!!process.env.DATABASE_URL, "len =", String(process.env.DATABASE_URL || "").length);
      }
    } else {
      console.log("[Database] getDb not found in./db, running in-memory");
    }
  } catch (e: any) {
    console.log("[Database] Init error, fallback to memory:", e?.message || e);
  }

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});