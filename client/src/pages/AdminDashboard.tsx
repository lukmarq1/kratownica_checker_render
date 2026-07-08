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
    if (confirm(`Odblokowa? IP: ${ipAddress}?`)) {
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
  const stats = statsQuery.data || { totalAttempts: 0, uniqueIps: 0, successfulAttempts: 0, failedAttempts: 0, currentlyLockedIps: 0, successRate: 0, repeatedOffenders: 0 };
  const successRate = stats.totalAttempts > 0? Math.round((stats.successfulAttempts / stats.totalAttempts) * 100) : 0;
  const attempts = attemptsQuery.data || [];
  const lockedIPs = lockedIPsQuery.data || [];
  const getCountryFlag = (country: string) => {
    const flags: Record<string, string> = { 'Poland': '????', 'United States': '????', 'United Kingdom': '????', 'Germany': '????', 'France': '????', 'Italy': '????', 'Spain': '????' };
    return flags[country] || '??';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div><h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">PANEL ADMINISTRATORA</h1><p className="text-slate-400 text-sm mt-1">Statystyki i zarz?dzanie pr車bami</p></div>
          <div className="flex gap-2">
            <Button onClick={() => window.location.href = "/"} variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-2"><ArrowLeft className="w-4 h-4" /> Wr車?</Button>
            <Button onClick={handleLogout} variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-2"><LogOut className="w-4 h-4" /> Wyloguj</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="bg-slate-800 border-slate-700"><div className="p-6"><div className="flex items-center justify-between"><div><p className="text-slate-400 text-sm font-mono">Razem pr車b</p><p className="text-3xl font-bold text-white font-mono mt-2">{stats.totalAttempts}</p></div><BarChart3 className="w-8 h-8 text-blue-400 opacity-50" /></div></div></Card>
          <Card className="bg-slate-800 border-slate-700"><div className="p-6"><div className="flex items-center justify-between"><div><p className="text-slate-400 text-sm font-mono">Unikalne IP</p><p className="text-3xl font-bold text-white font-mono mt-2">{stats.uniqueIps}</p></div><Users className="w-8 h-8 text-purple-400 opacity-50" /></div></div></Card>
          <Card className="bg-slate-800 border-slate-700"><div className="p-6"><div className="flex items-center justify-between"><div><p className="text-slate-400 text-sm font-mono">Procent sukcesu</p><p className="text-3xl font-bold text-white font-mono mt-2">{successRate}%</p></div><CheckCircle2 className="w-8 h-8 text-green-400 opacity-50" /></div></div></Card>
        </div>

        <Card className="bg-slate-800 border-slate-700 mb-8 overflow-visible">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4"><Lock className="w-5 h-5 text-orange-400" /><h2 className="text-xl font-bold text-white font-mono">Zablokowane IP</h2></div>
            {lockedIPsQuery.isLoading? <p className="text-slate-400 font-mono">?adowanie...</p> : lockedIPs.length > 0? (
              <div className="flex flex-wrap gap-3">{lockedIPs.map((ip) => (<div key={ip} className="bg-slate-700/50 rounded-lg p-3 border border-orange-500/50 flex items-center gap-3"><span className="text-orange-400 font-mono font-bold">{ip}</span><UnlockButton ipAddress={ip} /></div>))}</div>
            ) : <p className="text-slate-400 font-mono">Brak zablokowanych IP</p>}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 overflow-visible">
          <div className="p-6 overflow-visible">
            <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-cyan-400" /><h2 className="text-xl font-bold text-white font-mono">Historia pr車b</h2></div>
            <div className="w-full overflow-visible">
              <table className="w-full text-sm font-mono border-collapse">
                <thead><tr className="border-b-2 border-slate-600"><th className="text-left py-3 px-3 text-slate-400 font-bold">IP</th><th className="text-left py-3 px-3 text-slate-400 font-bold">K?t</th><th className="text-left py-3 px-3 text-slate-400 font-bold">Status</th><th className="text-left py-3 px-3 text-slate-400 font-bold">Lokalizacja</th><th className="text-left py-3 px-3 text-slate-400 font-bold">Czas</th><th className="text-left py-3 px-3 text-slate-400 font-bold">Akcja</th></tr></thead>
                <tbody>
                  {attempts.length === 0? <tr><td colSpan={6} className="text-center py-12 text-slate-500">Brak danych</td></tr> : attempts.map((attempt: any, idx: number) => {
                    const isLocked = lockedIPs.includes(attempt.ipAddress);
                    return (
                      <tr key={idx} className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${isLocked? 'bg-red-900/20' : ''}`}>
                        <td className={`py-3 px-3 ${isLocked? 'text-red-400 font-bold' : 'text-slate-300'}`}><div className="flex items-center gap-2 flex-wrap"><span>{attempt.ipAddress}</span>{isLocked && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">ZABLOKOWANE</span>}</div></td>
                        <td className="py-3 px-3 text-slate-300 font-bold">{attempt.angle}～</td>
                        <td className="py-3 px-3">{attempt.isCorrect === 1? <span className="text-green-400 flex items-center gap-1 font-bold"><CheckCircle2 className="w-4 h-4" /> OK</span> : <span className="text-red-400 flex items-center gap-1 font-bold"><XCircle className="w-4 h-4" /> FAIL</span>}</td>
                        <td className="py-3 px-3 text-slate-300 overflow-visible">
                          {attempt.country || attempt.city? (
                            <div className="group relative inline-block overflow-visible">
                              <span className="flex items-center gap-1.5 cursor-help border-b border-dotted border-slate-500 hover:border-cyan-400 hover:text-cyan-300">
                                <span className="text-base">{getCountryFlag(attempt.country)}</span><span className="font-medium">{attempt.country}</span>{attempt.city && <span className="text-slate-400 text-xs">({attempt.city})</span>}<Info className="w-3 h-3 text-slate-500 group-hover:text-cyan-400" />
                              </span>
                              <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] bg-slate-900 border-2 border-slate-600 rounded-xl p-4 text-xs text-slate-200 shadow-2xl min-w-[320px]">
                                <div className="font-bold text-white border-b border-slate-700 pb-2 mb-3">?? Dane lokalizacji</div>
                                <div className="space-y-1.5">
                                  {attempt.country && <div>?? Kraj: {attempt.country}</div>}
                                  {attempt.city && <div>??? Miasto: {attempt.city}</div>}
                                  {attempt.zip && <div>?? Kod: {attempt.zip}</div>}
                                  {attempt.timezone && <div>?? Strefa: {attempt.timezone}</div>}
                                  {attempt.isp && <div className="break-all">?? ISP: {attempt.isp}</div>}
                                  {attempt.org && <div className="break-all">?? Org: {attempt.org}</div>}
                                  {attempt.as && <div className="break-all">?? AS: {attempt.as}</div>}
                                </div>
                              </div>
                            </div>
                          ) : <span className="text-slate-500">Unknown</span>}
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-xs">{attempt.createdAt? new Date(attempt.createdAt).toLocaleString("pl-PL") : "Brak daty"}</td>
                        <td className="py-3 px-3"><UnlockButton ipAddress={attempt.ipAddress} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-8 pt-4 border-t border-slate-700">
              <Button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} variant="outline" className="border-slate-600 text-slate-300">Poprzednia</Button>
              <span className="text-slate-400 font-mono text-sm">Strona {page + 1}</span>
              <Button onClick={() => setPage(page + 1)} disabled={attempts.length < pageSize} variant="outline" className="border-slate-600 text-slate-300">Nast?pna</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}