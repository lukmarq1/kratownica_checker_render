import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  BarChart3,
  Lock,
  Users,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Globe,
  Smartphone,
  Download,
  Search,
} from "lucide-react";
import { useLocation } from "wouter";

export default function AdminDashboardEnhanced() {
  const { user, loading } = useAuth();
  const [selectedIP, setSelectedIP] = useState<string | null>(null);
  const [searchIP, setSearchIP] = useState("");
  const [, setLocation] = useLocation();

  const analyticsQuery = trpc.admin.getAdvancedAnalytics.useQuery(undefined, {
    enabled: !!user,
  });

  const userProfileQuery = trpc.admin.getUserProfile.useQuery(
    { ipAddress: selectedIP || "" },
    { enabled: !!user && !!selectedIP }
  );

  const exportQuery = trpc.admin.exportData.useQuery(undefined, {
    enabled: false,
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-slate-400 font-mono">Ładowanie...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-300 font-mono mb-4">Brak dostępu</p>
          <p className="text-slate-400 text-sm">Musisz być zalogowany jako właściciel</p>
        </div>
      </div>
    );
  }

  const analytics = analyticsQuery.data;
  const profile = userProfileQuery.data;

  const handleExport = async () => {
    const csv = await exportQuery.refetch();
    if (csv.data) {
      const blob = new Blob([csv.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kratownica-attempts-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 md:p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-bold font-mono tracking-tighter text-slate-100">
            ZAAWANSOWANA ANALITYKA
          </h1>
          <Button
            onClick={() => setLocation("/")}
            variant="outline"
            className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Wróć
          </Button>
        </div>
        <p className="text-sm font-mono text-slate-400 tracking-widest uppercase">
          Śledzenie użytkowników i geolokalizacja
        </p>
        <div className="h-1 w-16 bg-gradient-to-r from-blue-500 to-cyan-500 mt-4"></div>
      </div>

      {/* Main Statistics */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Razem prób</span>
          </div>
          <div className="text-3xl font-bold font-mono text-cyan-400">{analytics?.totalAttempts || 0}</div>
        </Card>

        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Unikalne IP</span>
          </div>
          <div className="text-3xl font-bold font-mono text-blue-400">{analytics?.uniqueIps || 0}</div>
        </Card>

        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Udane</span>
          </div>
          <div className="text-3xl font-bold font-mono text-green-400">{analytics?.successfulAttempts || 0}</div>
        </Card>

        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <XCircle className="w-5 h-5 text-red-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Nieudane</span>
          </div>
          <div className="text-3xl font-bold font-mono text-red-400">{analytics?.failedAttempts || 0}</div>
        </Card>

        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Sukces %</span>
          </div>
          <div className="text-3xl font-bold font-mono text-purple-400">{analytics?.successRate || "0"}%</div>
        </Card>

        <Card className="bg-slate-800 border border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <Lock className="w-5 h-5 text-orange-400" />
            <span className="text-xs font-mono text-slate-400 uppercase">Powtórzeni</span>
          </div>
          <div className="text-3xl font-bold font-mono text-orange-400">{analytics?.repeatOffenders?.length || 0}</div>
        </Card>
      </div>

      {/* Geographic Distribution */}
      {analytics?.geographicDistribution && analytics.geographicDistribution.length > 0 && (
        <div className="max-w-7xl mx-auto mb-8">
          <Card className="bg-slate-800 border border-slate-700">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-5 h-5 text-cyan-400" />
                <h2 className="text-xl font-bold font-mono text-slate-100">Rozkład geograficzny</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                {analytics.geographicDistribution.map((item, idx) => (
                  <div key={idx} className="bg-slate-700/50 rounded p-3 border border-slate-600">
                    <p className="text-sm font-mono text-slate-400">{item.country || "Unknown"}</p>
                    <p className="text-2xl font-bold text-cyan-400">{item.count}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Device Distribution */}
      {analytics?.deviceDistribution && analytics.deviceDistribution.length > 0 && (
        <div className="max-w-7xl mx-auto mb-8">
          <Card className="bg-slate-800 border border-slate-700">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <h2 className="text-xl font-bold font-mono text-slate-100">Rozkład urządzeń</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {analytics.deviceDistribution.map((item, idx) => (
                  <div key={idx} className="bg-slate-700/50 rounded p-3 border border-slate-600">
                    <p className="text-sm font-mono text-slate-400">{item.deviceType || "Unknown"}</p>
                    <p className="text-2xl font-bold text-blue-400">{item.count}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Repeat Offenders */}
      {analytics?.repeatOffenders && analytics.repeatOffenders.length > 0 && (
        <div className="max-w-7xl mx-auto mb-8">
          <Card className="bg-slate-800 border border-slate-700">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-5 h-5 text-red-400" />
                <h2 className="text-xl font-bold font-mono text-slate-100">Powtórzeni sprawcy</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-4 text-slate-400 font-bold">IP Address</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-bold">Kraj</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-bold">Razem</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-bold">Nieudane</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-bold">Akcja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.repeatOffenders.map((offender) => (
                      <tr key={offender.id} className="border-b border-slate-700 hover:bg-slate-700/50">
                        <td className="py-3 px-4 text-slate-300 cursor-pointer hover:text-cyan-400" onClick={() => setSelectedIP(offender.ipAddress)}>
                          {offender.ipAddress}
                        </td>
                        <td className="py-3 px-4 text-slate-300">{offender.country || "Unknown"}</td>
                        <td className="py-3 px-4 text-slate-300">{offender.totalAttempts}</td>
                        <td className="py-3 px-4 text-red-400 font-bold">{offender.failedAttempts}</td>
                        <td className="py-3 px-4">
                          <Button
                            onClick={() => setSelectedIP(offender.ipAddress)}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs"
                          >
                            <Search className="w-3 h-3 mr-1" />
                            Szczegóły
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* User Profile Details */}
      {selectedIP && profile && (
        <div className="max-w-7xl mx-auto mb-8">
          <Card className="bg-slate-800 border border-slate-700">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold font-mono text-slate-100">Profil: {selectedIP}</h2>
                <Button
                  onClick={() => setSelectedIP(null)}
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  Zamknij
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-700/50 rounded p-4 border border-slate-600">
                  <p className="text-xs font-mono text-slate-400 mb-1">KRAJ</p>
                  <p className="text-lg font-bold text-cyan-400">{profile.country || "Unknown"}</p>
                </div>
                <div className="bg-slate-700/50 rounded p-4 border border-slate-600">
                  <p className="text-xs font-mono text-slate-400 mb-1">MIASTO</p>
                  <p className="text-lg font-bold text-cyan-400">{profile.city || "Unknown"}</p>
                </div>
                <div className="bg-slate-700/50 rounded p-4 border border-slate-600">
                  <p className="text-xs font-mono text-slate-400 mb-1">ISP</p>
                  <p className="text-lg font-bold text-cyan-400">{profile.isp || "Unknown"}</p>
                </div>
                <div className="bg-slate-700/50 rounded p-4 border border-slate-600">
                  <p className="text-xs font-mono text-slate-400 mb-1">URZĄDZENIE</p>
                  <p className="text-lg font-bold text-cyan-400">{profile.deviceType || "Unknown"}</p>
                </div>
              </div>

              {profile.attempts && profile.attempts.length > 0 && (
                <div>
                  <h3 className="text-sm font-mono text-slate-400 mb-3 uppercase">Historia prób ({profile.attempts.length})</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {profile.attempts.map((attempt) => (
                      <div key={attempt.id} className="bg-slate-700/30 rounded p-3 border border-slate-600 text-xs font-mono">
                        <div className="flex justify-between items-center">
                          <span className={attempt.isCorrect === 1 ? "text-green-400" : "text-red-400"}>
                            {attempt.angle}° - {attempt.isCorrect === 1 ? "✓ OK" : "✗ FAIL"}
                          </span>
                          <span className="text-slate-500">{new Date(attempt.createdAt).toLocaleString("pl-PL")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Export Button */}
      <div className="max-w-7xl mx-auto">
        <Button
          onClick={handleExport}
          disabled={exportQuery.isPending}
          className="bg-green-600 hover:bg-green-700 text-white font-mono gap-2"
        >
          <Download className="w-4 h-4" />
          {exportQuery.isPending ? "Eksportowanie..." : "Eksportuj CSV"}
        </Button>
      </div>
    </div>
  );
}
