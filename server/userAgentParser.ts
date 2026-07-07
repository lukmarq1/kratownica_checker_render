/**
 * Simple user agent parser to extract browser, OS, and device type.
 * 🔥 ROZSZERZONA WERSJA – rozpoznaje wszystkie popularne przeglądarki
 * + obsługa nagłówków Brave (X-Brave-Version / Brave-Version)
 */
export interface ParsedUserAgent {
  browserFamily: string;
  osFamily: string;
  deviceType: string;
}

export function parseUserAgent(
  userAgent: string,
  headers?: Record<string, string | string[] | undefined>
): ParsedUserAgent {
  if (!userAgent) {
    return {
      browserFamily: "unknown",
      osFamily: "unknown",
      deviceType: "unknown",
    };
  }

  const ua = userAgent.toLowerCase();

  // ============================================================
  // 🔥 DETEKCJA PRZEGLĄDARKI (kolejność ma znaczenie!)
  // ============================================================
  let browserFamily = "unknown";

  // 0. SPRAWDZAMY NAGŁÓWKI BRAVE (najpierw!)
  if (headers) {
    const braveVersion = headers["x-brave-version"] || headers["brave-version"];
    if (braveVersion) {
      browserFamily = "Brave";
      // Jeśli to Brave, pomijamy resztę detekcji
      const os = detectOS(ua);
      const device = detectDevice(ua);
      return {
        browserFamily,
        osFamily: os,
        deviceType: device,
      };
    }
  }

  // 1. Edge (musi być przed Chrome, bo Edge ma w UA "chrome")
  if (ua.includes("edg") || ua.includes("edge")) {
    browserFamily = "Edge";
  }
  // 2. Opera / Opera GX
  else if (ua.includes("opr") || ua.includes("opera")) {
    browserFamily = "Opera";
  }
  // 3. Vivaldi
  else if (ua.includes("vivaldi")) {
    browserFamily = "Vivaldi";
  }
  // 4. Arc (nowa przeglądarka)
  else if (ua.includes("arc")) {
    browserFamily = "Arc";
  }
  // 5. Firefox
  else if (ua.includes("firefox")) {
    browserFamily = "Firefox";
  }
  // 6. Safari (musi być przed Chrome, bo Safari ma "safari" ale nie "chrome")
  else if (ua.includes("safari") && !ua.includes("chrome")) {
    browserFamily = "Safari";
  }
  // 7. Chrome (najpopularniejszy)
  else if (ua.includes("chrome")) {
    browserFamily = "Chrome";
  }
  // 8. Samsung Internet
  else if (ua.includes("samsungbrowser")) {
    browserFamily = "Samsung Internet";
  }
  // 9. UC Browser
  else if (ua.includes("ucbrowser")) {
    browserFamily = "UC Browser";
  }
  // 10. Internet Explorer
  else if (ua.includes("trident") || ua.includes("msie")) {
    browserFamily = "Internet Explorer";
  }
  // 11. DuckDuckGo (przeglądarka mobilna)
  else if (ua.includes("duckduckgo")) {
    browserFamily = "DuckDuckGo";
  }
  // 12. Ecosia (przeglądarka mobilna)
  else if (ua.includes("ecosia")) {
    browserFamily = "Ecosia";
  }

  // ============================================================
  // 💻 DETEKCJA SYSTEMU OPERACYJNEGO
  // ============================================================
  const osFamily = detectOS(ua);

  // ============================================================
  // 📱 DETEKCJA TYPU URZĄDZENIA
  // ============================================================
  const deviceType = detectDevice(ua);

  return {
    browserFamily,
    osFamily,
    deviceType,
  };
}

// ============================================================
// 🛠️ FUNKCJE POMOCNICZE
// ============================================================

function detectOS(ua: string): string {
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "iOS";
  if (ua.includes("chrome os") || ua.includes("cros")) return "Chrome OS";
  if (ua.includes("freebsd")) return "FreeBSD";
  if (ua.includes("openbsd")) return "OpenBSD";
  return "unknown";
}

function detectDevice(ua: string): string {
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone") || ua.includes("blackberry")) {
    return "mobile";
  }
  if (ua.includes("tablet") || ua.includes("ipad") || ua.includes("kindle")) {
    return "tablet";
  }
  if (ua.includes("tv") || ua.includes("smart-tv") || ua.includes("googletv")) {
    return "tv";
  }
  if (ua.includes("watch") || ua.includes("apple watch")) {
    return "watch";
  }
  return "desktop";
}