/**
 * FINAL FIX - Simple user agent parser
 * Naprawia: Windows=Unknown, Android=Linux, Samsung=Chrome
 */

export interface ParsedUserAgent {
  browserFamily: string;
  osFamily: string;
  deviceType: string;
  browser: string;
  os: string;
  device: string;
}

export function parseUserAgent(
  userAgent: string,
  headers?: Record<string, string | string[] | undefined>
): ParsedUserAgent {
  if (!userAgent) {
    return {
      browserFamily: "Unknown",
      osFamily: "Unknown",
      deviceType: "desktop",
      browser: "Unknown",
      os: "Unknown",
      device: "desktop",
    };
  }

  const ua = userAgent.toLowerCase();

  if (headers) {
    const braveVersion = headers["x-brave-version"] || headers["brave-version"];
    if (braveVersion) {
      const os = detectOS(ua);
      const device = detectDevice(ua);
      return {
        browserFamily: "Brave",
        osFamily: os,
        deviceType: device,
        browser: "Brave",
        os: os,
        device: device,
      };
    }
  }

  let browserFamily = "Unknown";
  if (ua.includes("edg") || ua.includes("edge")) {
    browserFamily = "Edge";
  } else if (ua.includes("opr") || ua.includes("opera")) {
    browserFamily = "Opera";
  } else if (ua.includes("vivaldi")) {
    browserFamily = "Vivaldi";
  } else if (ua.includes("arc")) {
    browserFamily = "Arc";
  } else if (ua.includes("firefox") || ua.includes("fxios")) {
    browserFamily = "Firefox";
  } else if (ua.includes("samsungbrowser")) {
    browserFamily = "Samsung Internet";
  } else if (ua.includes("ucbrowser") || ua.includes("uc browser")) {
    browserFamily = "UC Browser";
  } else if (ua.includes("duckduckgo")) {
    browserFamily = "DuckDuckGo";
  } else if (ua.includes("ecosia")) {
    browserFamily = "Ecosia";
  } else if (ua.includes("safari") && !ua.includes("chrome") && !ua.includes("chromium") && !ua.includes("crios")) {
    browserFamily = "Safari";
  } else if (ua.includes("chrome") || ua.includes("crios")) {
    browserFamily = "Chrome";
  } else if (ua.includes("trident") || ua.includes("msie")) {
    browserFamily = "Internet Explorer";
  }

  const osFamily = detectOS(ua);
  const deviceType = detectDevice(ua);

  return {
    browserFamily,
    osFamily,
    deviceType,
    browser: browserFamily,
    os: osFamily,
    device: deviceType,
  };
}

function detectOS(ua: string): string {
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || ua.includes("ios")) return "iOS";
  if (ua.includes("cros") || ua.includes("chrome os")) return "Chrome OS";
  if (ua.includes("mac os x") || ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("freebsd")) return "FreeBSD";
  if (ua.includes("openbsd")) return "OpenBSD";
  return "Unknown";
}

function detectDevice(ua: string): string {
  if (ua.includes("tablet") || ua.includes("ipad") || ua.includes("kindle")) {
    return "tablet";
  }
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android") || ua.includes("blackberry")) {
    return "mobile";
  }
  return "desktop";
}