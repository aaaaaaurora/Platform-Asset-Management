import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGoogleLogin } from "@react-oauth/google";
import { QRCodeSVG } from 'qrcode.react'; 
import Label from "../form/Label";
import Input from "../form/input/InputField";
import Button from "../ui/button/Button";
import { useAuth } from "../../context/AuthContext";

export default function SignInForm() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [tempToken, setTempToken] = useState<string>("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Estraiamo il segreto manuale direttamente dall'URI senza fare chiamate extra!
  const manualSecret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;

  // 1. Funzione chiamata dal bottone Google
  const googleLogin = useGoogleLogin({
    onSuccess: async (credentialResponse) => {
      setError("");
      setLoading(true);
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ google_id_token: credentialResponse.access_token }),
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Errore di login");

        setTempToken(data.temp_token);
        
        // Salviamo l'URI (se presente) che servirà per QR Code e codice manuale
        setTotpUri(data.totp_uri || null);
        setStep(2); 
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    onError: () => setError("Autenticazione Google fallita"),
  });

  // 2. Funzione per l'invio del codice TOTP
  const handleTOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/auth/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp_token: tempToken, totp_code: totpCode }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Codice non valido");

      login(data.token);

      if (data.role === 'AMMINISTRATORE') {
        navigate("/dashboard");
      } else {
        navigate("/map");
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              {step === 1 ? "Login" : "Autenticazione a Due Fattori"}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step === 1 
                ? "Accedi utilizzando il tuo account Google per entrare nella piattaforma." 
                : "Inserisci il codice a 6 cifre di Microsoft Authenticator."}
            </p>
          </div>

          {error && (
            <div className="p-3 mb-5 text-sm font-medium text-red-600 rounded-lg bg-red-50 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            {step === 1 ? (
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => googleLogin()}
                  disabled={loading}
                  className="inline-flex items-center justify-center w-full gap-3 py-3 text-sm font-normal text-gray-700 transition-colors bg-gray-100 rounded-lg px-7 hover:bg-gray-200 hover:text-gray-800 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18.7511 10.1944C18.7511 9.47495 18.6915 8.94995 18.5626 8.40552H10.1797V11.6527H15.1003C15.0011 12.4597 14.4654 13.675 13.2749 14.4916L13.2582 14.6003L15.9087 16.6126L16.0924 16.6305C17.7788 15.1041 18.7511 12.8583 18.7511 10.1944Z" fill="#4285F4" />
                    <path d="M10.1788 18.75C12.5895 18.75 14.6133 17.9722 16.0915 16.6305L13.274 14.4916C12.5201 15.0068 11.5081 15.3666 10.1788 15.3666C7.81773 15.3666 5.81379 13.8402 5.09944 11.7305L4.99473 11.7392L2.23868 13.8295L2.20264 13.9277C3.67087 16.786 6.68674 18.75 10.1788 18.75Z" fill="#34A853" />
                    <path d="M5.10014 11.7305C4.91165 11.186 4.80257 10.6027 4.80257 9.99992C4.80257 9.3971 4.91165 8.81379 5.09022 8.26935L5.08523 8.1534L2.29464 6.02954L2.20333 6.0721C1.5982 7.25823 1.25098 8.5902 1.25098 9.99992C1.25098 11.4096 1.5982 12.7415 2.20333 13.9277L5.10014 11.7305Z" fill="#FBBC05" />
                    <path d="M10.1789 4.63331C11.8554 4.63331 12.9864 5.34303 13.6312 5.93612L16.1511 3.525C14.6035 2.11528 12.5895 1.25 10.1789 1.25C6.68676 1.25 3.67088 3.21387 2.20264 6.07218L5.08953 8.26943C5.81381 6.15972 7.81776 4.63331 10.1789 4.63331Z" fill="#EB4335" />
                  </svg>
                  {loading ? "Accesso in corso..." : "Accedi con Google"}
                </button>
              </div>
            ) : (
              <form onSubmit={handleTOTPSubmit}>
                <div className="space-y-6">
                  
                  {/* Sezione QR Code e Secret integrata pulita */}
                  {totpUri && (
                    <div className="flex flex-col items-center p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-200 dark:border-white/10 mb-4">
                      <p className="mb-3 text-sm font-medium text-center text-gray-700 dark:text-gray-300">
                        Nuovo account! Scansiona questo QR Code con Microsoft Authenticator per configurare il tuo accesso.
                      </p>
                      <div className="p-3 bg-white rounded-lg shadow-sm">
                        <QRCodeSVG value={totpUri} size={160} />
                      </div>
                      
                      {manualSecret && (
                        <div className="mt-4 text-center">
                          <p className="text-xs text-gray-500 mb-1">Non riesci a scansionare il codice?</p>
                          <p className="text-xs font-mono font-bold bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded select-all">
                            {manualSecret}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <Label>
                      Codice TOTP <span className="text-error-500">*</span>
                    </Label>
                    <Input 
                      type="text"
                      placeholder="123456" 
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                    />
                  </div>
                  <div>
                    <Button className="w-full" size="sm" disabled={loading}>
                      {loading ? "Verifica in corso..." : "Verifica e Accedi"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}