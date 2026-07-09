import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState, useMemo, useEffect } from "react";
import { Lock, ArrowLeft, LogOut, MapPin, Layers, LayoutGrid } from "lucide-react";
import AdminLogin from "./AdminLogin";

type ViewMode = "cards" | "groups";

function useGroupedBlocks(attempts: any[], locked: string[]) {
  return useMemo(() => {
    const map = new Map<string, any>();
    for (const a of attempts) {
      const key = (a.fingerprint && a.fingerprint !== "unknown" ? a.fingerprint : a.deviceId) || a.ipAddress;
      if (!locked.some(l => l === a.ipAddress || l === a.fingerprint || l === a.deviceId)) continue;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          fingerprint: a.fingerprint,
          deviceId: a.deviceId,
          ips: new Set<string>(),
          entries: [] as any[],
          browser: `${a.browserFamily} / ${a.osFamily}`,
          deviceType: a.deviceType,
          country: a.country,
          city: a.city,
          lastSeen: a.createdAt,
          count: 0,
        });
      }
      const g = map.get(key);
      if (a.ipAddress) g.ips.add(a.ipAddress);
      if (a.fingerprint && a.fingerprint !== "unknown") g.fingerprint = a.fingerprint;
      g.entries.push(a);
      g.count++;
      if (new Date(a.createdAt) > new Date(g.lastSeen)) g.lastSeen = a.createdAt;
    }
    return Array.from(map.values());
  }, [attempts, locked]);
}

function UnlockButton({ ip, fingerprint, deviceId, label }: any) {
  const utils = trpc.useUtils();
  const m = trpc.admin.unlockIp.useMutation({ onSuccess: () => { utils.admin.getLockedIPs.invalidate(); utils.admin.getAttempts.invalidate(); }});
  return (
    <Button onClick={() => { if(confirm(`Odblokować ${label || ip}?`)) m.mutate({ ipAddress: ip, fingerprint, deviceId } as any); }} disabled={m.isPending} className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-mono text-xs font-bold py-5">
      {m.isPending ? "..." : label ? `Odblokuj (${label})` : "Odblokuj"}
    </Button>
  );
}

