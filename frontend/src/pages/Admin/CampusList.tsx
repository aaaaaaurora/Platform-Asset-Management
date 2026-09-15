import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";

interface Campus {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export default function CampusListPage() {
  const { token } = useAuth();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Stato per il Modale di Eliminazione
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [campusToDelete, setCampusToDelete] = useState<{ id: string; name: string } | null>(null);
  
  // NUOVO STATO: Blocca il bottone durante l'eliminazione
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCampuses = async () => {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/geozone/api/geozones/campuses`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Errore nel caricamento dei campus.");
      
      setCampuses(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCampuses();
  }, [token]);

  const confirmDelete = (id: string, name: string) => {
    setCampusToDelete({ id, name });
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (!campusToDelete) return;
    
    // Attiviamo lo spinner e blocchiamo i click multipli 
    setIsDeleting(true);

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/geozone/api/geozones/campuses/${campusToDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Errore durante l'eliminazione.");
      }

      setCampuses(prevCampuses => prevCampuses.filter(c => c.id !== campusToDelete.id));
      
      setIsDeleteModalOpen(false);
      setCampusToDelete(null);

    } catch (err: any) {
      setErrorMsg(err.message);
      setIsDeleteModalOpen(false);
    } finally {
      // Spegniamo lo spinner a operazione conclusa (sia con successo che con errore)
      setIsDeleting(false);
    }
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return "-";
    return new Date(isoString).toLocaleDateString('it-IT', { 
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };

  return (
    <>
      <PageMeta title="Gestione Campus | Asset Management" description="Visualizza e gestisci i campus universitari." />

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Gestione Campus
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Elenco delle aree geografiche registrate come campus.
          </p>
        </div>
        
        <Link
          to="/admin/campus/new"
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Registra Nuovo Campus
        </Link>
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-4 text-rose-800 shadow-sm">
          <p className="font-semibold">{errorMsg}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
              <tr>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Nome Campus</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Descrizione</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Data Registrazione</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs text-right"></th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <div className="flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-blue-600 border-t-transparent"></div></div>
                  </td>
                </tr>
              ) : campuses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center font-medium text-slate-500">
                    Nessun campus registrato a sistema.
                  </td>
                </tr>
              ) : (
                campuses.map((campus) => (
                  <tr key={campus.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800 dark:text-slate-200">{campus.name}</td>
                    <td className="py-4 px-6 text-slate-500 italic">{campus.description || "Nessuna descrizione"}</td>
                    <td className="py-4 px-6">{formatDate(campus.created_at)}</td>
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => confirmDelete(campus.id, campus.name)}
                        className="inline-flex items-center text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 font-semibold text-xs uppercase transition-colors"
                      >
                        <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isDeleteModalOpen && campusToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transform transition-all">
            
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <svg className="h-6 w-6 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Elimina Campus</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Azione irreversibile</p>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-300 text-sm mb-6">
              Sei sicuro di voler eliminare definitivamente il campus <span className="font-bold text-slate-800 dark:text-white">"{campusToDelete.name}"</span> e tutti gli asset associati?
            </p>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Annulla
              </button>
              
              {/* Bottone aggiornato con Spinner e controllo di disabilitazione */}
              <button
                onClick={executeDelete}
                disabled={isDeleting}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 transition-colors focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Eliminazione...
                  </>
                ) : (
                  "Sì, elimina"
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}