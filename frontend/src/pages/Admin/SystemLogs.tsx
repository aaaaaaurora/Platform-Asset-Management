import { useState, useEffect, useRef } from "react";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { io } from "socket.io-client"; // <-- AGGIUNTA: Import WebSocket
import LogsTable, { AuditLog } from "../../components/admin/LogsTable";

interface Campus {
  id: string;
  name: string;
}

interface Category {
  _id: string;
  name: string;
}

type LogViewType = 'business' | 'system';

export default function SystemLogs() {
  const { token } = useAuth();
  
  // Vista corrente: 'business' (Operativi/Filtrabili) di default 
  const [currentView, setCurrentView] = useState<LogViewType>('business');

  // Dati
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  
  // Stati Filtri
  const [availableCampuses, setAvailableCampuses] = useState<Campus[]>([]);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>([]);
  const [isCampusDropdownOpen, setIsCampusDropdownOpen] = useState(false);
  
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  
  // Paginazione
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  
  // Alert Errori
  const [errorMsg, setErrorMsg] = useState("");
  const [exportWarning, setExportWarning] = useState("");

  // <-- AGGIUNTA: REF PER I FILTRI WEBSOCKET -->
  // Serve al WebSocket per leggere i filtri correnti senza doversi ricollegare a ogni cambio di stato
  const filtersRef = useRef({ selectedCampuses, selectedCategories, token, currentView, currentPage });
  useEffect(() => {
    filtersRef.current = { selectedCampuses, selectedCategories, token, currentView, currentPage };
  }, [selectedCampuses, selectedCategories, token, currentView, currentPage]);

  useEffect(() => {
    const fetchFiltersData = async () => {
      if (!token) return;
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '';
        const [campusRes, categoryRes] = await Promise.all([
          fetch(`${baseUrl}/geozone/api/geozones/campuses`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${baseUrl}/asset/api/categories`, { headers: { Authorization: `Bearer ${token}` } })
        ]);
        
        if (campusRes.ok) setAvailableCampuses(await campusRes.json());
        if (categoryRes.ok) setAvailableCategories(await categoryRes.json());
      } catch (error) {
        console.error("Errore nel recupero dei filtri:", error);
      }
    };
    fetchFiltersData();
  }, [token]);

  const fetchLogs = async (page: number) => {
    if (!token) return;
    setIsLoading(true);
    setErrorMsg("");
    
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '20');
      params.append('log_type', currentView); // Passaggio del log_type al backend
      
      // I filtri si applicano solo se siamo nella vista operativa
      if (currentView === 'business') {
        if (selectedCampuses.length > 0) params.append('campus_id', selectedCampuses.join(','));
        if (selectedCategories.length > 0) params.append('category_id', selectedCategories.join(','));
      }

      const res = await fetch(`${baseUrl}/log/api/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Errore durante il caricamento dello storico.");
      }
      
      setLogs(data.logs || []);
      setTotalPages(data.total_pages || 1);
      setTotalItems(data.total_items || 0);
      setCurrentPage(data.current_page || 1);
      
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCampuses, selectedCategories, currentView]);

  useEffect(() => {
    fetchLogs(currentPage);
  }, [token, currentPage, selectedCampuses, selectedCategories, currentView]);

  // <-- AGGIUNTA: CONNESSIONE WEBSOCKET -->
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const socket = io(baseUrl, { transports: ['websocket', 'polling'] });

    socket.on('new_log_event', async (data) => {
      const { selectedCampuses: sc, selectedCategories: cat, token: t, currentView: cv, currentPage: cp } = filtersRef.current;
      if (!t) return;
      
      // Filtro intelligente: non disturbiamo il backend se l'evento non riguarda la vista corrente
      if (cv === 'system' && data.service !== 'auth-service') return;
      if (cv === 'business' && data.service === 'auth-service') return;

      const apiUrl = import.meta.env.VITE_API_URL || '';
      const params = new URLSearchParams();
      params.append('page', cp.toString());
      params.append('limit', '20');
      params.append('log_type', cv);
      
      if (cv === 'business') {
        if (sc.length > 0) params.append('campus_id', sc.join(','));
        if (cat.length > 0) params.append('category_id', cat.join(','));
      }

      try {
        const res = await fetch(`${apiUrl}/log/api/logs?${params.toString()}`, { 
          headers: { Authorization: `Bearer ${t}` } 
        });
        if (res.ok) {
          const resData = await res.json();
          setLogs(resData.logs || []);
          setTotalPages(resData.total_pages || 1);
          setTotalItems(resData.total_items || 0);
        }
      } catch (e) {
        console.error("Errore fetch background websocket:", e);
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  const handleExportCSV = async () => {
    if (logs.length === 0) {
      setExportWarning("Nessun log trovato, esportazione non disponibile.");
      setTimeout(() => setExportWarning(""), 4000);
      return;
    }

    setIsExporting(true);
    setErrorMsg("");
    setExportWarning("");

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const params = new URLSearchParams();
      params.append('log_type', currentView);

      if (currentView === 'business') {
        if (selectedCampuses.length > 0) params.append('campus_id', selectedCampuses.join(','));
        if (selectedCategories.length > 0) params.append('category_id', selectedCategories.join(','));
      }

      const res = await fetch(`${baseUrl}/log/api/logs/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Errore di generazione file. Si prega di riprovare.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filePrefix = currentView === 'system' ? 'Log_Sistema' : 'Audit_Operativo';
      a.download = `${filePrefix}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleCampus = (id: string) => {
    setSelectedCampuses(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) range.unshift("...");
    if (currentPage + delta < totalPages - 1) range.push("...");

    range.unshift(1);
    if (totalPages > 1) range.push(totalPages);

    return range;
  };

  return (
    <>
      <PageMeta
        title="Storico Operazioni | Asset Management Unisa"
        description="Consulta e scarica l'audit trail completo del sistema."
      />

      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Storico Operazioni
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Consulta la traccia cronologica e immutabile degli eventi di sistema.
          </p>
        </div>
        
        {/* GRUPPO CONTROLLI: TAB SWITCHER + EXPORT */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800 w-full sm:w-auto">
            <button
              onClick={() => setCurrentView('business')}
              className={`flex-1 sm:flex-none rounded-md px-6 py-2.5 text-sm font-bold transition-all ${
                currentView === 'business'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Log Operativi
            </button>
            <button
              onClick={() => setCurrentView('system')}
              className={`flex-1 sm:flex-none rounded-md px-6 py-2.5 text-sm font-bold transition-all ${
                currentView === 'system'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Log di Sistema
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            disabled={isLoading || isExporting}
            className={`w-full sm:w-auto inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              logs.length === 0 
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300 dark:bg-slate-700 dark:text-slate-400' 
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-blue-600 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white dark:hover:bg-slate-700'
            }`}
          >
            {isExporting ? (
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-solid border-blue-600 border-t-transparent"></div>
            ) : (
              <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {isExporting ? 'Generazione...' : 'Esporta CSV'}
          </button>
        </div>
      </div>

      {/* BLOCCO FILTRI - Mostrato SOLO per i log operativi */}
      {currentView === 'business' && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            
            {/* 1. FILTRO CAMPUS */}
            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Campus
              </label>
              <div 
                onClick={() => setIsCampusDropdownOpen(!isCampusDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCampuses.length === 0 
                    ? "Tutti i Campus" 
                    : selectedCampuses.length === 1 
                      ? availableCampuses.find(c => c.id === selectedCampuses[0])?.name || 'Campus Selezionato'
                      : `${selectedCampuses.length} Campus selezionati`}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCampusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCampusDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCampusDropdownOpen(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    <div 
                      className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                      onClick={() => { setSelectedCampuses([]); setIsCampusDropdownOpen(false); }}
                    >
                      <div className="w-4 mr-3 flex-none"></div>
                      Tutti i Campus
                    </div>
                    {availableCampuses.map((campus) => (
                      <label key={campus.id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedCampuses.includes(campus.id)}
                          onChange={() => toggleCampus(campus.id)}
                          className="mr-3 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 cursor-pointer"
                        />
                        <span className="truncate">{campus.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 2. FILTRO CATEGORIA */}
            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Categoria
              </label>
              <div 
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCategories.length === 0 
                    ? "Tutte le Categorie" 
                    : selectedCategories.length === 1 
                      ? availableCategories.find(c => c._id === selectedCategories[0])?.name || 'Categoria Selezionata'
                      : `${selectedCategories.length} Categorie selezionate`}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCategoryDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCategoryDropdownOpen(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    <div 
                      className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                      onClick={() => { setSelectedCategories([]); setIsCategoryDropdownOpen(false); }}
                    >
                      <div className="w-4 mr-3 flex-none"></div>
                      Tutte le Categorie
                    </div>
                    {availableCategories.map((category) => (
                      <label key={category._id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(category._id)}
                          onChange={() => toggleCategory(category._id)}
                          className="mr-3 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 cursor-pointer"
                        />
                        <span className="truncate">{category.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-4 text-rose-800 shadow-sm">
          <p className="font-semibold">{errorMsg}</p>
        </div>
      )}
      {exportWarning && (
        <div className="mb-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-amber-800 shadow-sm transition-opacity">
          <p className="font-semibold">{exportWarning}</p>
        </div>
      )}

      {/* Tabella Dati */}
      <LogsTable logs={logs} isLoading={isLoading} viewType={currentView} />

      {/* Controlli Paginazione */}
      {!isLoading && totalPages > 1 && (
        <div className="mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row bg-white p-4 rounded-xl shadow-sm border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Mostrando pagina <span className="font-bold text-slate-800 dark:text-white">{currentPage}</span> di {totalPages} 
            <span className="ml-2 text-xs">({totalItems} record totali)</span>
          </span>
          <div className="flex gap-1.5 items-center">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>

            {getPageNumbers().map((num, idx) => (
              num === "..." ? (
                <span key={`dots-${idx}`} className="px-2 py-1 text-slate-400 font-bold">...</span>
              ) : (
                <button
                  key={num}
                  onClick={() => setCurrentPage(num as number)}
                  className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                    currentPage === num
                      ? "bg-blue-600 text-white shadow-sm border border-blue-600"
                      : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700"
                  }`}
                >
                  {num}
                </button>
              )
            ))}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            >
               <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}