export default function AdminDashboard() {
  const [pinVerified, setPinVerified] = useState(() => !!sessionStorage.getItem("adminPin"));
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("admin_view_mode") as ViewMode) || "groups");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => { localStorage.setItem("admin_view_mode", viewMode); }, [viewMode]);

  const attemptsQ = trpc.admin.getAttempts.useQuery({ limit: 1000, offset: 0 }, { enabled: pinVerified });
  const lockedQ = trpc.admin.getLockedIPs.useQuery(undefined, { enabled: pinVerified });
  const attempts = (attemptsQ.data as any[]) || [];
  const lockedIPs = (lockedQ.data as string[]) || [];
  const groups = useGroupedBlocks(attempts, lockedIPs);

  if (!pinVerified) return <AdminLogin onLoginSuccess={() => setPinVerified(true)} />;

  return (
    <div className="min-h-screen bg-[#0f172a] p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-black font-mono text-white tracking-tighter">PANEL ADMINISTRATORA</h1>
            <p className="text-slate-400 text-xs font-mono mt-1">Historia prób i blokady {viewMode === "groups" && "• grupowanie po urządzeniu (odporne na VPN)"}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => (window.location.href = "/")} variant="outline" className="border-slate-700 text-slate-300"><ArrowLeft className="w-4 h-4 mr-1" />Wróć</Button>
            <Button onClick={() => { sessionStorage.removeItem("adminPin"); setPinVerified(false); }} variant="outline" className="border-slate-700 text-slate-300"><LogOut className="w-4 h-4 mr-1" />Wyloguj</Button>
          </div>
        </div>

        <Card className="bg-[#1e293b] border-slate-700 p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-orange-500/20 grid place-items-center"><Lock className="w-4 h-4 text-orange-400" /></div>
              <div>
                <h2 className="font-bold text-white font-mono flex items-center gap-2">Zablokowane urządzenia / IP <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">{viewMode === "groups" ? `${groups.length} użytkowników • ${lockedIPs.length} blokad` : `${lockedIPs.length} blokad`}</span></h2>
                <p className="text-[11px] text-slate-500 font-mono">💻 = fingerprint (odporne na VPN) • 🌐 = adres IP • Ten sam czas + lokalizacja + kąt = ten sam użytkownik</p>
              </div>
            </div>
            {/* TOGGLE */}
            <div className="flex items-center bg-black/40 rounded-full p-1 border border-white/10">
              <button onClick={() => setViewMode("cards")} className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${viewMode === "cards" ? "bg-white text-black shadow" : "text-slate-400 hover:text-white"}`}><LayoutGrid className="w-3.5 h-3.5" />Karty</button>
              <button onClick={() => setViewMode("groups")} className={`px-4 py-1.5 rounded-full text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${viewMode === "groups" ? "bg-white text-black shadow" : "text-slate-400 hover:text-white"}`}><Layers className="w-3.5 h-3.5" />Grupy</button>
            </div>
          </div>

          {lockedIPs.length === 0 ? <p className="text-slate-500 font-mono text-sm">Brak blokad</p> : viewMode === "groups" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in">
              {groups.map((g: any) => (
                <div key={g.id} className="rounded-2xl bg-[#0f172a] border border-slate-700 p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 font-mono">{g.deviceType?.toUpperCase()}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{g.country} • {g.city}</span>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2.5 border border-white/5 mb-2">
                    <div className="text-[10px] text-slate-500 font-mono">FINGERPRINT</div>
                    <div className="text-amber-300 font-mono text-xs truncate">{g.fingerprint}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2.5 border border-white/5 mb-3">
                    <div className="text-[10px] text-slate-500 font-mono">POWIĄZANE IP ({g.ips.size})</div>
                    <div className="flex flex-wrap gap-1 mt-1">{Array.from(g.ips as Set<string>).filter(Boolean).map((ip:any)=><span key={ip} className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-orange-300 font-mono border border-white/10">{ip}</span>)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mb-3">
                    <div><div className="text-slate-500">Przeglądarka</div><div className="text-slate-200 truncate">{g.browser}</div></div>
                    <div><div className="text-slate-500">Kąt</div><div className="text-cyan-400 font-bold">{g.entries[0]?.angle}°</div></div>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mb-3">🕒 {g.lastSeen ? new Date(g.lastSeen).toLocaleString("pl-PL") : ""}</div>
                  <UnlockButton ip={Array.from(g.ips)[0]} fingerprint={g.fingerprint} deviceId={g.deviceId} label={`${g.ips.size} IP, ${g.count} prób`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in">
              {lockedIPs.map((ip:string) => {
                const rel = attempts.find((a:any)=>a.ipAddress===ip || a.fingerprint===ip || a.deviceId===ip);
                return (
                  <div key={ip} className="rounded-2xl bg-[#0f172a] border border-slate-700 p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-slate-700 text-slate-300 font-mono">{ip.includes(".") ? "IP / VPN" : "URZĄDZENIE"}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{rel?.country || "Unknown"} • {rel?.city || ""}</span>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2.5 border border-white/5 mb-3">
                      <div className="text-amber-300 font-mono text-xs truncate">{ip}</div>
                      <div className="text-[10px] text-slate-500">ID: {ip.slice(0,12)}... odporne na VPN</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mb-3">
                      <div><div className="text-slate-500">Przeglądarka</div><div className="text-slate-200">{rel ? `${rel.browserFamily} / ${rel.osFamily}` : "Unknown"}</div></div>
                      <div><div className="text-slate-500">Urządzenie</div><div className="text-slate-200">{rel?.deviceType || "desktop"}</div></div>
                      <div><div className="text-slate-500">Kąt</div><div className="text-cyan-400 font-bold">{rel?.angle ?? 0}°</div></div>
                      <div><div className="text-slate-500">Status</div><div className="text-red-400 font-bold">FAIL</div></div>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mb-3">🕒 {rel?.createdAt ? new Date(rel.createdAt).toLocaleString("pl-PL") : ""}</div>
                    <UnlockButton ip={ip} label={undefined} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* DOLNA LISTA BEZ ZMIAN */}
        <Card className="bg-[#1e293b] border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-4"><MapPin className="w-4 h-4 text-cyan-400" /><h2 className="font-bold text-white font-mono">Historia prób (bez zmian - pełny audyt)</h2></div>
          <div className="overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="border-b border-slate-700 text-slate-500"><th className="text-left py-2">IP</th><th>Kąt</th><th>Status</th><th>Lokalizacja</th><th>Czas</th></tr></thead>
              <tbody>{attempts.slice(page*50,(page+1)*50).map((a:any,i:number)=><tr key={i} className="border-b border-white/5"><td className="py-2 text-slate-300">{a.ipAddress}</td><td className="text-cyan-300">{a.angle}°</td><td className={a.isCorrect?"text-green-400":"text-red-400"}>{a.isCorrect?"OK":"FAIL"}</td><td className="text-slate-400">{a.country} {a.city && `(${a.city})`}</td><td className="text-slate-500">{a.createdAt?new Date(a.createdAt).toLocaleString("pl-PL"):""}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="flex justify-between mt-4"><Button onClick={()=>setPage(Math.max(0,page-1))} disabled={page===0} variant="outline" className="border-slate-600">Poprzednia</Button><span className="text-slate-500 text-xs">Strona {page+1}</span><Button onClick={()=>setPage(page+1)} disabled={attempts.length<50} variant="outline" className="border-slate-600">Następna</Button></div>
        </Card>
      </div>
    </div>
  );
}
