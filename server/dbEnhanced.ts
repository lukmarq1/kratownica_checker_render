import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { attemptHistory, userDeviceProfiles, angleAttempts } from "../drizzle/schema";

/**
 * Fetch geolocation data from IP address using ip-api.com
 * 🔥 ROZSZERZONA WERSJA – pobiera org, as, timezone, zip
 */
export async function fetchGeolocation(ip: string) {
  try {
    // Skip for localhost/private IPs
    if (ip === "127.0.0.1" || ip === "localhost" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
      return {
        country: "Local",
        city: "Local",
        latitude: null,
        longitude: null,
        isp: "Local Network",
        org: "Local",
        as: "Local",
        timezone: "Local",
        zip: "00-000",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // 🔥 PROSTY URL – bez parametrów fields
    const response = await fetch(`http://ip-api.com/json/${ip}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Geolocation] Failed to fetch for IP ${ip}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.status !== "success") {
      console.warn(`[Geolocation] API error for IP ${ip}: ${data.message}`);
      return null;
    }

    return {
      country: data.country || "Unknown",
      city: data.city || "Unknown",
      latitude: data.lat ? String(data.lat) : null,
      longitude: data.lon ? String(data.lon) : null,
      isp: data.isp || "Unknown",
      org: data.org || "Unknown",
      as: data.as || "Unknown",
      timezone: data.timezone || "Unknown",
      zip: data.zip || "Unknown",
    };
  } catch (error) {
    console.error(`[Geolocation] Error fetching for IP ${ip}:`, error);
    return null;
  }
}

/**
 * ANALYTICS DISABLED - recordAttemptWithTracking is disabled
 */
export async function recordAttemptWithTracking() {
  // Analytics disabled - no tracking
  return;
}

/**
 * Get advanced analytics for admin dashboard
 */
export async function getAdvancedAnalytics() {
  const db = await getDb();
  if (!db) return null;

  try {
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(attemptHistory);
    const totalAttempts = totalResult[0]?.count || 0;

    const successResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(attemptHistory)
      .where(sql`${attemptHistory.isCorrect} = 1`);
    const successfulAttempts = successResult[0]?.count || 0;

    const uniqueIpsResult = await db
      .select({ count: sql<number>`count(distinct ${attemptHistory.ipAddress})` })
      .from(attemptHistory);
    const uniqueIps = uniqueIpsResult[0]?.count || 0;

    const geoResult = await db
      .select({
        country: attemptHistory.country,
        count: sql<number>`count(*)`,
      })
      .from(attemptHistory)
      .groupBy(attemptHistory.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const deviceResult = await db
      .select({
        deviceType: attemptHistory.deviceType,
        count: sql<number>`count(*)`,
      })
      .from(attemptHistory)
      .groupBy(attemptHistory.deviceType)
      .orderBy(desc(sql`count(*)`));

    const browserResult = await db
      .select({
        browserFamily: attemptHistory.browserFamily,
        count: sql<number>`count(*)`,
      })
      .from(attemptHistory)
      .groupBy(attemptHistory.browserFamily)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const offendersResult = await db
      .select()
      .from(userDeviceProfiles)
      .where(sql`${userDeviceProfiles.failedAttempts} >= 2`)
      .orderBy(desc(userDeviceProfiles.failedAttempts))
      .limit(20);

    const countryStatsResult = await db
      .select({
        country: attemptHistory.country,
        total: sql<number>`count(*)`,
        successful: sql<number>`sum(case when ${attemptHistory.isCorrect} = 1 then 1 else 0 end)`,
      })
      .from(attemptHistory)
      .groupBy(attemptHistory.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return {
      totalAttempts,
      successfulAttempts,
      failedAttempts: totalAttempts - successfulAttempts,
      successRate: totalAttempts > 0 ? ((successfulAttempts / totalAttempts) * 100).toFixed(2) : "0.00",
      uniqueIps,
      geographicDistribution: geoResult,
      deviceDistribution: deviceResult,
      browserDistribution: browserResult,
      repeatOffenders: offendersResult,
      countryStats: countryStatsResult,
    };
  } catch (error) {
    console.error("[getAdvancedAnalytics] Error:", error);
    return null;
  }
}

export async function getUserProfileWithTracking(ipAddress: string) {
  const db = await getDb();
  if (!db) return null;

  try {
    const profile = await db
      .select()
      .from(userDeviceProfiles)
      .where(eq(userDeviceProfiles.ipAddress, ipAddress))
      .limit(1);

    if (profile.length === 0) return null;

    const p = profile[0];

    const attempts = await db
      .select()
      .from(attemptHistory)
      .where(eq(attemptHistory.ipAddress, ipAddress))
      .orderBy(desc(attemptHistory.createdAt));

    let userAgents: string[] = [];
    if (p.userAgents) {
      try {
        userAgents = JSON.parse(p.userAgents);
      } catch (e) {
        userAgents = [];
      }
    }

    return {
      ...p,
      userAgents,
      attempts,
      isRepeatOffender: (p.failedAttempts || 0) >= 2,
    };
  } catch (error) {
    console.error("[getUserProfileWithTracking] Error:", error);
    return null;
  }
}

/**
 * Export all attempt data as CSV
 * 🔥 ROZSZERZONY o org, as, timezone, zip
 */
export async function exportAttemptDataAsCSV() {
  const db = await getDb();
  if (!db) return "";

  try {
    const attempts = await db
      .select()
      .from(attemptHistory)
      .orderBy(desc(attemptHistory.createdAt));

    const headers = [
      "IP Address",
      "Angle",
      "Correct",
      "Attempt #",
      "Browser",
      "OS",
      "Device",
      "Country",
      "City",
      "ISP",
      "Org",
      "AS",
      "Timezone",
      "Zip",
      "Latitude",
      "Longitude",
      "User Agent",
      "Timestamp",
    ];

    const rows = attempts.map((a) => [
      a.ipAddress,
      a.angle,
      a.isCorrect === 1 ? "YES" : "NO",
      a.attemptNumber,
      a.browserFamily || "unknown",
      a.osFamily || "unknown",
      a.deviceType || "unknown",
      a.country || "unknown",
      a.city || "unknown",
      a.isp || "unknown",
      a.org || "unknown",
      a.as || "unknown",
      a.timezone || "unknown",
      a.zip || "unknown",
      a.latitude || "",
      a.longitude || "",
      `"${(a.userAgent || "").replace(/"/g, '""')}"`,
      new Date(a.createdAt).toISOString(),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return csv;
  } catch (error) {
    console.error("[exportAttemptDataAsCSV] Error:", error);
    return "";
  }
}