import { useEffect, useState, useRef } from "react";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { io } from "socket.io-client"; // <-- AGGIUNTA: Import WebSocket

// Componenti
import AssetMetrics from "../../components/dashboard/AssetMetrics";
import CategoryDistributionChart from "../../components/dashboard/CategoryDistributionChart";
import TimeSeriesChart from "../../components/dashboard/TimeSeriesChart";
import CampusDistributionChart from "../../components/dashboard/CampusDistributionChart";

interface Campus {
  id: string;
  name: string;
}

interface Category {
  _id: string;
  name: string;
}

export default function Home() {
  const { token, user } = useAuth();
  
  // Stati per la selezione multipla
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>([]);
  const [isCampusDropdownOpen, setIsCampusDropdownOpen] = useState(false);
  
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  
  const [availableCampuses, setAvailableCampuses] = useState<Campus[]>([]);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  
  const [metrics, setMetrics] = useState<any>(null);
  const [charts, setCharts] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // <-- AGGIUNTA: REF PER I FILTRI WEBSOCKET -->
  const filtersRef = useRef({ selectedCampuses, selectedCategories, token });
  useEffect(() => {
    filtersRef.current = { selectedCampuses, selectedCategories, token };
  }, [selectedCampuses, selectedCategories, token]);

  const displayFirstName = user?.first_name || (user?.name ? user.name.split(' ')[0] : '');
  const greeting = "Benvenuta";

  // Caricamento dei filtri disponibili (Campus e Categorie)
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

  // Caricamento dei dati della dashboard in base ai filtri selezionati
  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!token) return; 

      try {
        setIsLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const baseUrl = import.meta.env.VITE_API_URL || '';

        const baseParams = new URLSearchParams();
        if (selectedCampuses.length > 0) baseParams.append('campus_id', selectedCampuses.join(','));
        if (selectedCategories.length > 0) baseParams.append('category_id', selectedCategories.join(','));

        const [metricsRes, chartsRes] = await Promise.all([
          fetch(`${baseUrl}/log/api/dashboard/metrics?${baseParams.toString()}`, { headers }),
          fetch(`${baseUrl}/log/api/dashboard/charts?${baseParams.toString()}`, { headers })
        ]);

        if (metricsRes.ok) setMetrics(await metricsRes.json());
        if (chartsRes.ok) setCharts(await chartsRes.json());
      } catch (error) {
        console.error("Errore nel caricamento della dashboard:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [token, selectedCampuses, selectedCategories]);

  // <-- AGGIUNTA: CONNESSIONE WEBSOCKET (Fetch Silenzioso) -->
  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const socket = io(baseUrl, { 
      path: '/api/log/socket.io',
      transports: ['polling'] });

    socket.on('new_log_event', async () => {
      const { selectedCampuses: sc, selectedCategories: cat, token: t } = filtersRef.current;
      if (!t) return;

      const apiUrl = import.meta.env.VITE_API_URL || '';
      const baseParams = new URLSearchParams();
      if (sc.length > 0) baseParams.append('campus_id', sc.join(','));
      if (cat.length > 0) baseParams.append('category_id', cat.join(','));

      try {
        const [metricsRes, chartsRes] = await Promise.all([
          fetch(`${apiUrl}/log/api/dashboard/metrics?${baseParams.toString()}`, { headers: { Authorization: `Bearer ${t}` } }),
          fetch(`${apiUrl}/log/api/dashboard/charts?${baseParams.toString()}`, { headers: { Authorization: `Bearer ${t}` } })
        ]);
        if (metricsRes.ok) setMetrics(await metricsRes.json());
        if (chartsRes.ok) setCharts(await chartsRes.json());
      } catch (e) {
        console.error("Errore fetch background websocket:", e);
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  // Gestione dinamica delle checkbox
  const toggleCampus = (id: string) => {
    setSelectedCampuses(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  return (
    <>
      <PageMeta
        title="Dashboard Amministratore | Asset Management"
        description="Pannello di controllo riepilogativo per la gestione degli asset."
      />
      
      {/* HEADER */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {greeting}, {displayFirstName || 'Amministratore'}!
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            Ecco una panoramica aggiornata in tempo reale sullo stato dei tuoi campus.
          </p>
        </div>
      </div>

      {/* BLOCCO FILTRI (DUE COLONNE AFFIANCATE) */}
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

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6 items-stretch">
          
          <div className="col-span-12">
            <AssetMetrics totals={metrics?.totals} />
          </div>

          <div className="col-span-12 xl:col-span-8 flex flex-col">
            <TimeSeriesChart timeSeries={charts?.time_series} />
          </div>
          
          {/* Se viene selezionata UNA SOLA categoria, il grafico a torta mostrerà ovviamente il 100% di quella, ma lo lasciamo visibile per coerenza di layout */}
          <div className="col-span-12 xl:col-span-4 flex flex-col">
            <CategoryDistributionChart distributionData={metrics?.distributions?.by_category} />
          </div>

          {/* Mostra il grafico di distribuzione SOLO se ci sono più campus o se la visione è globale */}
          {selectedCampuses.length !== 1 && (
            <div className="col-span-12 flex flex-col">
              <CampusDistributionChart distributionData={metrics?.distributions?.by_campus} />
            </div>
          )}

        </div>
      )}
    </>
  );
}