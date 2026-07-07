/**
 * Detekcja przeglądarki po stronie frontendu
 * Wykrywa: Brave, Edge, Opera, Vivaldi, Arc, Firefox, Safari, Chrome, Samsung Internet, UC Browser, DuckDuckGo, Ecosia, IE
 */
export function detectBrowser(): string {
  const ua = navigator.userAgent.toLowerCase();
  
  // 🔥 Brave – specjalne wykrywanie
  // @ts-ignore - Brave dodaje navigator.brave
  if (navigator.brave && navigator.brave.isBrave) {
    return 'Brave';
  }
  
  // Kolejność ma znaczenie!
  if (ua.includes('edg') || ua.includes('edge')) return 'Edge';
  if (ua.includes('opr') || ua.includes('opera')) return 'Opera';
  if (ua.includes('vivaldi')) return 'Vivaldi';
  if (ua.includes('arc')) return 'Arc';
  if (ua.includes('firefox')) return 'Firefox';
  if (ua.includes('samsungbrowser')) return 'Samsung Internet';
  if (ua.includes('ucbrowser')) return 'UC Browser';
  // Safari – musi być przed Chrome, bo Safari ma "safari" ale nie "chrome"
  if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('chrome')) return 'Chrome';
  if (ua.includes('trident') || ua.includes('msie')) return 'Internet Explorer';
  if (ua.includes('duckduckgo')) return 'DuckDuckGo';
  if (ua.includes('ecosia')) return 'Ecosia';
  
  return 'unknown';
}