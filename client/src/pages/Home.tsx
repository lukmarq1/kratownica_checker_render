import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { detectBrowser } from "@/lib/browser";
import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, Lock, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

// Generuje stabilny fingerprint - ten sam na WiFi i LTE na tym samym telefonie
function generateFingerprint() {
  try {
    const nav = navigator as any;
    const components = [
      navigator.userAgent,
      navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      new Date().getTimezoneOffset().toString(),
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      (nav.hardwareConcurrency || "").toString(),
      (nav.deviceMemory || "").toString(),
      (nav.platform || ""),
    ];
    const raw = components.join("|");
    // prosty hash + base64 żeby był stabilny i krótki
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    const hashStr = Math.abs(hash).toString(16).padStart(8, "0");
    const b64 = btoa(raw).slice(0, 24).replace(/[^a-zA-Z0-9]/g, "");
    return `${hashStr}-${b64}`.toLowerCase();
  } catch {
    return "fp-fallback";
  }
}

function getOrCreateDeviceId(): string {
  try {
    const key = "kratownica_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "";
  }
}

export default function Home() {
  const [angle, setAngle] = useState<number>(0);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    remainingAttempts?: number;
    remainingLockoutMs?: number;
  } | null>(null);

  const [fingerprint, setFingerprint] = useState<string>("");
  const [deviceId, setDeviceId] = useState<string>("");
  const [, setLocation] = useLocation();

  // wygeneruj raz po załadowaniu
  useEffect(() => {
    setFingerprint(generateFingerprint());
    setDeviceId(getOrCreateDeviceId());
  }, []);

  const statusInput = useMemo(() => {
    if (!fingerprint && !deviceId) return undefined;
    return { fingerprint, deviceId };
  }, [fingerprint, deviceId]);

  const statusQuery = trpc.angle.status.useQuery(statusInput as any, {
    refetchInterval: 5000,
    enabled: !!fingerprint || !!deviceId,
  });

  const verifyMutation = trpc.angle.verify.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        setResult({
          success: true,
          message: "✅ Poprawny kąt!",
        });
        statusQuery.refetch();
      } else if (data.reason === "locked" || data.reason === "vpn_detected") {
        const isVpn = data.reason === "vpn_detected";
        setResult({
          success: false,
          message: isVpn ? "🔒 Wykryto zmianę sieci / VPN. Blokada 24h!" : "🔒 Twoje urządzenie zostało zablokowane!",
          remainingLockoutMs: data.remainingLockoutMs,
        });
        statusQuery.refetch();
      } else {
        setResult({
          success: false,
          message: `❌ Niepoprawny kąt. Pozostało prób: ${data.remainingAttempts}`,
          remainingAttempts: data.remainingAttempts,
        });
        statusQuery.refetch();
      }
    },
    onError: (error) => {
      setResult({
        success: false,
        message: `Błąd: ${error.message}`,
      });
    },
  });

  const handleVerify = async () => {
    if (verifyMutation.isPending) return;
    setResult(null);

    const browser = detectBrowser();

    await verifyMutation.mutateAsync({
      angle,
      browser: browser as any,
      fingerprint, // <- KLUCZOWE: wysyłamy ten sam fingerprint na WiFi i LTE
      deviceId,
    } as any);
  };

  const handleAdmin = () => {
    setLocation("/admin");
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const status: any = statusQuery.data;
  const isLocked = status?.isLocked || status?.locked || false;
  const remainingAttempts = status?.remainingAttempts ?? status?.attemptsLeft ?? 2;
  const lockoutTime = status?.remainingLockoutMs ?? status?.remainingMs ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="bg-slate-800 border-slate-700 p-6">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold font-mono text-slate-100 tracking-tighter">
              KRATOWNICA CHECKER
            </h1>
            <p className="text-slate-400 text-sm font-mono mt-1">Zweryfikuj kąt</p>
            <div className="h-0.5 w-16 bg-gradient-to-r from-blue-500 to-cyan-500 mx-auto mt-3"></div>
          </div>

          {/* Status */}
          <div className="bg-slate-700/50 rounded-lg p-3 mb-6">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-slate-400">Status</span>
              {isLocked ? (
                <span className="text-red-400 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> ZABLOKOWANY
                </span>
              ) : (
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> AKTYWNY
                </span>
              )}
            </div>
            <div className="flex justify-between items-center text-xs font-mono mt-1">
              <span className="text-slate-400">Pozostało prób</span>
              <span className="text-cyan-400 font-bold">{remainingAttempts}</span>
            </div>
            {isLocked && (
              <div className="flex justify-between items-center text-xs font-mono mt-1">
                <span className="text-slate-400">Blokada do</span>
                <span className="text-orange-400 font-bold">{formatTime(lockoutTime)}</span>
              </div>
            )}
            {/* debug - możesz usunąć */}
            <div className="text-[10px] text-slate-500 font-mono mt-2 truncate">
              ID: {fingerprint.slice(0, 16)}...
            </div>
          </div>

          {/* Locked state */}
          {isLocked ? (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-center">
              <Lock className="w-12 h-12 text-red-400 mx-auto mb-2" />
              <p className="text-red-400 font-mono font-bold">DOSTĘP ZABLOKOWANY</p>
              <p className="text-slate-400 text-sm font-mono mt-1">Przekroczono limit prób lub wykryto zmianę sieci. Spróbuj ponownie za:</p>
              <p className="text-3xl font-bold font-mono text-orange-400 mt-2">{formatTime(lockoutTime)}</p>
            </div>
          ) : (
            <>
              {/* Input */}
              <div className="mb-4">
                <label className="block text-slate-400 text-sm font-mono mb-2">Wprowadź kąt (0-360°)</label>
                <input
                  type="number"
                  min="0"
                  max="360"
                  value={angle}
                  onChange={(e) => setAngle(Number(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 font-mono text-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  placeholder="np. 65"
                  disabled={verifyMutation.isPending}
                />
              </div>

              {/* Verify Button */}
              <Button
                onClick={handleVerify}
                disabled={verifyMutation.isPending || isLocked}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-mono font-bold py-6 text-lg disabled:opacity-50"
              >
                {verifyMutation.isPending ? (
                  "WERYFIKACJA..."
                ) : (
                  <>
                    SPRAWDŹ KĄT <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </>
          )}

          {/* Result */}
          {result && (
            <div
              className={`mt-4 p-3 rounded-lg font-mono text-sm ${result.success ? "bg-green-900/30 border border-green-700 text-green-400" : "bg-red-900/30 border border-red-700 text-red-400"}`}
            >
              {result.message}
              {result.remainingAttempts !== undefined && !result.success && (
                <p className="text-slate-400 text-xs mt-1">Pozostało prób: {result.remainingAttempts}</p>
              )}
              {result.remainingLockoutMs ? (
                <p className="text-orange-400 text-xs mt-1 font-bold">Odblokowanie za: {formatTime(result.remainingLockoutMs)}</p>
              ) : null}
            </div>
          )}
        </Card>

        {/* Admin button */}
        <div className="text-center mt-4">
          <button onClick={handleAdmin} className="text-slate-500 hover:text-slate-300 text-xs font-mono transition-colors">
            Panel administratora
          </button>
        </div>
      </div>
    </div>
  );
}
