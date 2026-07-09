import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Lock, CheckCircle2, XCircle, ArrowLeft, LogOut, MapPin, Globe, Monitor, Clock, Laptop, ShieldAlert, Smartphone } from "lucide-react";
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
    <Button
      onClick={() => {
        if (confirm(`Odblokować ${ipAddress}?`)) m.mutateAsync({ ipAddress });
      }}
      disabled={m.isPending}
      size="sm"
      className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-mono text-xs h-8 px-4 font-bold w-full mt-3"
    >
      {m.isPending ? "..." : "Odblokuj"}
    </Button>
  );
}

function IpTooltip({ a }: { a: any }) {
  const mapUrl = a.latitude
    ? `https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}&zoom=14`
    : `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;

  return (
    <div className="absolute left-0 top-full mt-3 hidden group-hover:block z-[9999] w-[380px] bg-[#1e293b] border border-[#334155] rounded-[16px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-3 px-5 py-[18px] border-b border-[#334155] bg-white/[0.02]">
        <div className="w-9 h-9 rounded-[10px] bg-[#0f172a] border border-[#334155] grid place-items-center text-lg">
          {"\u{1F4CD}"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] font-bold text-white truncate">{a.ipAddress}</div>
          <div className="text-[11px] text-[#64748b]">{a.city || a.country} {"\u2022"} Online</div>
        </div>
        <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]"></div>
      </div>
      <div className="px-5 py-[14px]">
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F30D} Kraj"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.country} {"\u{1F1F5}\u{1F1F1}"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F3D9}\uFE0F Miasto"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.city || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F4EE} Kod"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.zip || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F550} Strefa"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.timezone || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F4E1} ISP"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words leading-[1.35]">{a.isp || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F3E2} Org"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words leading-[1.35]">{a.org || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] border-b border-white/[0.06] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F522} AS"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.as || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[9px] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F4CD} Coords"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.latitude ? `${a.latitude}, ${a.longitude}` : "\u2014"}</span>
        </div>
      </div>
      <div className="h-px bg-[#334155] mx-5"></div>
      <div className="px-5 pt-[10px] pb-0">
        <div className="flex justify-between py-[5px] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F310} Przegl\u0105darka"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.browserFamily || "\u2014"}</span>
        </div>
        <div className="flex justify-between py-[5px] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F4BB} System"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.osFamily || "Unknown"}</span>
        </div>
        <div className="flex justify-between py-[5px] gap-4">
          <span className="text-[#94a3b8] text-[12.5px]">{"\u{1F4F1} Urz\u0105dzenie"}</span>
          <span className="text-[#e2e8f0] font-medium text-[12.5px] text-right max-w-[200px] break-words">{a.deviceType || "desktop"}</span>
        </div>
      </div>
      <div className="p-5">
        <a href={mapUrl} target="_blank" rel="noreferrer" className="flex w-full h-[42px] items-center justify-center gap-2 rounded-[10px] bg-[#0ea5e9] hover:bg-[#0284c7] font-bold text-[13px] text-white no-underline transition-colors">
          {"\u{1F5FA}\uFE0F Zobacz na mapie"}
        </a>
      </div>
    </div>
  );
}

const COUNTRY_MAP: Record<string, string> = {
  "Poland": "PL", "Polska": "PL",
  "United States": "US", "USA": "US", "United States of America": "US",
  "Germany": "DE", "Niemcy": "DE",
  "Norway": "NO", "Norwegia": "NO",
  "Netherlands": "NL", "Holandia": "NL",
  "United Kingdom": "GB", "Wielka Brytania": "GB", "UK": "GB", "England": "GB",
  "France": "FR", "Francja": "FR",
  "Sweden": "SE", "Szwecja": "SE",
  "Denmark": "DK", "Dania": "DK",
  "Finland": "FI", "Finlandia": "FI",
  "Czech Republic": "CZ", "Czechia": "CZ", "Czechy": "CZ",
  "Slovakia": "SK", "Słowacja": "SK",
  "Ukraine": "UA", "Ukraina": "UA",
  "Russia": "RU", "Rosja": "RU",
  "Belarus": "BY", "Białoruś": "BY",
  "Lithuania": "LT", "Litwa": "LT",
  "Latvia": "LV", "Łotwa": "LV",
  "Estonia": "EE", "Estonia": "EE",
  "Italy": "IT", "Włochy": "IT",
  "Spain": "ES", "Hiszpania": "ES",
  "Portugal": "PT", "Portugalia": "PT",
  "Ireland": "IE", "Irlandia": "IE",
  "Belgium": "BE", "Belgia": "BE",
  "Austria": "AT",
  "Switzerland": "CH", "Szwajcaria": "CH",
  "Canada": "CA", "Kanada": "CA",
  "Australia": "AU",
  "Brazil": "BR", "Brazylia": "BR",
  "Japan": "JP", "Japonia": "JP",
  "China": "CN", "Chiny": "CN",
  "India": "IN", "Indie": "IN",
  "Turkey": "TR", "Turcja": "TR",
  "Greece": "GR", "Grecja": "GR",
  "Hungary": "HU", "Węgry": "HU",
  "Romania": "RO", "Rumunia": "RO",
  "Bulgaria": "BG", "Bułgaria": "BG",
  "Croatia": "HR", "Chorwacja": "HR",
  "Serbia": "RS", "Serbia": "RS",
  "Slovenia": "SI", "Słowenia": "SI",
  "Iceland": "IS", "Islandia": "IS",
};

function isoToFlag(iso: string) {
  if (!iso || iso.length !== 2) return "🌍";
  return String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const getFlagStatic = (countryName: string, countryCode?: string) => {
  if (countryCode && countryCode.length === 2) return isoToFlag(countryCode);
  if (!countryName) return "🌍";
  const code = COUNTRY_MAP[countryName];
  if (code) return isoToFlag(code);
  // fallback: spróbuj pierwsze 2 litery jako kod
  return "🌍";
};

function BlockedCard({ id, attempts }: { id: string, attempts: any[] }) {
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(id);
  // znajdź ostatnią próbę dla tego ID
  const details = attempts.find((a: any) => 
    a.ipAddress === id || 
    a.fingerprint === id || 
    a.id === id
  ) || attempts.find((a: any) => !isIp && a.ipAddress && attempts.length > 0) || null;

  // dla fingerprint, jeśli nie ma fingerprint w historii, weź ostatnią próbę z tym samym IP żeby pokazać kraj
  const fallback = !details && !isIp ? attempts[0] : null;
  const info = details || fallback;

  return (
    <div className="bg-[#0f172a] border border-orange-500/30 rounded-xl p-4 hover:border-orange-500/60 transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.15)] flex flex-col">
      {/* HEADER */}
      <div className="flex justify-between items-start mb-3">
        <span className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full font-bold tracking-wide border ${isIp ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' : 'bg-purple-500/10 text-purple-300 border-purple-500/30'}`}>
          {isIp ? <><Globe className="w-3 h-3" /> IP / VPN</> : <><Monitor className="w-3 h-3" /> URZĄDZENIE</>}
        </span>
        {info?.country && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
            <span>{getFlagStatic(info.country, info.countryCode || info.country_code)}</span> {info.country} {info.city ? `• ${info.city}` : ''}
          </span>
        )}
      </div>

      {/* ID */}
      <div className="font-mono text-[13px] text-orange-300 break-all bg-black/40 p-2.5 rounded-lg border border-white/5 leading-relaxed">
        {isIp ? id : `${id.slice(0, 20)}...`}
        {!isIp && <div className="text-[10px] text-slate-500 mt-1">ID: {id.slice(0,8)}... chronione przed VPN</div>}
      </div>

      {/* DETAILS */}
      <div className="mt-3 space-y-2 text-xs font-mono flex-1">
        {info ? (
          <>
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md">
              <span className="flex items-center gap-1.5"><Laptop className="w-3.5 h-3" /> Przeglądarka</span>
              <span className="text-slate-200 truncate max-w-[130px] text-right">{info.browserFamily || info.browser || 'Chrome'} / {info.osFamily || 'Windows'}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400 bg-white/[0.02] px-2.5 py-1.5 rounded-md">
              <span className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3" /> Urządzenie</span>
              <span className="text-slate-200">{info.deviceType || 'desktop'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md">
                <div className="text-[10px] text-slate-500">Ostatni kąt</div>
                <div className="text-cyan-300 font-bold">{info.angle ?? '—'}°</div>
              </div>
              <div className="bg-white/[0.02] px-2.5 py-1.5 rounded-md">
                <div className="text-[10px] text-slate-500">Status</div>
                <div className="text-red-400 font-bold">2 x FAIL</div>
              </div>
            </div>
            <div className="flex justify-between items-center text-slate-400 px-1 pt-1">
              <span className="flex items-center gap-1 text-[11px]"><Clock className="w-3 h-3" /> Zablokowano</span>
              <span className="text-slate-300 text-[11px]">{info.createdAt ? new Date(info.createdAt).toLocaleString("pl-PL") : 'teraz'}</span>
            </div>
            {isIp && info.isp && (
              <div className="text-[11px] text-slate-500 truncate px-1">ISP: {info.isp}</div>
            )}
          </>
        ) : (
          <div className="text-slate-500 italic text-center py-4">
            <ShieldAlert className="w-6 h-6 mx-auto mb-1 opacity-50" />
            Brak szczegółów w historii<br/>
            <span className="text-[11px]">ID urządzenia z fingerprintingu</span>
          </div>
        )}
      </div>

      <UnlockButton ipAddress={id} />
    </div>
  );
}

