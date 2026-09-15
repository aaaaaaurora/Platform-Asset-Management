import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext"; 

interface WarningFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
}

export default function WarningFormModal({ isOpen, onClose, assetId }: WarningFormModalProps) {
  const { token } = useAuth();
  const [descrizione, setDescrizione] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/warning/warnings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify({
          asset_id: assetId,
          descrizione: descrizione.trim() 
        })
      });

      // Gestione sicura del parsing per prevenire l'errore "Unexpected token '<'"
      const contentType = res.headers.get("content-type");
      let data: any = {};
      
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.error || `Errore Critico del Server (Codice: ${res.status})`);
      }

      setSuccess(true);
      
      setTimeout(() => {
        setSuccess(false);
        setDescrizione("");
        onClose();
      }, 2000);

    } catch (err: any) { 
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
      <div className="w-full max-w-md p-6 mx-4 bg-white rounded-xl shadow-2xl dark:bg-gray-800">
        
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            Nuova Segnalazione
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200"
            aria-label="Chiudi"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="p-4 text-sm font-medium text-green-800 bg-green-100 rounded-lg dark:bg-green-900/30 dark:text-green-400">
            Segnalazione aperta con successo! Il team di manutenzione è stato informato.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="descrizione" className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Descrizione del problema <span className="text-red-500">*</span>
              </label>
              <textarea
                id="descrizione"
                className="w-full p-3 text-sm text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                rows={4}
                placeholder="Descrivi dettagliatamente il guasto o l'anomalia riscontrata..."
                value={descrizione}
                onChange={(e) => setDescrizione(e.target.value)}
                required
                disabled={loading}
              ></textarea>
            </div>
            
            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-500/10 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={onClose} 
                disabled={loading}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Annulla
              </button>
              <button 
                type="submit" 
                disabled={loading || !descrizione.trim() || !assetId}
                className="px-5 py-2.5 text-sm font-medium text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center min-w-[140px]"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Invio in corso...
                  </span>
                ) : "Invia Segnalazione"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}