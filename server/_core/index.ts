import "dotenv/config";
import express from "express";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";

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

  // Render: process.cwd() = /opt/render/project
  const publicPath = path.resolve(process.cwd(), "dist", "public");
  console.log("[Static] Serving from:", publicPath);

  app.use(express.static(publicPath));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(publicPath, "index.html"), (err) => {
      if (err) {
        console.error("Failed to send index.html:", err.message);
        res.status(404).send("Frontend not built");
      }
    });
  });

  return app;
}

async function startServer() {
  const app = await getApp();
  const port = Number(process.env.PORT) || 10000;
  console.log("[Database] Skipped - in-memory mode");
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});