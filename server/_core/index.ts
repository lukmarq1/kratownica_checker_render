import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getClientIp(req: any): string {
  const xff = req.headers["x-forwarded-for"];
  let ip = "unknown";
  if (xff) {
    const ips = Array.isArray(xff)? xff : xff.split(",");
    const first = (ips[0] || "").trim();
    if (first && first!== "unknown") ip = first;
  }
  if (ip === "unknown" && req.ip) ip = req.ip;
  return ip;
}

async function getApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // tRPC
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // static - dist/public
  const publicPath = path.resolve(__dirname, "../../dist/public");
  app.use(express.static(publicPath));

  // fallback na index.html dla SPA
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(publicPath, "index.html"));
  });

  return app;
}

async function startServer() {
  const app = await getApp();
  const port = Number(process.env.PORT) || 3000;
  console.log("[Database] Skipped - in-memory mode");
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});