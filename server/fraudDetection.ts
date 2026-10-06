export type FraudRow = {
  id?: number;
  ip?: string | null;
  status?: string | null;
  fingerprint?: string | null;
  device_id?: string | null;
  browser?: string | null;
  os?: string | null;
  localization?: string | null;
  created_at?: Date | string | number | null;
};

export type FraudAlert = {
  id: string;
  riskScore: number;
  level: "medium" | "high" | "critical";
  identity: string;
  ips: string[];
  devices: string[];
  fingerprints: string[];
  countries: string[];
  attempts: number;
  failedAttempts: number;
  reasons: string[];
  firstSeen: string;
  lastSeen: string;
};

const WINDOW_MS = 10 * 60 * 1000;
const RAPID_WINDOW_MS = 2 * 60 * 1000;

function value(input: unknown): string {
  return String(input ?? "").trim();
}

function timestamp(row: FraudRow): number {
  const parsed = row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at ?? 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function country(row: FraudRow): string {
  try {
    const localization = row.localization ? JSON.parse(row.localization) : {};
    return value(localization.country || localization.countryCode);
  } catch {
    return "";
  }
}

function level(score: number): FraudAlert["level"] {
  return score >= 85 ? "critical" : score >= 65 ? "high" : "medium";
}

export function detectFraudAlerts(rows: FraudRow[], now = Date.now()): FraudAlert[] {
  const recent = rows
    .map((row) => ({ row, time: timestamp(row) }))
    .filter(({ time }) => time > 0 && time >= now - WINDOW_MS && time <= now + 60_000)
    .sort((a, b) => a.time - b.time);
  const groups = new Map<string, Array<{ row: FraudRow; time: number }>>();

  for (const item of recent) {
    const fingerprint = value(item.row.fingerprint);
    const device = value(item.row.device_id);
    const key = fingerprint && fingerprint !== "fp-fallback" ? `fp:${fingerprint}` : device ? `device:${device}` : "";
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  const alerts: FraudAlert[] = [];
  for (const [identity, items] of groups) {
    const ips = [...new Set(items.map(({ row }) => value(row.ip)).filter(Boolean))];
    const devices = [...new Set(items.map(({ row }) => value(row.device_id)).filter(Boolean))];
    const fingerprints = [...new Set(items.map(({ row }) => value(row.fingerprint)).filter(Boolean))];
    const countries = [...new Set(items.map(({ row }) => country(row)).filter(Boolean))];
    const failedAttempts = items.filter(({ row }) => value(row.status) !== "success").length;
    const reasons: string[] = [];
    let score = 0;

    if (ips.length >= 2) {
      score += 55;
      reasons.push(`ten sam identyfikator pojawił się z ${ips.length} adresów IP w 10 minut`);
    }
    if (devices.length >= 2) {
      score += 35;
      reasons.push(`ten sam identyfikator użył ${devices.length} urządzeń`);
    }
    if (countries.length >= 2) {
      score += 45;
      reasons.push(`zmiana kraju: ${countries.join(" → ")}`);
    }
    if (items.length >= 3 && items[items.length - 1].time - items[0].time <= RAPID_WINDOW_MS) {
      score += 20;
      reasons.push(`${items.length} prób w mniej niż 2 minuty`);
    }
    if (failedAttempts >= 2) {
      score += 15;
      reasons.push(`${failedAttempts} nieudane próby w tym samym oknie`);
    }

    if (score >= 45 && reasons.length) {
      alerts.push({
        id: identity,
        riskScore: Math.min(100, score),
        level: level(Math.min(100, score)),
        identity: identity.replace(/^(fp|device):/, ""),
        ips,
        devices,
        fingerprints,
        countries,
        attempts: items.length,
        failedAttempts,
        reasons,
        firstSeen: new Date(items[0].time).toISOString(),
        lastSeen: new Date(items[items.length - 1].time).toISOString(),
      });
    }
  }

  return alerts.sort((a, b) => b.riskScore - a.riskScore || b.lastSeen.localeCompare(a.lastSeen)).slice(0, 50);
}
