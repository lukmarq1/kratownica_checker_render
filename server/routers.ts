import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  getOrCreateAttemptRecord,
  isIpLocked,
  getRemainingLockoutTime,
  recordFailedAttempt,
  resetAttempts,
  recordAttemptHistory,
  getAllAttempts,
  getAdminStats,
  unlockIp,
  getDb,
} from "./db";
import {
  recordAttemptWithTracking,
  getAdvancedAnalytics,
  getUserProfileWithTracking,
  exportAttemptDataAsCSV,
  fetchGeolocation,
} from "./dbEnhanced";
import { angleAttempts } from "../drizzle/schema";
import { parseUserAgent } from "./userAgentParser";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  angle: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const xForwardedFor = ctx.req.headers["x-forwarded-for"];
      let ipAddress = "unknown";
      if (xForwardedFor) {
        const ips = Array.isArray(xForwardedFor) ? xForwardedFor : xForwardedFor.split(",");
        const firstIp = (ips[0] || "").trim();
        if (firstIp && firstIp !== "unknown") ipAddress = firstIp;
      }
      if (ipAddress === "unknown" && ctx.req.ip && ctx.req.ip !== "unknown") {
        ipAddress = ctx.req.ip;
      }
      const locked = await isIpLocked(ipAddress);
      const remainingMs = locked ? await getRemainingLockoutTime(ipAddress) : 0;
      const record = await getOrCreateAttemptRecord(ipAddress);

      return {
        isLocked: locked,
        failedAttempts: record.failedAttempts || 0,
        remainingAttempts: Math.max(0, 2 - (record.failedAttempts || 0)),
        remainingLockoutMs: remainingMs,
      };
    }),

    verify: publicProcedure
      .input(z.object({
        angle: z.number().min(0).max(360),
        browser: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // TYMCZASOWO: pomiń autoryzację dla testów
        ctx.user = { 
          id: 1, 
          openId: "test-user", 
          name: "Test", 
          email: "test@test.com", 
          loginMethod: "test", 
          role: "admin", 
          createdAt: new Date(), 
          updatedAt: new Date(), 
          lastSignedIn: new Date() 
        };

        const xForwardedFor = ctx.req.headers["x-forwarded-for"];
        let ipAddress = "unknown";
        if (xForwardedFor) {
          const ips = Array.isArray(xForwardedFor) ? xForwardedFor : xForwardedFor.split(",");
          const firstIp = (ips[0] || "").trim();
          if (firstIp && firstIp !== "unknown") ipAddress = firstIp;
        }
        if (ipAddress === "unknown" && ctx.req.ip && ctx.req.ip !== "unknown") {
          ipAddress = ctx.req.ip;
        }
        if (ipAddress === "unknown") {
          const userAgent = ctx.req.headers["user-agent"] || "";
          const acceptLanguage = ctx.req.headers["accept-language"] || "";
          ipAddress = `fallback-${Buffer.from(userAgent + acceptLanguage).toString("base64").slice(0, 16)}`;
        }

        const isLockedNow = await isIpLocked(ipAddress);
        if (isLockedNow) {
          const remainingMs = await getRemainingLockoutTime(ipAddress);
          return {
            success: false,
            reason: "locked",
            remainingLockoutMs: remainingMs,
          };
        }

        const correctAngle = 65;
        const tolerance = 0.5;
        const isCorrect =
          input.angle >= correctAngle - tolerance &&
          input.angle <= correctAngle + tolerance;

        // Pobieramy dane geolokalizacyjne dla IP
        let geoData = null;
        if (ipAddress && ipAddress !== "unknown") {
          try {
            geoData = await fetchGeolocation(ipAddress);
            console.log("[Geolocation] Data fetched:", JSON.stringify(geoData));
          } catch (e) {
            console.error("[Geolocation] Error fetching geo data:", e);
          }
        }

        // Parsujemy User-Agent
        const userAgent = ctx.req.headers["user-agent"] || "unknown";
        const parsedUA = parseUserAgent(userAgent);

        // Jeśli przysłano z frontendu – NADPISUJEMY
        if (input.browser) {
          parsedUA.browserFamily = input.browser;
          console.log("[Browser] Override z frontendu:", input.browser);
        }
        console.log("[UserAgent] Parsed:", JSON.stringify(parsedUA));

        const record = await getOrCreateAttemptRecord(ipAddress);
        const attemptNumber = (record.failedAttempts || 0) + 1;

        if (isCorrect) {
          await resetAttempts(ipAddress);
          await recordAttemptHistory(
            ipAddress,
            input.angle,
            true,
            attemptNumber,
            userAgent,
            geoData || undefined,
            parsedUA
          );
          await recordAttemptWithTracking(ipAddress, input.angle, true, attemptNumber, userAgent).catch(err =>
            console.error("[Tracking] Error:", err)
          );
          return {
            success: true,
            reason: "correct",
            angle: input.angle,
          };
        } else {
          const result = await recordFailedAttempt(ipAddress);
          await recordAttemptHistory(
            ipAddress,
            input.angle,
            false,
            attemptNumber,
            userAgent,
            geoData || undefined,
            parsedUA
          );
          await recordAttemptWithTracking(ipAddress, input.angle, false, attemptNumber, userAgent).catch(err =>
            console.error("[Tracking] Error:", err)
          );
          return {
            success: false,
            reason: "incorrect",
            remainingAttempts: result.remainingAttempts,
            isLocked: result.isLocked,
            lockedUntil: result.lockedUntil,
            remainingLockoutMs: result.isLocked
              ? (result.lockedUntil?.getTime() || 0) - Date.now()
              : 0,
          };
        }
      }),
  }),

  admin: router({
    getAttempts: publicProcedure
      .input(z.object({ limit: z.number().default(100), offset: z.number().default(0) }))
      .query(async ({ input }) => {
        return await getAllAttempts(input.limit, input.offset);
      }),

    getStats: publicProcedure.query(async () => {
      return await getAdminStats();
    }),

    getAdvancedAnalytics: publicProcedure.query(async () => {
      return await getAdvancedAnalytics();
    }),

    getUserProfile: publicProcedure
      .input(z.object({ ipAddress: z.string() }))
      .query(async ({ input }) => {
        return await getUserProfileWithTracking(input.ipAddress);
      }),

    exportData: publicProcedure.query(async () => {
      return await exportAttemptDataAsCSV();
    }),

    unlockIp: publicProcedure
      .input(z.object({ ipAddress: z.string() }))
      .mutation(async ({ input }) => {
        await unlockIp(input.ipAddress);
        return { success: true, ipAddress: input.ipAddress };
      }),

    verifyPin: publicProcedure
      .input(z.object({ pin: z.string() }))
      .mutation(async ({ input }) => {
        const adminPin = ENV.adminPin;
        if (!adminPin) {
          return { success: false, error: "Admin PIN not configured" };
        }
        const isValid = input.pin === adminPin;
        return { success: isValid };
      }),

    getLockedIPs: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const locked = await db
        .select()
        .from(angleAttempts)
        .where(sql`${angleAttempts.lockedUntil} > NOW()`);
      return locked.map((r) => r.ipAddress);
    }),
  }),
});

export type AppRouter = typeof appRouter;