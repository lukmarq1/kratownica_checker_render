import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, notFoundHandler } from "./static";

async function getApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  serveStatic(app);
  app.use(notFoundHandler);
  return app;
}

async function startServer() {
  const app = await getApp();
  const port = Number(process.env.PORT) || 3000;
  console.log("[Database] Skipped - running in-memory mode");
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});