export default function AdminDashboard() {
  const [pinVerified, setPinVerified] = useState(() => !!sessionStorage.getItem("adminPin"));
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const attemptsQ = trpc.admin.getAttempts.useQuery({ limit: pageSize, offset: page * pageSize }, { enabled: pinVerified });
  const lockedQ = trpc.admin.getLockedIPs.useQuery(undefined, { enabled: pinVerified });
  if (!pinVerified) return <AdminLogin onLoginSuccess={() => setPinVerified(true)} />;
  const attempts = attemptsQ.data || [];
  const lockedIPs = lockedQ.data || [];

  const getFlag = (c: string, code?: string) => getFlagStatic(c, code);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 pb-20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">PANEL ADMINISTRATORA</h1>
            <p className="text-slate-400 text-sm mt-1 font-mono">Historia prób i blokady</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => (window.location.href = "/")} variant="outline" className="border-slate-600 text-slate-300 gap-2"><ArrowLeft className="w-4 h-4" />Wróć</Button>
            <Button onClick={() => { sessionStorage.removeItem("adminPin"); setPinVerified(false); }} variant="outline" className="border-slate-600 text-slate-300 gap-2"><LogOut className="w-4 h-4" />Wyloguj</Button>
          </div>
        </div>

        <Card className="bg-slate-800 border-slate-700 mb-6">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
                <Lock className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white font-mono flex items-center gap-2">
                  Zablokowane urządzenia / IP
                  <span className="text-xs bg-orange-500/20 text-orange-300 px-2.5 py-0.5 rounded-full border border-orange-500/20">{lockedIPs.length} blokad</span>
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">💻 = fingerprint (odporne na VPN) • 🌐 = adres IP</p>
              </div>
            </div>
            {lockedIPs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {lockedIPs.map((ip: string) => (
                  <BlockedCard key={ip} id={ip} attempts={attempts} />
                ))}
              </div>
            ) : <p className="text-slate-400 font-mono text-sm bg-slate-900/50 border border-dashed border-slate-700 rounded-xl p-8 text-center">Brak zablokowanych urządzeń 🎉<br/><span className="text-xs text-slate-500">Wszystkie urządzenia mają dostęp</span></p>}
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 overflow-visible">
          <div className="p-6 overflow-visible">
            <div className="flex items-center gap-2 mb-6"><MapPin className="w-5 h-5 text-cyan-400" /><h2 className="text-lg font-bold text-white font-mono">Historia prób</h2></div>
            <div className="overflow-visible">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b-2 border-slate-600">
                    <th className="text-left py-3 px-3 text-slate-400">IP</th>
                    <th className="text-left py-3 px-3 text-slate-400">Kąt</th>
                    <th className="text-left py-3 px-3 text-slate-400">Status</th>
                    <th className="text-left py-3 px-3 text-slate-400">Urządzenie</th>
                    <th className="text-left py-3 px-3 text-slate-400">Lokalizacja</th>
                    <th className="text-left py-3 px-3 text-slate-400">Czas</th>
                    <th className="text-left py-3 px-3 text-slate-400">Akcja</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a: any, idx: number) => {
                    const isLocked = lockedIPs.includes(a.ipAddress) || (a.fingerprint && lockedIPs.includes(a.fingerprint));
                    return (
                      <tr key={idx} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${isLocked ? "bg-red-900/20" : ""}`}>
                        <td className={`py-3 px-3 ${isLocked ? "text-red-400 font-bold" : "text-slate-300"}`}>{a.ipAddress}</td>
                        <td className="py-3 px-3 text-slate-300 font-bold">{a.angle}{"\u00B0"}</td>
                        <td className="py-3 px-3">{a.isCorrect === 1 ? <span className="text-green-400 flex items-center gap-1 font-bold"><CheckCircle2 className="w-4 h-4" />OK</span> : <span className="text-red-400 flex items-center gap-1 font-bold"><XCircle className="w-4 h-4" />FAIL</span>}</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col">
                            <span className="text-[11px] text-purple-300 font-mono bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded w-fit">{a.fingerprint ? `${a.fingerprint.slice(0,8)}...` : a.browserFamily ? `${a.browserFamily}` : '—'}</span>
                            {a.fingerprint && <span className="text-[10px] text-slate-500 mt-0.5">{a.osFamily || ''} • {a.deviceType || 'desktop'}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 overflow-visible">
                          <div className="group relative inline-block">
                            <span className="flex items-center gap-1.5 cursor-help border-b border-dotted border-slate-500 hover:text-cyan-300 text-slate-300">
                              <span>{getFlag(a.country, a.countryCode || a.country_code)}</span><span className="text-slate-200">{a.country}</span>{a.city && <span className="text-slate-400 text-xs">({a.city})</span>}
                            </span>
                            <IpTooltip a={a} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-xs">{a.createdAt ? new Date(a.createdAt).toLocaleString("pl-PL") : ""}</td>
                        <td className="py-3 px-3"><UnlockButton ipAddress={a.fingerprint || a.ipAddress} /></td>
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
    </div>
  );
}
