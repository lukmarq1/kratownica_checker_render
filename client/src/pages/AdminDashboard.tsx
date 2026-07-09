import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState, useMemo, useEffect } from "react";
import { Lock, CheckCircle2, XCircle, ArrowLeft, LogOut, MapPin, Globe, Monitor, Clock, Laptop, Smartphone, X, Layers, LayoutGrid, ShieldAlert } from "lucide-react";
import AdminLogin from "./AdminLogin";

type ViewMode = "cards" | "groups";

// --- MAPA KRAJÓW I FLAG ---
const COUNTRY_MAP: Record<string, string> = {
  "Poland": "PL", "Polska": "PL",
  "United States": "US", "USA": "US", "United States of America": "US",
  "Germany": "DE", "Niemcy": "DE",
  "Norway": "NO", "Norwegia": "NO",
  "Netherlands": "NL", "Holandia": "NL",
  "United Kingdom": "GB", "Wielka Brytania": "GB", "UK": "GB", "England": "GB",
};
function isoToFlag(iso: string) {
  if (!iso || iso.length !== 2) return "🌍";
  return String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
const getFlag = (countryName: string, countryCode?: string) => {
  if (countryCode && countryCode.length === 2) return isoToFlag(countryCode);
  if (!countryName) return "🌍";
  const code = COUNTRY_MAP[countryName];
  if (code) return isoToFlag(code);
  return "🌍";
};

// --- UNLOCK - wspiera IP + fingerprint + deviceId (fix dla grup) ---
function UnlockButton({ ipAddress, fingerprint, deviceId, label }: { ipAddress?: string; fingerprint?: string; deviceId?: string; label?: string }) {
  const utils = trpc.useUtils();
  const m = trpc.admin.unlockIp.useMutation({
    onSuccess: () => {
      utils.admin.getLockedIPs.invalidate();
      utils.admin.getAttempts.invalidate();
    }
  });
  const display = label || fingerprint || ipAddress || deviceId || "urządzenie";
  return (
    <Button
      onClick={(e) => {
        e.stopPropagation();
        if (confirm(`Odblokować ${display}?\nOdblokuje powiązane IP i fingerprint.`)) {
          m.mutateAsync({ ipAddress, fingerprint, deviceId } as any);
        }
      }}
      disabled={m.isPending}
      size="sm"
      className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-mono text-xs h-8 px-4 font-bold w-full mt-3"
    >
      {m.isPending ? "..." : label ? `Odblokuj (${label})` : "Odblokuj"}
    </Button>
  );
}

function DetailModal({ a, onClose }: { a: any, onClose: () => void }) {
  const mapUrl = a.latitude ? `https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}&zoom=14` : `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-[440px] max-h-[90vh] overflow-y-auto bg-[#1e293b] border border-[#334155] rounded-[20px] shadow-[0_25px_80px_rgba(0,0,0,0.7)]" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center gap-3 px-6 py-5 border-b border-[#334155] bg-[#1e293b] rounded-t-[20px]">
          <div className="w-11 h-11 rounded-[12px] bg-[#0f172a] border border-[#334155] grid place-items-center text-xl">📍</div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[15px] font-bold text-white truncate">{a.ipAddress}</div>
            <div className="text-[12px] text-[#64748b] flex items-center gap-2">{getFlag(a.country, a.countryCode || a.country_code)} {a.city || a.country} • Online <span className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e] inline-block"></span></div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 grid place-items-center text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-2">
          {[
            ["🌍 Kraj", `${a.country || "—"} ${a.countryCode ? `(${a.countryCode})` : ""}`],
            ["🏙 Miasto", a.city || "—"],
            ["📮 Kod", a.zip || "—"],
            ["🕐 Strefa", a.timezone || "—"],
            ["📡 ISP", a.isp || "—"],
            ["🏢 Org", a.org || "—"],
            ["🔢 AS", a.as || "—"],
            ["📍 Coords", a.latitude ? `${a.latitude}, ${a.longitude}` : "—"],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between py-[12px] border-b border-white/[0.06] gap-4">
              <span className="text-[#94a3b8] text-[13px]">{label}</span>
              <span className="text-[#e2e8f0] font-medium text-[13px] text-right max-w-[220px] break-words leading-snug">{val as string}</span>
            </div>
          ))}
        </div>
        <div className="h-px bg-[#334155] mx-6 my-2"></div>
        <div className="px-6 py-2">
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">🌐 Przeglądarka</span><span className="text-[#e2e8f0] text-[13px] font-medium">{a.browserFamily || a.browser || "—"}</span></div>
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">💻 System</span><span className="text-[#e2e8f0] text-[13px] font-medium">{a.osFamily || "—"}</span></div>
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">📱 Urządzenie</span><span className="text-[#e2e8f0] text-[13px] font-medium">{a.deviceType || "desktop"} {a.fingerprint ? `• ${a.fingerprint.slice(0,8)}...` : ""}</span></div>
        </div>
        <div className="p-6 pt-3 flex gap-2">
          <a href={mapUrl} target="_blank" rel="noreferrer" className="flex-1 h-[44px] grid place-items-center rounded-[12px] bg-[#0ea5e9] hover:bg-[#0284c7] font-bold text-[13px] text-white no-underline">🗺 Zobacz na mapie</a>
          <button onClick={onClose} className="h-[44px] px-5 rounded-[12px] bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-[13px] font-bold">Zamknij</button>
        </div>
      </div>
    </div>
  );
}

function BlockedCard({ id, attempts, onDetails }: { id: string, attempts: any[], onDetails: (a:any)=>void }) {
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(id);
  const details = attempts.find((a: any) => a.ipAddress === id || a.fingerprint === id || a.deviceId === id) || attempts.find((a: any) => !isIp && a.fingerprint === id) || null;
  const info = details;
  return (
    <div className="bg-[#0f172a] border border-orange-500/30 rounded-xl p-4 hover:border-orange-500/60 transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.15)] flex flex-col">
      <div className="flex justify-between items-start mb-3">
        <span className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full font-bold tracking-wide border ${isIp ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' : 'bg-purple-500/10 text-purple-300 border-purple-500/30'}`}>
          {isIp ? <><Globe className="w-3 h-3" /> IP / VPN</> : <><Monitor className="w-3 h-3" /> URZĄDZENIE</>}
        </span>
        {info?.country && <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono"><MapPin className="w-3 h-3" /> {info.country} {info.city ? `• ${info.city}` : ''}</span>}
      </div>
      <div className="font-mono text-[13px] text-orange-300 break-all bg-black/40 p-2.5 rounded-lg border border-white/5 leading-relaxed">
        {isIp ? id : `${id.slice(0, 24)}...`}
        {!isIp && <div className="text-[10px] text-slate-500 mt-1">ID: {id.slice(0,8)}... odporne na VPN</div>}
      </div>
      <div className="mt-3 space-y-2 text-xs font-mono flex-1">
        {info ? (
          <>
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md"><span className="flex items-center gap-1.5"><Laptop className="w-3.5 h-3" /> Przeglądarka</span><span className="text-slate-200 truncate max-w-[130px] text-right">{info.browserFamily || info.browser || 'Chrome'} / {info.osFamily || 'Windows'}</span></div>
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md"><span className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3" /> Urządzenie</span><span className="text-slate-200">{info.deviceType || 'desktop'}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Kąt</div><div className="text-cyan-300 font-bold">{info.angle ?? '—'}°</div></div>
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Status</div><div className="text-red-400 font-bold">FAIL</div></div>
            </div>
            <div className="flex justify-between items-center text-slate-400 px-1 pt-1">
              <span className="flex items-center gap-1 text-[11px]"><Clock className="w-3 h-3" /> {info.createdAt ? new Date(info.createdAt).toLocaleString("pl-PL") : 'teraz'}</span>
              <button onClick={()=>info && onDetails(info)} className="text-cyan-400 hover:text-cyan-300 text-[11px]">👁 Szczegóły</button>
            </div>
            {isIp && info.isp && <div className="text-[11px] text-slate-500 truncate px-1">ISP: {info.isp}</div>}
          </>
        ) : (
          <div className="text-slate-500 italic text-center py-4"><ShieldAlert className="w-6 h-6 mx-auto mb-1 opacity-50" />Brak szczegółów w historii<br/><span className="text-[11px]">ID urządzenia z fingerprintingu</span></div>
        )}
      </div>
      <UnlockButton ipAddress={isIp ? id : info?.ipAddress} fingerprint={!isIp ? id : info?.fingerprint} deviceId={info?.deviceId} />
    </div>
  );
}

