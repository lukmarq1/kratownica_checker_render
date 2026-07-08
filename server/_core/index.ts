import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initializeDatabase } from "../db-init";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Render daje PORT=10000 automatycznie
  const port = parseInt(process.env.PORT || "10000");

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Health check - wymagany przez Render
  app.get("/", (req, res) => {
    res.status(200).send("OK - kratownica checker");
  });

  // Twoje istniejące rejestracje - ZOSTAW JE
  // @ts-ignore
  if (typeof registerStorageProxy!== "undefined") registerStorageProxy(app);
  // @ts-ignore
  if (typeof registerOAuthRoutes!== "undefined") registerOAuthRoutes(app);

  // tRPC
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // 1. NAJPIERW otwórz port - żeby Render go od razu wykrył
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });

  // 2. DOPIERO potem baza danych
  try {
    await initializeDatabase();
    console.log("[Database] Connected successfully");
  } catch (error) {
    console.error("[Server] Failed to initialize database:", error);
  }
}

startServer().catch(console.error);