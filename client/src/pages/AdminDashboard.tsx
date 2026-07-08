import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Lock, CheckCircle2, XCircle, ArrowLeft, LogOut, MapPin } from "lucide-react";
import AdminLogin from "./AdminLogin";

function UnlockButton({ ipAddress }: { ipAddress: string }) {
  const utils = trpc.useUtils();
  const m = trpc.admin.unlockIp.useMutation({
    onSuccess: () => {
      utils.admin.getLockedIPs.invalidate();
      utils.admin.getAttempts.invalidate();
    }
  });
  return (
    <Button onClick={() => { if(confirm(`Odblokowa\u0107 ${ipAddress}?`)) m.mutateAsync({ ipAddress }) }} disabled={m.isPending} size="sm" className="bg-orange-600 hover:bg-orange-700 text-white font-mono text-xs h-7 px-3">
      {m.isPending? "..." : "Odblokuj"}
    </Button>
  );
}

export default function AdminDashboard() {
  const [pinVerified, setPinVerified] = useState(() =>!!sessionStorage.getItem("adminPin"));
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const attemptsQ = trpc.admin.getAttempts.useQuery({ limit: pageSize, offset: page * pageSize }, { enabled: pinVerified });
  const lockedQ = trpc.admin.getLockedIPs.useQuery(undefined, { enabled: pinVerified });
  if (!pinVerified) return <AdminLogin onLoginSuccess={() => setPinVerified(true)} />;
  const attempts = attemptsQ.data || [];
  const lockedIPs = lockedQ.data || [];

  const getFlag = (c: string) => {
    if (c === "Poland") return "\u{1F1F5}\u{1F1F1}";
    if (c === "United States") return "\u{1F1FA}\u{1F1F8}";
    if (c === "Germany") return "\u{1F1E9}\u{1F1EA}";
    return "\u{1F30D}";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">PANEL ADMINISTRATORA</h1>
            <p className="text-slate-400 text-sm mt-1 font-mono">{"Historia pr\u00F3b"}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => (window.location.href = "/")} variant="outline" className="border-slate-600 text-slate-300 gap-2"><ArrowLeft className="w-4 h-4" />{"Wr\u00F3\u0107"}</Button>
            <Button onClick={() => { sessionStorage.removeItem("adminPin"); setPinVerified(false); }} variant="outline" className="border-slate-600 text-slate-300 gap-2"><LogOut className="w-4 h-4" />Wyloguj</Button>
          </div>
        </div>

        <Card className="bg-slate-800 border-slate-700 mb-6">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4"><Lock className="w-5 h-5 text-orange-400" /><h2 className="text-lg font-bold text-white font-mono">Zablokowane IP</h2></div>
            {lockedIPs.length > 0? (
              <div className="flex flex-wrap gap-3">
                {lockedIPs.map((ip: string) => (
                  <div key={ip} className="bg-slate-700/50 rounded-lg p-3 border border-orange-500/30 flex gap-3 items-center">
                    <span className="text-orange-400 font-mono font-bold text-sm">{ip}</span><UnlockButton ipAddress={ip} />
                  </div>
                ))}
              </div>
            ) : <p className="text-slate-400 font-mono text-sm">Brak zablokowanych IP</p>}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 overflow-visible">
          <div className="p-6 overflow-visible">
            <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-cyan-400" /><h2 className="text-lg font-bold text-white font-mono">{"Historia pr\u00F3b"}</h2></div>
            <div className="overflow-visible">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b-2 border-slate-600">
                    <th className="text-left py-3 px-3 text-slate-400">IP</th>
                    <th className="text-left py-3 px-3 text-slate-400">{"K\u0105t"}</th>
                    <th className="text-left py-3 px-3 text-slate-400">Status</th>
                    <th className="text-left py-3 px-3 text-slate-400">Lokalizacja</th>
                    <th className="text-left py-3 px-3 text-slate-400">Czas</th>
                    <th className="text-left py-3 px-3 text-slate-400">Akcja</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a: any, idx: number) => {
                    const isLocked = lockedIPs.includes(a.ipAddress);
                    const mapUrl = a.latitude? `https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}&zoom=14` : `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
                    return (
                      <tr key={idx} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${isLocked? "bg-red-900/20" : ""}`}>
                        <td className={`py-3 px-3 ${isLocked? "text-red-400 font-bold" : "text-slate-300"}`}>{a.ipAddress}</td>
                        <td className="py-3 px-3 text-slate-300 font-bold">{a.angle}{"\u00B0"}</td>
                        <td className="py-3 px-3">{a.isCorrect === 1? <span className="text-green-400 flex items-center gap-1 font-bold"><CheckCircle2 className="w-4 h-4" />OK</span> : <span className="text-red-400 flex items-center gap-1 font-bold"><XCircle className="w-4 h-4" />FAIL</span>}</td>
                        <td className="py-3 px-3 overflow-visible">
                          <div className="group relative inline-block">
                            <span className="flex items-center gap-1.5 cursor-help border-b border-dotted border-slate-500 hover:text-cyan-300 text-slate-300">
                              <span>{getFlag(a.country)}</span><span className="text-slate-200">{a.country}</span>{a.city && <span className="text-slate-400 text-xs">({a.city})</span>}
                            </span>
                            <div className="absolute left-0 top-full mt-3 hidden group-hover:block z-[9999] w- bg-[#1e293b] border border-[#334155] rounded- shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden">
                              <div className="flex items-center gap-3 p-[18px_20px] bg-white/[0.02] border-b border-[#334155]">
                                <div className="w-9 h-9 bg-[#0f172a] border border-[#334155] rounded- grid place-items-center text-">{"\u{1F4CD}"}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono font-bold text- text-white truncate">{a.ipAddress}</div>
                                  <div className="text- text-[#64748b]">{a.city || a.country} {"\u2022"} Online</div>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]"></div>
                              </div>
                              <div className="p-[14px_20px]">
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F30D} Kraj"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words">{a.country}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F3D9}\uFE0F Miasto"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words">{a.city || "\u2014"}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F4EE} Kod"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right">{a.zip || "\u2014"}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F550} Strefa"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words">{a.timezone || "\u2014"}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F4E1} ISP"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words leading-[1.35]">{a.isp || "\u2014"}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F3E2} Org"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words leading-[1.35]">{a.org || "\u2014"}</span></div>
                                <div className="flex justify-between py- border-b border-white/[0.06] gap-4"><span className="text- text-[#94a3b8]">{"\u{1F522} AS"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right max-w- break-words">{a.as || "\u2014"}</span></div>
                                <div className="flex justify-between py- gap-4"><span className="text- text-[#94a3b8]">{"\u{1F4CD} Coords"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right">{a.latitude? `${a.latitude}, ${a.longitude}` : "\u2014"}</span></div>
                              </div>
                              <div className="h-px bg-[#334155] mx-5"></div>
                              <div className="p-[10px_20px_0]">
                                <div className="flex justify-between py- gap-4"><span className="text- text-[#94a3b8]">{"\u{1F310} Przegl\u0105darka"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right">{a.browserFamily || "\u2014"}</span></div>
                                <div className="flex justify-between py- gap-4"><span className="text- text-[#94a3b8]">{"\u{1F4BB} System"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right">{a.osFamily || "Unknown"}</span></div>
                                <div className="flex justify-between py- gap-4"><span className="text- text-[#94a3b8]">{"\u{1F4F1} Urz\u0105dzenie"}</span><span className="text-[12.5px] font-medium text-[#e2e8f0] text-right">{a.deviceType || "desktop"}</span></div>
                              </div>
                              <div className="p-[14px_20px_20px]"><a href={mapUrl} target="_blank" rel="noreferrer" className="flex w-full h- items-center justify-center gap-2 bg-[#0ea5e9] hover:bg-[#0284c7] text-white rounded- text- font-bold no-underline transition-colors">{"\u{1F5FA}\uFE0F Zobacz na mapie"}</a></div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-xs">{a.createdAt? new Date(a.createdAt).toLocaleString("pl-PL") : ""}</td>
                        <td className="py-3 px-3"><UnlockButton ipAddress={a.ipAddress} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-8 pt-4 border-t border-slate-700">
              <Button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} variant="outline" className="border-slate-600 text-slate-300">Poprzednia</Button>
              <span className="text-slate-400 font-mono text-sm">Strona {page + 1}</span>
              <Button onClick={() => setPage(page + 1)} disabled={attempts.length < pageSize} variant="outline" className="border-slate-600 text-slate-300">{"Nast\u0119pna"}</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}