function useGroupedBlocks(attempts: any[], locked: string[]) {
  return useMemo(() => {
    const map = new Map<string, any>();
    for (const a of attempts) {
      if (!a.fingerprint && !a.deviceId && !a.ipAddress) continue;
      if (!locked.some(l => l === a.ipAddress || l === a.fingerprint || l === a.deviceId)) continue;
      const key = (a.fingerprint && a.fingerprint !== "unknown" && a.fingerprint !== "" ? a.fingerprint : a.deviceId) || a.ipAddress;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, { id: key, fingerprint: a.fingerprint, deviceId: a.deviceId, ips: new Set<string>(), entries: [] as any[], country: a.country, city: a.city, lastSeen: a.createdAt, lastAttempt: a, count: 0 });
      }
      const g = map.get(key);
      if (a.ipAddress) g.ips.add(a.ipAddress);
      if (a.fingerprint && a.fingerprint !== "unknown") g.fingerprint = a.fingerprint;
      if (!g.deviceId && a.deviceId) g.deviceId = a.deviceId;
      g.entries.push(a);
      g.count++;
      if (new Date(a.createdAt) > new Date(g.lastSeen)) { g.lastSeen = a.createdAt; g.lastAttempt = a; g.country = a.country; g.city = a.city; }
    }
    return Array.from(map.values());
  }, [attempts, locked]);
}
