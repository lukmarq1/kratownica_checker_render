import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export default function AdminLogin({ onLoginSuccess }: AdminLoginProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const verifyPinMutation = trpc.admin.verifyPin.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await verifyPinMutation.mutateAsync({ pin });
      if (result.success) {
        // Store PIN in sessionStorage (not localStorage for security)
        sessionStorage.setItem("adminPin", pin);
        onLoginSuccess();
      } else {
        setError("Nieprawidłowy PIN");
        setPin("");
      }
    } catch (err) {
      setError("Błąd weryfikacji PIN");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-md mx-auto pt-20">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white font-mono mb-2">PANEL ADMINISTRATORA</h1>
          <p className="text-slate-400 font-mono text-sm">Wpisz PIN aby uzyskać dostęp</p>
        </div>

        <Card className="bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="border-b border-slate-700">
            <CardTitle className="text-white font-mono">Logowanie</CardTitle>
            <CardDescription className="text-slate-400">Wymagany PIN dostępu</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-red-400 text-sm font-mono">{error}</p>
                </div>
              )}

              <div>
                <Input
                  type="password"
                  placeholder="Wpisz PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  maxLength={6}
                  className="bg-slate-700 border-slate-600 text-white placeholder-slate-500 font-mono text-center text-2xl tracking-widest"
                  disabled={loading}
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                disabled={loading || pin.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-mono"
              >
                {loading ? "Sprawdzanie..." : "Zaloguj"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
