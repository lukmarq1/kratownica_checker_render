import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { BarChart3, Lock, Users, CheckCircle2, XCircle, ArrowLeft, LogOut, MapPin, Info } from "lucide-react";
import AdminLogin from "./AdminLogin";

function UnlockButton({ ipAddress }: { ipAddress: string }) {
  const utils = trpc.useUtils();
  const unlockMutation = trpc.admin.unlockIp.useMutation({
    onSuccess: () => {
      utils.admin.getLockedIPs.invalidate();
      utils.admin.getAttempts.invalidate();
      utils.admin.getStats.invalidate();
    }
  });
  const handleUnlock = async () => {
    if (confirm(`Odblokowac IP: ${ipAddress}?`)) {
      await unlockMutation.mutateAsync({ ipAddress });
    }
  };
  return (
    <Button onClick={handleUnlock} disabled={unlockMutation.isPending} size="sm" className="bg-orange-600 hover:bg-orange-700 text-white font-mono text-xs h-7 px-3">
      {unlockMutation.isPending? "..." : "Odblokuj"}
    </Button>
  );
}

export default function AdminDashboard() {
  const [pinVerified, setPinVerified] = useState(() =>!!sessionStorage.getItem("adminPin"));
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const statsQuery = trpc.admin.getStats.useQuery(undefined, { enabled: pinVerified });
  const attemptsQuery = trpc.admin.getAttempts.useQuery({ limit: pageSize, offset: page * pageSize }, { enabled: pinVerified });
  const lockedIPsQuery = trpc.admin.getLockedIPs.useQuery(undefined, { enabled: pinVerified });

  if (!pinVerified) return <AdminLogin onLoginSuccess={() => setPinVerified(true)} />;
  const handleLogout = () => { sessionStorage.removeItem("adminPin"); setPinVerified(false); };
  const stats = statsQuery.data || { totalAttempts: 0, uniqueIps: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0 };
  const attempts = attemptsQuery.data || [];
  const lockedIPs = lockedIPsQuery.data || [];

  const getCountryFlag = (country: string) => {
    const flags: Record<string, string> = {
      'Poland': '\u{1F1F5}\u{1F1F1}',
      'United States': '\u{1F1FA}\u{1F1F8}',
      'Germany': '\u{1F1E9}\u{1F1EA}',
    };
    return flags[country] || '\u{1F30D}';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">PANEL ADMINISTRATORA</h1>
            <p className="text-slate-400 text-sm mt-1">Statystyki i zarzadzanie probami</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => window.location.href = "/"} variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-2"><ArrowLeft className="w-4 h-4" /> Wroc</Button>
            <Button onClick={handleLogout} variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-2"><LogOut className="w-4 h-4" /> Wyloguj</Button>
          </div>
        </div>

        <Card className="bg-slate-800 border-slate-700 mb-8 overflow-visible">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4"><Lock className="w-5 h-5 text-orange-400" /><h2 className="text-xl font-bold text-white font-mono">Zablokowane IP</h2></div>
            {lockedIPs.length > 0? <div className="flex flex-wrap gap-3">{lockedIPs.map((ip) => <div key={ip} className="bg-slate-700/50 rounded-lg p-3 border border-orange-500/50 flex items-center gap-3"><span className="text-orange-400 font-mono font-bold">{ip}</span><UnlockButton ipAddress={ip} /></div>)}</div> : <p className="text-slate-400 font-mono">Brak zablokowanych IP</p>}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 overflow-visible">
          <div className="p-6 overflow-visible">
            <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-cyan-400" /><h2 className="text-xl font-bold text-white font-mono">Historia prob</h2></div>
            <div className="w-full overflow-visible">
              <table className="w-full text-sm font-mono">
                <thead><tr className="border-b-2 border-slate-600"><th className="text-left py-3 px-3 text-slate-400">IP</th><th className="text-left py-3 px-3 text-slate-400">Kat</th><th className="text-left py-3 px-3 text-slate-400">Status</th><th className="text-left py-3 px-3 text-slate-400">Lokalizacja</th><th className="text-left py-3 px-3 text-slate-400">Czas</th><th className="text-left py-3 px-3 text-slate-400">Akcja</th></tr></thead>
                <tbody>
                  {attempts.map((attempt: any, idx: number) => {
                    const isLocked = lockedIPs.includes(attempt.ipAddress);
                    const mapUrl = attempt.latitude? `https://www.openstreetmap.org/?mlat=${attempt.latitude}&mlon=${attempt.longitude}&zoom=14` : `https://www.google.com/maps/search/?api=1&query=${attempt.latitude},${attempt.longitude}`;
                    return (
                      <tr key={idx} className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${isLocked? 'bg-red-900/20' : ''}`}>
                        <td className={`py-3 px-3 ${isLocked? 'text-red-400 font-bold' : 'text-slate-300'}`}>{attempt.ipAddress} {isLocked && <span className="text- bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full ml-2">ZABLOKOWANE</span>}</td>
                        <td className="py-3 px-3 text-slate-300 font-bold">{attempt.angle}{"\u00B0"}</td>
                        <td className="py-3 px-3">{attempt.isCorrect === 1? <span className="text-green-400 flex gap-1 font-bold"><CheckCircle2 className="w-4 h-4" /> OK</span> : <span className="text-red-400 flex gap-1 font-bold"><XCircle className="w-4 h-4" /> FAIL</span>}</td>

                        <td className="py-3 px-3 overflow-visible">
                          <div className="group relative inline-block overflow-visible">
                            <span className="flex items-center gap-1.5 cursor-help border-b border-dotted border-slate-500 hover:text-cyan-300 transition-colors">
                              <span>{getCountryFlag(attempt.country)}</span>
                              <span className="text-slate-200">{attempt.country}</span>
                              {attempt.city && <span className="text-slate-400 text-xs">({attempt.city})</span>}
                            </span>

                            {/* NOWY TOOLTIP - OPCJA 1 CLEAN & DARK */}
                            <div className="absolute left-0 top-full mt-3 hidden group-hover:block z-[9999] w- bg-[#1e293b] border border-slate-600/60 rounded- shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                              {/* Header */}
                              <div className="flex items-center gap-3 p- bg-white/[0.02] border-b border-slate-700/60">
                                <div className="w-9 h-9 rounded- bg-slate-900 border border-slate-600/50 grid place-items-center text-">{getCountryFlag(attempt.country)}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono font-bold text- text-white truncate">{attempt.ipAddress}</div>
                                  <div className="text- text-slate-400">{attempt.city || attempt.country} {"\u2022"} Online</div>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
                              </div>

                              {/* Body - rows */}
                              <div className="p-2">
                                <div className="px-3 py-2">
                                  <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                    <span className="text- text-slate-400 shrink-0">{"\u{1F30D}"} Kraj</span>
                                    <span className="text-[12.5px] font-medium text-slate-100 text-right break-words max-w-">{attempt.country}</span>
                                  </div>
                                  {attempt.city && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F3D9}\uFE0F"} Miasto</span>
                                      <span className="text-[12.5px] font-medium text-slate-100 text-right break-words max-w-">{attempt.city}</span>
                                    </div>
                                  )}
                                  {attempt.zip && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F4EE}"} Kod</span>
                                      <span className="text-[12.5px] font-medium text-slate-100 text-right">{attempt.zip}</span>
                                    </div>
                                  )}
                                  {attempt.timezone && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F550}"} Strefa</span>
                                      <span className="text- font-mono text-slate-200 text-right break-words max-w-">{attempt.timezone}</span>
                                    </div>
                                  )}
                                  {attempt.isp && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F4E1}"} ISP</span>
                                      <span className="text-[11.5px] font-medium text-slate-100 text-right break-words max-w- leading-[1.35]">{attempt.isp}</span>
                                    </div>
                                  )}
                                  {attempt.org && attempt.org!== attempt.isp && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F3E2}"} Org</span>
                                      <span className="text-[11.5px] font-medium text-slate-100 text-right break-words max-w- leading-[1.35]">{attempt.org}</span>
                                    </div>
                                  )}
                                  {attempt.as && (
                                    <div className="flex justify-between items-start py- border-b border-white/[0.06] gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F522}"} AS</span>
                                      <span className="text- font-mono text-slate-300 text-right break-words max-w-">{attempt.as}</span>
                                    </div>
                                  )}
                                  {attempt.latitude && (
                                    <div className="flex justify-between items-start py- gap-3">
                                      <span className="text- text-slate-400 shrink-0">{"\u{1F4CD}"} Coords</span>
                                      <span className="text- font-mono text-slate-300 text-right">{attempt.latitude}, {attempt.longitude}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="h-px bg-slate-700/60 mx-3"></div>

                              {/* Device */}
                              <div className="p-3 pt-2">
                                <div className="flex gap-2 text-">
                                  {attempt.browserFamily && <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-1 rounded-full">{"\u{1F310}"} {attempt.browserFamily}</span>}
                                  {attempt.osFamily && <span className="bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded-full">{"\u{1F4BB}"} {attempt.osFamily}</span>}
                                  {attempt.deviceType && <span className="bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded-full">{"\u{1F4F1}"} {attempt.deviceType}</span>}
                                </div>
                              </div>

                              {/* Button */}
                              {attempt.latitude && (
                                <div className="p-3 pt-0">
                                  <a href={mapUrl} target="_blank" className="flex w-full h- items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white rounded- text- font-bold transition-colors">
                                    {"\u{1F5FA}\uFE0F"} Zobacz na mapie
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 text-slate-400 text-xs">{attempt.createdAt? new Date(attempt.createdAt).toLocaleString("pl-PL") : ""}</td>
                        <td className="py-3 px-3"><UnlockButton ipAddress={attempt.ipAddress} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between mt-8 pt-4 border-t border-slate-700">
              <Button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} variant="outline" className="border-slate-600">Poprzednia</Button>
              <span className="text-slate-400 font-mono text-sm">Strona {page + 1}</span>
              <Button onClick={() => setPage(page + 1)} disabled={attempts.length < pageSize} variant="outline" className="border-slate-600">Nastepna</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}