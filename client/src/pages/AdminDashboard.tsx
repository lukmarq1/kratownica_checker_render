import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState, useMemo, useEffect } from "react";
import { Lock, CheckCircle2, XCircle, ArrowLeft, LogOut, MapPin, Globe, Monitor, Clock, Laptop, ShieldAlert, Smartphone, X, Layers, LayoutGrid } from "lucide-react";
import AdminLogin from "./AdminLogin";

type ViewMode = "cards" | "groups";

// --- UNLOCK BUTTON - wspiera IP + fingerprint + deviceId ---
function UnlockButton({ ipAddress, fingerprint, deviceId, label }: { ipAddress?: string; fingerprint?: string; deviceId?: string; label?: string }) {
  const utils = trpc.useUtils();
  const m = trpc.admin.unlockIp.useMutation({
    onSuccess: () => {
      utils.admin.getLockedIPs.invalidate();
      utils.admin.getAttempts.invalidate();
      utils.admin.getAdvancedAnalytics.invalidate();
    }
  });
  const target = fingerprint || ipAddress || deviceId || "urządzenie";
  return (
    <Button
      onClick={() => {
        if (confirm(`Odblokować ${label || target}?\nTo odblokuje powiązane IP i fingerprint.`)) {
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

// --- TOOLTIP (hover w tabeli historii) ---
function IpTooltip({ a }: { a: any }) {
  const mapUrl = a.latitude
    ? `https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}&zoom=14`
    : `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
  return (
    <div className="absolute left-0 top-full mt-3 hidden group-hover:block z-[9999] w-[380px] bg-[#1e293b] border border-[#334155] rounded-[16px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-3 px-5 py-[18px] border-b border-[#334155] bg-white/[0.02]">
        <div className="w-9 h-9 rounded-[10px] bg-[#0f172a] border border-[#334155] grid place-items-center text-lg">📍</div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] font-bold text-white truncate">{a.ipAddress}</div>
          <div className="text-[11px] text-[#64748b]">{a.city || a.country} • Online</div>
        </div>
        <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]"></div>
      </div>
      <div className="px-5 py-[14px]">
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🌍 Kraj</span><span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.country} 🇵🇱</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🏙️ Miasto</span><span className="text-[#e2e8f0] font-medium text-[12.5px] text-right">{a.city || "—"}</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">📮 Kod</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.zip || "—"}</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🕐 Strefa</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.timezone || "—"}</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">📡 ISP</span><span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] leading-[1.35]">{a.isp || "—"}</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🏢 Org</span><span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.org || "—"}</span></div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🔢 AS</span><span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px]">{a.as || "—"}</span></div>
        <div className="flex justify-between py-[9px] gap-4"><span className="text-[#94a3b8] text-[12.5px]">📍 Coords</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.latitude ? `${a.latitude}, ${a.longitude}` : "—"}</span></div>
      </div>
      <div className="h-px bg-[#334155] mx-5"></div>
      <div className="px-5 pt-[10px] pb-0">
        <div className="flex justify-between py-[5px] gap-4"><span className="text-[#94a3b8] text-[12.5px]">🌐 Przeglądarka</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.browserFamily || "—"}</span></div>
        <div className="flex justify-between py-[5px] gap-4"><span className="text-[#94a3b8] text-[12.5px]">💻 System</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.osFamily || "Unknown"}</span></div>
        <div className="flex justify-between py-[5px] gap-4"><span className="text-[#94a3b8] text-[12.5px]">📱 Urządzenie</span><span className="text-[#e2e8f0] font-medium text-[12.5px]">{a.deviceType || "desktop"}</span></div>
      </div>
      <div className="p-5"><a href={mapUrl} target="_blank" rel="noreferrer" className="flex w-full h-[42px] items-center justify-center gap-2 rounded-[10px] bg-[#0ea5e9] hover:bg-[#0284c7] font-bold text-[13px] text-white no-underline">🗺️ Zobacz na mapie</a></div>
    </div>
  );
}

// --- MODAL SZCZEGÓŁY (kliknięcie Szczegóły) ---
function DetailModal({ a, onClose }: { a: any; onClose: () => void }) {
  const mapUrl = a.latitude ? `https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}&zoom=14` : `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-[420px] max-h-[90vh] overflow-y-auto bg-[#1e293b] border border-[#334155] rounded-[20px] shadow-[0_25px_80px_rgba(0,0,0,0.6)]" onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 flex items-center gap-3 px-6 py-5 border-b border-[#334155] bg-[#1e293b]/90 backdrop-blur-md rounded-t-[20px]">
          <div className="w-10 h-10 rounded-[12px] bg-[#0f172a] border border-[#334155] grid place-items-center text-xl">📍</div>
          <div className="flex-1 min-w-0"><div className="font-mono text-[15px] font-bold text-white truncate">{a.ipAddress}</div><div className="text-[12px] text-[#64748b]">{a.city || a.country} • Online</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 grid place-items-center text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-4">
          <div className="flex justify-between py-3 border-b border-white/[0.06]"><span className="text-[#94a3b8] text-[13px]">🌍 Kraj</span><span className="text-[#e2e8f0] text-[13px] font-medium">{a.country || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06]"><span className="text-[#94a3b8] text-[13px]">🏙️ Miasto</span><span className="text-[#e2e8f0] text-[13px]">{a.city || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06]"><span className="text-[#94a3b8] text-[13px]">📮 Kod</span><span className="text-[#e2e8f0] text-[13px]">{a.zip || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06]"><span className="text-[#94a3b8] text-[13px]">🕐 Strefa</span><span className="text-[#e2e8f0] text-[13px]">{a.timezone || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[13px]">📡 ISP</span><span className="text-[#e2e8f0] text-[13px] text-right max-w-[200px]">{a.isp || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06] gap-4"><span className="text-[#94a3b8] text-[13px]">🏢 Org</span><span className="text-[#e2e8f0] text-[13px] text-right max-w-[200px] break-words">{a.org || "—"}</span></div>
          <div className="flex justify-between py-3 border-b border-white/[0.06]"><span className="text-[#94a3b8] text-[13px]">🔢 AS</span><span className="text-[#e2e8f0] text-[13px]">{a.as || "—"}</span></div>
          <div className="flex justify-between py-3"><span className="text-[#94a3b8] text-[13px]">📍 Coords</span><span className="text-[#e2e8f0] text-[13px]">{a.latitude ? `${a.latitude}, ${a.longitude}` : "—"}</span></div>
        </div>
        <div className="h-px bg-[#334155] mx-6"></div>
        <div className="px-6 py-3">
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">🌐 Przeglądarka</span><span className="text-[#e2e8f0] text-[13px]">{a.browserFamily || "—"}</span></div>
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">💻 System</span><span className="text-[#e2e8f0] text-[13px]">{a.osFamily || "—"}</span></div>
          <div className="flex justify-between py-2"><span className="text-[#94a3b8] text-[13px]">📱 Urządzenie</span><span className="text-[#e2e8f0] text-[13px]">{a.deviceType || "desktop"} {a.fingerprint ? `• ${a.fingerprint.slice(0,8)}...` : ""}</span></div>
        </div>
        <div className="p-6 pt-2 flex gap-2">
          <a href={mapUrl} target="_blank" rel="noreferrer" className="flex-1 h-[44px] grid place-items-center rounded-[12px] bg-[#0ea5e9] hover:bg-[#0284c7] font-bold text-[13px] text-white no-underline">🗺️ Zobacz na mapie</a>
          <button onClick={onClose} className="h-[44px] px-5 rounded-[12px] bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-[13px] font-bold">Zamknij</button>
        </div>
      </div>
    </div>
  );
}

// --- KARTA BLOKADY (oryginalny wygląd ze screena) ---
function BlockedCard({ id, attempts, onShowDetail }: { id: string; attempts: any[]; onShowDetail: (a:any)=>void }) {
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(id);
  const details = attempts.find((a: any) => a.ipAddress === id || a.fingerprint === id || a.deviceId === id) || attempts.find((a:any)=>!isIp && a.fingerprint===id) || attempts[0] || null;
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
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md"><span className="flex items-center gap-1.5"><Laptop className="w-3.5 h-3" /> Przeglądarka</span><span className="text-slate-200 truncate max-w-[130px] text-right">{info.browserFamily || 'Chrome'} / {info.osFamily || 'Windows'}</span></div>
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md"><span className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3" /> Urządzenie</span><span className="text-slate-200">{info.deviceType || 'desktop'}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Kąt</div><div className="text-cyan-300 font-bold">{info.angle ?? '—'}°</div></div>
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Status</div><div className="text-red-400 font-bold">FAIL</div></div>
            </div>
            <div className="flex justify-between items-center text-slate-400 px-1 pt-1">
              <span className="flex items-center gap-1 text-[11px]"><Clock className="w-3 h-3" /> {info.createdAt ? new Date(info.createdAt).toLocaleString("pl-PL") : 'teraz'}</span>
              <button onClick={()=>info && onShowDetail(info)} className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1">👁 Szczegóły</button>
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

// --- GRUPOWANIE ---
function useGroupedBlocks(attempts: any[], locked: string[]) {
  return useMemo(() => {
    const map = new Map<string, any>();
    for (const a of attempts) {
      if (!a.fingerprint && !a.deviceId && !a.ipAddress) continue;
      if (!locked.some(l => l === a.ipAddress || l === a.fingerprint || l === a.deviceId)) continue;
      const key = (a.fingerprint && a.fingerprint !== "unknown" && a.fingerprint !== "" ? a.fingerprint : a.deviceId) || a.ipAddress;
      if (!map.has(key)) {
        map.set(key, { id: key, fingerprint: a.fingerprint, deviceId: a.deviceId, ips: new Set<string>(), entries: [] as any[], browser: `${a.browserFamily || ""} / ${a.osFamily || ""}`, deviceType: a.deviceType, country: a.country, city: a.city, lastSeen: a.createdAt, count: 0, lastAttempt: a });
      }
      const g = map.get(key);
      if (a.ipAddress) g.ips.add(a.ipAddress);
      if (a.fingerprint && a.fingerprint !== "unknown") g.fingerprint = a.fingerprint;
      if (!g.deviceId && a.deviceId) g.deviceId = a.deviceId;
      g.entries.push(a);
      g.count++;
      if (new Date(a.createdAt) > new Date(g.lastSeen)) { g.lastSeen = a.createdAt; g.lastAttempt = a; }
    }
    return Array.from(map.values());
  }, [attempts, locked]);
}

export default function AdminDashboard() {
  const [pinVerified, setPinVerified] = useState(() => !!sessionStorage.getItem("adminPin"));
  const [viewMode, setViewMode] = useState<"cards"|"groups">(()=> (localStorage.getItem("admin_view_mode") as any) || "groups");
  const [page, setPage] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const pageSize = 50;

  useEffect(()=>{ localStorage.setItem("admin_view_mode", viewMode); }, [viewMode]);

  const attemptsQ = trpc.admin.getAttempts.useQuery({ limit: 1000, offset: 0 }, { enabled: pinVerified });
  const lockedQ = trpc.admin.getLockedIPs.useQuery(undefined, { enabled: pinVerified });
  if (!pinVerified) return <AdminLogin onLoginSuccess={() => setPinVerified(true)} />;
  const attempts = (attemptsQ.data as any[]) || [];
  const lockedIPs = (lockedQ.data as string[]) || [];
  const groups = useGroupedBlocks(attempts, lockedIPs);

  const getFlag = (c: string) => {
    if (!c) return "🌍";
    if (c === "Poland") return "🇵🇱";
    if (c === "United States") return "🇺🇸";
    if (c === "Germany") return "🇩🇪";
    if (c === "Norway") return "🇳🇴";
    if (c === "Netherlands") return "🇳🇱";
    if (c === "United Kingdom") return "🇬🇧";
    return "🌍";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div><h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">PANEL ADMINISTRATORA</h1><p className="text-slate-400 text-sm mt-1 font-mono">Historia prób i blokady • {viewMode==="groups" ? "grupowanie po urządzeniu (odporne na VPN)" : "widok kart"}</p></div>
          <div className="flex gap-2"><Button onClick={() => (window.location.href = "/")} variant="outline" className="border-slate-600 text-slate-300 gap-2"><ArrowLeft className="w-4 h-4" />Wróć</Button><Button onClick={() => { sessionStorage.removeItem("adminPin"); setPinVerified(false); }} variant="outline" className="border-slate-600 text-slate-300 gap-2"><LogOut className="w-4 h-4" />Wyloguj</Button></div>
        </div>

        <Card className="bg-slate-800 border-slate-700 mb-6">
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20"><Lock className="w-5 h-5 text-orange-400" /></div>
                <div>
                  <h2 className="text-lg font-bold text-white font-mono flex flex-wrap items-center gap-2">Zablokowane urządzenia / IP <span className="text-xs bg-orange-500/20 text-orange-300 px-2.5 py-0.5 rounded-full border border-orange-500/20">{viewMode==="groups" ? `${groups.length} użytkowników • ${lockedIPs.length} blokad` : `${lockedIPs.length} blokad`}</span></h2>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">💻 = fingerprint (odporne na VPN) • 🌐 = adres IP • Kliknij Szczegóły aby zobaczyć mapę</p>
                </div>
              </div>
              <div className="flex items-center bg-black/40 rounded-full p-1 border border-white/10">
                <button onClick={()=>setViewMode("cards")} className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${viewMode==="cards" ? "bg-white text-black shadow" : "text-slate-400 hover:text-white"}`}><LayoutGrid className="w-3.5 h-3.5" />Karty</button>
                <button onClick={()=>setViewMode("groups")} className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${viewMode==="groups" ? "bg-white text-black shadow" : "text-slate-400 hover:text-white"}`}><Layers className="w-3.5 h-3.5" />Grupy</button>
              </div>
            </div>

            {lockedIPs.length > 0 ? (
              viewMode === "cards" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in">
                  {lockedIPs.map((id: string) => <BlockedCard key={id} id={id} attempts={attempts} onShowDetail={setSelectedDetail} />)}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in">
                  {groups.map((g:any)=>(
                    <div key={g.id} className="bg-[#0f172a] border border-orange-500/30 rounded-xl p-4 flex flex-col hover:border-orange-500/60 transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <span className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full font-bold border bg-purple-500/10 text-purple-300 border-purple-500/30"><Monitor className="w-3 h-3" /> URZĄDZENIE • GRUPA</span>
                        <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1"><MapPin className="w-3 h-3" />{g.country} {g.city?`• ${g.city}`:''}</span>
                      </div>
                      <div className="bg-black/40 p-2.5 rounded-lg border border-white/5 mb-2">
                        <div className="text-[10px] text-slate-500 font-mono">FINGERPRINT</div>
                        <div className="text-amber-300 font-mono text-xs truncate">{g.fingerprint || g.id}</div>
                        <div className="text-[10px] text-slate-500">ID: {(g.fingerprint||g.id).slice(0,8)}... odporne na VPN</div>
                      </div>
                      <div className="bg-black/40 p-2.5 rounded-lg border border-white/5 mb-3">
                        <div className="text-[10px] text-slate-500 font-mono">POWIĄZANE IP ({g.ips.size})</div>
                        <div className="flex flex-wrap gap-1 mt-1">{Array.from(g.ips as Set<string>).filter(Boolean).map((ip:any)=><span key={ip} className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-orange-300 font-mono border border-white/10">{ip}</span>)}</div>
                      </div>
                      <div className="mt-2 space-y-2 text-xs font-mono flex-1">
                        <div className="flex justify-between bg-white/[0.02] px-2.5 py-1.5 rounded-md text-slate-400"><span>Przeglądarka</span><span className="text-slate-200 truncate max-w-[130px] text-right">{g.browser}</span></div>
                        <div className="flex justify-between bg-white/[0.02] px-2.5 py-1.5 rounded-md text-slate-400"><span>Urządzenie</span><span className="text-slate-200">{g.deviceType || 'desktop'}</span></div>
                        <div className="grid grid-cols-2 gap-2"><div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Kąt</div><div className="text-cyan-300 font-bold">{g.lastAttempt?.angle ?? '—'}°</div></div><div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md"><div className="text-[10px] text-slate-500">Prób</div><div className="text-red-400 font-bold">{g.count} x FAIL</div></div></div>
                        <div className="flex justify-between px-1 pt-1 text-[11px] text-slate-400"><span className="flex items-center gap-1"><Clock className="w-3 h-3" />{g.lastSeen ? new Date(g.lastSeen).toLocaleString("pl-PL") : ''}</span><button onClick={()=>g.lastAttempt && setSelectedDetail(g.lastAttempt)} className="text-cyan-400 hover:text-cyan-300">👁 Szczegóły</button></div>
                      </div>
                      <UnlockButton ipAddress={Array.from(g.ips)[0] as string} fingerprint={g.fingerprint} deviceId={g.deviceId} label={`${g.ips.size} IP, ${g.count} prób`} />
                    </div>
                  ))}
                </div>
              )
            ) : <p className="text-slate-400 font-mono text-sm bg-slate-900/50 border border-dashed border-slate-700 rounded-xl p-8 text-center">Brak zablokowanych urządzeń 🎉<br/><span className="text-xs text-slate-500">Wszystkie urządzenia mają dostęp</span></p>}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 overflow-visible">
          <div className="p-6 overflow-visible">
            <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-cyan-400" /><h2 className="text-lg font-bold text-white font-mono">Historia prób</h2></div>
            <div className="overflow-visible">
              <table className="w-full text-sm font-mono">
                <thead><tr className="border-b-2 border-slate-600"><th className="text-left py-3 px-3 text-slate-400">IP</th><th className="text-left py-3 px-3 text-slate-400">Kąt</th><th className="text-left py-3 px-3 text-slate-400">Status</th><th className="text-left py-3 px-3 text-slate-400">Lokalizacja</th><th className="text-left py-3 px-3 text-slate-400">Czas</th><th className="text-left py-3 px-3 text-slate-400">Akcja</th></tr></thead>
                <tbody>
                  {attempts.map((a: any, idx: number) => {
                    const isLocked = lockedIPs.includes(a.ipAddress) || lockedIPs.includes(a.fingerprint);
                    return (
                      <tr key={idx} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${isLocked ? "bg-red-900/20" : ""}`}>
                        <td className={`py-3 px-3 ${isLocked ? "text-red-400 font-bold" : "text-slate-300"}`}>{a.ipAddress}</td>
                        <td className="py-3 px-3 text-slate-300 font-bold">{a.angle}°</td>
                        <td className="py-3 px-3">{a.isCorrect === 1 ? <span className="text-green-400 flex items-center gap-1 font-bold"><CheckCircle2 className="w-4 h-4" />OK</span> : <span className="text-red-400 flex items-center gap-1 font-bold"><XCircle className="w-4 h-4" />FAIL</span>}</td>
                        <td className="py-3 px-3 overflow-visible"><div className="group relative inline-block"><span className="flex items-center gap-1.5 cursor-help border-b border-dotted border-slate-500 hover:text-cyan-300 text-slate-300"><span>{getFlag(a.country)}</span><span className="text-slate-200">{a.country}</span>{a.city && <span className="text-slate-400 text-xs">({a.city})</span>}</span><IpTooltip a={a} /></div></td>
                        <td className="py-3 px-3 text-slate-400 text-xs">{a.createdAt ? new Date(a.createdAt).toLocaleString("pl-PL") : ""}</td>
                        <td className="py-3 px-3 flex gap-1"><Button onClick={()=>setSelectedDetail(a)} variant="outline" size="sm" className="h-7 text-[11px] border-slate-600">Szczegóły</Button><UnlockButton ipAddress={a.ipAddress} fingerprint={a.fingerprint} deviceId={a.deviceId} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-8 pt-4 border-t border-slate-700">
              <Button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} variant="outline" className="border-slate-600 text-slate-300">Poprzednia</Button>
              <span className="text-slate-400 font-mono text-sm">Strona {page + 1}</span>
              <Button onClick={() => setPage(page + 1)} disabled={attempts.length < pageSize} variant="outline" className="border-slate-600 text-slate-300">Następna</Button>
            </div>
          </div>
        </Card>
      </div>
      {selectedDetail && <DetailModal a={selectedDetail} onClose={()=>setSelectedDetail(null)} />}
    </div>
  );
}
