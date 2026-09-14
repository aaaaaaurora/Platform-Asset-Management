import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface CategoryAttribute {
  name: string;
  type: string;
  required: boolean;
  filterable: boolean;
  options?: string[];
  status: string; 
}

interface Category {
  _id: string;
  name: string;
  attributes: CategoryAttribute[];
}

interface Campus {
  id: string;
  name: string;
}

interface Asset {
  _id: string;
  category_id: string;
  campus_id: string;
  geometry: { type: string; coordinates: [number, number] };
  metadata: Record<string, any>;
  media_ids?: string[];
  status: string;
  created_at: string;
}

export default function AssetList() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  const isAdmin = user?.role === 'AMMINISTRATORE';

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);

  // --- STATI ESPORTAZIONE CSV ---
  const [isExporting, setIsExporting] = useState(false);

  // --- STATI PER I FILTRI OPERATORE (Selezione Multipla Campus) ---
  const [selectedCampusesOp, setSelectedCampusesOp] = useState<string[]>([]);
  const [isCampusDropdownOpenOp, setIsCampusDropdownOpenOp] = useState(false);

  // --- STATI PER I FILTRI AMMINISTRATORE (Selezione Multipla) ---
  const [selectedCampusesAdmin, setSelectedCampusesAdmin] = useState<string[]>([]);
  const [selectedCategoriesAdmin, setSelectedCategoriesAdmin] = useState<string[]>([]);
  const [isCampusDropdownOpen, setIsCampusDropdownOpen] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  // --- STATI PER FILTRI DINAMICI ---
  const [dynamicFilters, setDynamicFilters] = useState<Record<string, string>>({});

  // --- STATI PAGINAZIONE ---
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [formData, setFormData] = useState<{ lat: number; lng: number; metadata: Record<string, any>; media_ids: string[] }>({ lat: 0, lng: 0, metadata: {}, media_ids: [] });
  
  const [preventiveNote, setPreventiveNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [pendingUploads, setPendingUploads] = useState<{file: File, preview: string}[]>([]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  // Caricamento Dati Statici
  useEffect(() => {
    const fetchStaticData = async () => {
      if (!token) return;
      try {
        const catRes = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/categories`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (catRes.ok) setCategories(await catRes.json());

        const campRes = await fetch(`${import.meta.env.VITE_API_URL}/geozone/api/geozones/campuses`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (campRes.ok) {
          const userAllowedCampuses = await campRes.json();
          setCampuses(userAllowedCampuses);
        }
      } catch (error) {
        console.error("Errore nel recupero dati statici:", error);
      }
    };
    fetchStaticData();
  }, [token]);

  // Caricamento Assets in base ai Filtri
  const fetchAssets = async (page: number) => {
    if (!token) return;
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '50');
      
      if (isAdmin) {
        if (selectedCampusesAdmin.length > 0) {
          params.append('campus_id', selectedCampusesAdmin.join(','));
        }
        if (selectedCategoriesAdmin.length > 0) {
          params.append('category_id', selectedCategoriesAdmin.join(','));
        }
      } else {
        if (selectedCampusesOp.length > 0) {
          params.append('campus_id', selectedCampusesOp.join(','));
        }
        if (user?.category_id) params.append('category_id', user.category_id);
      }
      
      Object.entries(dynamicFilters).forEach(([key, value]) => {
        if (value) params.append(`attr_${key}`, value);
      });

      const url = `${import.meta.env.VITE_API_URL}/asset/api/assets?${params.toString()}`;
      
      const assetRes = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (assetRes.ok) {
        const assetData = await assetRes.json();
        let fetchedAssets = assetData.assets || [];

        if (!isAdmin && user?.category_id) {
          fetchedAssets = fetchedAssets.filter((a: Asset) => a.category_id === user.category_id);
        }

        setAssets(fetchedAssets);
        setTotalPages(assetData.pagination?.total_pages || 1);
        setTotalItems(assetData.pagination?.total_count || 0);
        setCurrentPage(assetData.pagination?.page || 1);
      }
    } catch (error) {
      console.error("Errore nel recupero asset:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCampusesOp, selectedCampusesAdmin, selectedCategoriesAdmin, dynamicFilters]);

  useEffect(() => {
    fetchAssets(currentPage);
  }, [token, currentPage, selectedCampusesOp, selectedCampusesAdmin, selectedCategoriesAdmin, dynamicFilters, user, isAdmin]);

  useEffect(() => {
    setDynamicFilters({});
  }, [selectedCategoriesAdmin]);

  useEffect(() => {
    if (location.state?.editCampusId) {
      if (isAdmin) {
        if (!selectedCampusesAdmin.includes(location.state.editCampusId)) {
          setSelectedCampusesAdmin([location.state.editCampusId]);
        }
      } else {
        if (!selectedCampusesOp.includes(location.state.editCampusId)) {
          setSelectedCampusesOp([location.state.editCampusId]);
        }
      }
    }
  }, [location.state, isAdmin]);

  // LOGICA MODIFICATA: Ricezione dell'asset intero passato dalla mappa
  useEffect(() => {
    const editAssetId = location.state?.editAssetId;
    const fullAsset = location.state?.fullAsset; // Asset completo recuperato dallo state

    if (editAssetId) {
      // Priorità all'asset intero passato dalla mappa, altrimenti cerca nella pagina corrente
      const assetToEdit = fullAsset || assets.find(a => a._id === editAssetId);
      
      if (assetToEdit) {
        openEditModal(assetToEdit);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [assets, location.state, navigate, location.pathname]);

  const toggleCampusAdmin = (id: string) => {
    setSelectedCampusesAdmin(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const toggleCategoryAdmin = (id: string) => {
    setSelectedCategoriesAdmin(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const toggleCampusOp = (id: string) => {
    setSelectedCampusesOp(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const handleDynamicFilterChange = (attrName: string, value: string) => {
    setDynamicFilters(prev => ({ ...prev, [attrName]: value }));
  };

  const getCategoryName = (categoryId: string) => {
    const cat = categories.find(c => c._id === categoryId);
    return cat ? cat.name : categoryId;
  };

  const openEditModal = (asset: Asset) => {
    setSelectedAsset(asset);
    setFormData({
      lng: asset.geometry.coordinates[0],
      lat: asset.geometry.coordinates[1],
      metadata: { ...asset.metadata },
      media_ids: asset.media_ids ? [...asset.media_ids] : []
    });
    setPendingDeletes([]);
    setPendingUploads([]);
    setPreventiveNote('');
  };

  const handleMetadataChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, metadata: { ...prev.metadata, [key]: value } }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingUploads(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
  };

  const handleDeleteExistingImage = (mediaId: string) => {
    setPendingDeletes(prev => [...prev, mediaId]);
    setFormData(prev => ({ ...prev, media_ids: prev.media_ids.filter(id => id !== mediaId) }));
  };

  const handleDeletePendingImage = (index: number) => {
    setPendingUploads(prev => prev.filter((_, i) => i !== index));
  };

  const closeModal = () => {
    setSelectedAsset(null);
    setPendingUploads([]);
    setPendingDeletes([]);
    setShowDeleteConfirm(false); 
    setPreventiveNote('');
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

  const handleExportCSV = async () => {
    if (assets.length === 0) {
      showNotification('error', "Nessun asset trovato. Regola i filtri prima di esportare.");
      return;
    }

    setIsExporting(true);

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const params = new URLSearchParams();

      if (selectedCampusesAdmin.length > 0) {
        params.append('campus_id', selectedCampusesAdmin.join(','));
      }
      if (selectedCategoriesAdmin.length > 0) {
        params.append('category_id', selectedCategoriesAdmin.join(','));
      }
      
      Object.entries(dynamicFilters).forEach(([key, value]) => {
        if (value) params.append(`attr_${key}`, value);
      });

      const res = await fetch(`${baseUrl}/asset/api/assets/export?${params.toString()}`, {
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
      a.download = `Lista_Assets_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedAsset || isAdmin) return;
    setIsProcessing(true);

    try {
      if (preventiveNote.trim()) {
        const noteRes = await fetch(`${import.meta.env.VITE_API_URL}/warning/maintenances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ asset_id: selectedAsset._id, tipo_intervento: 'preventiva', nota_intervento: preventiveNote.trim() })
        });
        if (!noteRes.ok) throw new Error("Errore durante la registrazione della nota di intervento.");
      }

      if (hasChanges) {
        if (pendingDeletes.length > 0) {
          await Promise.all(pendingDeletes.map(mediaId => 
            fetch(`${import.meta.env.VITE_API_URL}/media/images/${mediaId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
          ));
        }

        const newUploadedIds: string[] = [];
        for (const item of pendingUploads) {
          const uploadPayload = new FormData();
          uploadPayload.append('images', item.file);

          const res = await fetch(`${import.meta.env.VITE_API_URL}/media/images/upload`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: uploadPayload
          });

          if (!res.ok) throw new Error("Errore durante l'upload delle nuove immagini");
          const data = await res.json();
          newUploadedIds.push(data.uploaded[0].media_id);
        }

        const finalMediaIds = [...formData.media_ids, ...newUploadedIds];
        const payload = {
          geometry: { type: 'Point', coordinates: [formData.lng, formData.lat] },
          metadata: formData.metadata,
          media_ids: finalMediaIds 
        };

        const res = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/assets/${selectedAsset._id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Errore durante l'aggiornamento dell'asset");
        }
      }

      showNotification('success', "Aggiornamento completato con successo!");
      closeModal();
      fetchAssets(currentPage); 
    } catch (error: any) {
      showNotification('error', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!selectedAsset) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/assets/${selectedAsset._id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Errore durante l'eliminazione");
      
      showNotification('success', "Asset eliminato con successo!");
      setShowDeleteConfirm(false);
      closeModal();
      fetchAssets(currentPage);
    } catch (error: any) {
      showNotification('error', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const activeCategoryIdForFilters = isAdmin 
    ? (selectedCategoriesAdmin.length === 1 ? selectedCategoriesAdmin[0] : null)
    : user?.category_id;

  const filterableAttributes = activeCategoryIdForFilters 
    ? categories.find(c => c._id === activeCategoryIdForFilters)?.attributes.filter(attr => attr.filterable && attr.status !== 'unavailable') || []
    : [];

  const activeCategory = selectedAsset ? categories.find(c => c._id === selectedAsset.category_id) : null;
  const hasChanges = selectedAsset ? (
    pendingUploads.length > 0 || pendingDeletes.length > 0 || formData.lat !== selectedAsset.geometry.coordinates[1] || formData.lng !== selectedAsset.geometry.coordinates[0] ||
    JSON.stringify(formData.metadata) !== JSON.stringify(selectedAsset.metadata)
  ) : false;

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Lista Assets Censiti
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cerca, filtra e gestisci gli elementi registrati nei campus.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={handleExportCSV}
            disabled={loading || isExporting}
            className={`w-full sm:w-auto inline-flex items-center justify-center rounded-lg px-6 py-2.5 text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              assets.length === 0 
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
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        
        {isAdmin ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Campus
              </label>
              <div 
                onClick={() => setIsCampusDropdownOpen(!isCampusDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCampusesAdmin.length === 0 
                    ? "Tutti i Campus" 
                    : selectedCampusesAdmin.length === 1 
                      ? campuses.find(c => c.id === selectedCampusesAdmin[0])?.name || 'Campus Selezionato'
                      : `${selectedCampusesAdmin.length} Campus selezionati`}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCampusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCampusDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCampusDropdownOpen(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    <div 
                      className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                      onClick={() => { setSelectedCampusesAdmin([]); setIsCampusDropdownOpen(false); }}
                    >
                      <div className="w-4 mr-3 flex-none"></div>
                      Tutti i Campus
                    </div>
                    {campuses.map((campus) => (
                      <label key={campus.id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedCampusesAdmin.includes(campus.id)}
                          onChange={() => toggleCampusAdmin(campus.id)}
                          className="mr-3 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 cursor-pointer"
                        />
                        <span className="truncate">{campus.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Categoria
              </label>
              <div 
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCategoriesAdmin.length === 0 
                    ? "Tutte le Categorie" 
                    : selectedCategoriesAdmin.length === 1 
                      ? categories.find(c => c._id === selectedCategoriesAdmin[0])?.name || 'Categoria Selezionata'
                      : `${selectedCategoriesAdmin.length} Categorie selezionate`}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCategoryDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCategoryDropdownOpen(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    <div 
                      className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                      onClick={() => { setSelectedCategoriesAdmin([]); setIsCategoryDropdownOpen(false); }}
                    >
                      <div className="w-4 mr-3 flex-none"></div>
                      Tutte le Categorie
                    </div>
                    {categories.map((category) => (
                      <label key={category._id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedCategoriesAdmin.includes(category._id)}
                          onChange={() => toggleCategoryAdmin(category._id)}
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Campus
              </label>
              <div 
                onClick={() => setIsCampusDropdownOpenOp(!isCampusDropdownOpenOp)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCampusesOp.length === 0 
                    ? "Tutti i Campus" 
                    : selectedCampusesOp.length === 1 
                      ? campuses.find(c => c.id === selectedCampusesOp[0])?.name || 'Campus Selezionato'
                      : `${selectedCampusesOp.length} Campus selezionati`}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCampusDropdownOpenOp ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCampusDropdownOpenOp && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCampusDropdownOpenOp(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    <div 
                      className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                      onClick={() => { setSelectedCampusesOp([]); setIsCampusDropdownOpenOp(false); }}
                    >
                      <div className="w-4 mr-3 flex-none"></div>
                      Tutti i Campus
                    </div>
                    {campuses.map((campus) => (
                      <label key={campus.id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <input
                          type="checkbox"
                          checked={selectedCampusesOp.includes(campus.id)}
                          onChange={() => toggleCampusOp(campus.id)}
                          className="mr-3 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 cursor-pointer"
                        />
                        <span className="truncate">{campus.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {filterableAttributes.length > 0 && (
          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-end gap-4">
            {filterableAttributes.map(attr => (
              <div key={attr.name} className="w-full sm:w-[200px]">
                <label className="mb-1.5 block text-[11px] font-bold text-slate-500 dark:text-slate-400 capitalize tracking-wide truncate">
                  {attr.name.replace('_', ' ')}
                </label>
                
                {attr.type === 'enum' ? (
                  <select 
                    value={dynamicFilters[attr.name] || ''}
                    onChange={(e) => handleDynamicFilterChange(attr.name, e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                  >
                    <option value="">Tutti</option>
                    {attr.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : attr.type === 'boolean' ? (
                   <select 
                    value={dynamicFilters[attr.name] || ''}
                    onChange={(e) => handleDynamicFilterChange(attr.name, e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                  >
                    <option value="">Tutti</option>
                    <option value="true">Sì</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input 
                    type={attr.type === 'number' ? 'number' : 'text'}
                    value={dynamicFilters[attr.name] || ''}
                    onChange={(e) => handleDynamicFilterChange(attr.name, e.target.value)}
                    placeholder="Cerca..."
                    className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
              <tr>
                <th className="py-3 px-6 font-semibold uppercase tracking-wider text-xs">Categoria</th>
                <th className="py-3 px-6 font-semibold uppercase tracking-wider text-xs">ID Seriale</th>
                <th className="py-3 px-6 font-semibold uppercase tracking-wider text-xs">Data Creazione</th>
                <th className="py-3 px-6 font-semibold uppercase tracking-wider text-xs text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center">
                    <div className="flex justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-solid border-blue-600 border-t-transparent"></div></div>
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center font-medium text-slate-500">
                    La ricerca non ha prodotto alcun risultato.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr key={asset._id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="py-3 px-6 font-bold text-slate-800 dark:text-slate-200 uppercase">
                      {getCategoryName(asset.category_id)}
                    </td>
                    <td className="py-3 px-6 font-mono text-slate-500 dark:text-slate-400 text-xs">
                      {asset._id}
                    </td>
                    <td className="py-3 px-6">
                      {new Date(asset.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button 
                        onClick={() => openEditModal(asset)} 
                        className="inline-flex items-center justify-center rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-100 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                      >
                        {isAdmin ? 'Visualizza' : 'Gestisci'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && totalPages > 1 && (
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

      {selectedAsset && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto transform transition-all">
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-slate-700 pb-4">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                {isAdmin ? 'Dettagli Asset' : 'Gestione Asset'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold transition-colors">✕</button>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">
                {isAdmin ? 'Foto dell\'Asset' : 'Gestione Foto'}
              </h4>
              <div className="flex gap-3 overflow-x-auto pb-2">
                
                {formData.media_ids.map(mediaId => (
                  <div key={mediaId} className="relative min-w-[120px] h-28 flex-shrink-0 group">
                    <img 
                      src={`${import.meta.env.VITE_API_URL}/media/images/${mediaId}`} 
                      className="w-full h-full object-cover rounded-lg border border-slate-200 dark:border-slate-600"
                      alt="Asset Media" 
                    />
                    {!isAdmin && (
                      <button 
                        onClick={() => handleDeleteExistingImage(mediaId)} 
                        className="absolute top-1.5 right-1.5 bg-rose-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm shadow-md hover:bg-rose-700 transition opacity-0 group-hover:opacity-100"
                        title="Elimina foto"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                
                {!isAdmin && pendingUploads.map((item, index) => (
                  <div key={`new-${index}`} className="relative min-w-[120px] h-28 flex-shrink-0">
                    <img 
                      src={item.preview} 
                      className="w-full h-full object-cover rounded-lg border-2 border-emerald-500 opacity-90"
                      alt="New Upload" 
                    />
                    <button 
                      onClick={() => handleDeletePendingImage(index)} 
                      className="absolute top-1.5 right-1.5 bg-rose-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm shadow-md hover:bg-rose-700 transition"
                      title="Annulla inserimento"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {!isAdmin && (
                  <label className="min-w-[120px] h-28 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                    <span className="text-2xl text-slate-400">+</span>
                    <span className="text-[11px] font-medium text-slate-500 mt-1">Carica Foto</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isProcessing} />
                  </label>
                )}
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Coordinate Geografiche</h4>
              <div className="flex gap-4">
                <div className="w-1/2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">Latitudine</label>
                  <input 
                    type="number" step="any" 
                    value={formData.lat} 
                    disabled={isAdmin}
                    onChange={e => setFormData(p => ({...p, lat: parseFloat(e.target.value)}))} 
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900" 
                  />
                </div>
                <div className="w-1/2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">Longitudine</label>
                  <input 
                    type="number" step="any" 
                    value={formData.lng} 
                    disabled={isAdmin}
                    onChange={e => setFormData(p => ({...p, lng: parseFloat(e.target.value)}))} 
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900" 
                  />
                </div>
              </div>
            </div>

            <div className="mb-4">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Metadati Categoria</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeCategory ? (
                  activeCategory.attributes.filter(attr => attr.status !== 'unavailable').map(attr => (
                    <div key={attr.name}>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400 capitalize">
                        {attr.name.replace('_', ' ')} {attr.required && <span className="text-rose-500">*</span>}
                      </label>
                      
                      {attr.type === 'enum' ? (
                        <select 
                          value={formData.metadata[attr.name] || ''} 
                          disabled={isAdmin}
                          onChange={(e) => handleMetadataChange(attr.name, e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900"
                        >
                          <option value="">Seleziona...</option>
                          {attr.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input 
                          type={attr.type === 'number' ? 'number' : 'text'} 
                          value={formData.metadata[attr.name] || ''} 
                          disabled={isAdmin}
                          onChange={e => handleMetadataChange(attr.name, attr.type === 'number' ? parseFloat(e.target.value) : e.target.value)} 
                          className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900" 
                        />
                      )}
                    </div>
                  ))
                  ) : (
                    Object.keys(formData.metadata)
                      .filter(key => {
                        const isDeprecated = categories.some(cat => 
                          cat.attributes.some(attr => attr.name === key && attr.status === 'unavailable')
                        );
                        return !isDeprecated;
                      })
                      .map(key => (
                      <div key={key}>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400 capitalize">{key.replace('_', ' ')}</label>
                        <input 
                          type="text" 
                          value={formData.metadata[key]} 
                          disabled={isAdmin}
                          onChange={e => handleMetadataChange(key, e.target.value)} 
                          className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900" 
                        />
                      </div>
                    ))
                  )}
              </div>
            </div>

            {!isAdmin && (
              <div className="mb-6 border-t border-slate-100 dark:border-slate-700 pt-5 mt-4">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-2">
                  Nota di Intervento Preventivo <span className="text-rose-500">*</span>
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  La nota è obbligatoria per giustificare eventuali modifiche agli attributi o per registrare un controllo periodico effettuato all'asset.
                </p>
                <textarea 
                  rows={3} 
                  value={preventiveNote} 
                  onChange={(e) => setPreventiveNote(e.target.value)} 
                  placeholder="Descrivi l'intervento preventivo effettuato o il motivo della modifica all'asset..."
                  className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800" 
                />
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row justify-between items-center border-t border-slate-100 dark:border-slate-700 pt-5 mt-2 gap-4">
              {isAdmin ? (
                <>
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isProcessing}
                    className="w-full sm:w-auto inline-flex items-center justify-center text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 font-semibold text-xs uppercase transition-colors disabled:opacity-50"
                  >
                    <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    {isProcessing ? 'Elaborazione...' : 'Elimina Asset'}
                  </button>
                  <div className="flex w-full sm:w-auto justify-end">
                    <button 
                      onClick={closeModal} 
                      disabled={isProcessing}
                      className="rounded-lg px-6 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
                    >
                      Chiudi
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isProcessing}
                    className="w-full sm:w-auto inline-flex items-center justify-center text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 font-semibold text-xs uppercase transition-colors disabled:opacity-50"
                  >
                    <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    {isProcessing ? 'Elaborazione...' : 'Elimina Asset'}
                  </button>
                  
                  <div className="flex w-full sm:w-auto gap-3">
                    <button 
                      onClick={closeModal} 
                      disabled={isProcessing} 
                      className="flex-1 sm:flex-none rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                      Annulla
                    </button>
                    <button 
                      onClick={handleUpdate} 
                      disabled={isProcessing || !preventiveNote.trim()} 
                      className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                    >
                      {isProcessing ? 'Salvataggio...' : 'Salva Modifiche'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>, document.body
      )}

      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transform transition-all">
            
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Conferma Eliminazione</h3>
            </div>
            
            <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
              Sei sicuro di voler eliminare questo asset? Verrà conservato nello storico ma rimosso dalla mappa. Questa azione non può essere annullata.
            </p>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isProcessing}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
              >
                Annulla
              </button>
              <button 
                onClick={confirmDelete}
                disabled={isProcessing}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-rose-500 focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {isProcessing ? 'Eliminazione...' : 'Sì, Elimina'}
              </button>
            </div>

          </div>
        </div>, document.body
      )}

      {notification && createPortal(
        <div className="fixed top-5 right-5 z-[10001] animate-fade-in-up">
          <div className={`flex items-center gap-3 rounded-lg px-5 py-3 shadow-xl text-white ${notification.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
            {notification.type === 'success' ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="font-semibold text-sm">{notification.message}</span>
            <button 
              onClick={() => setNotification(null)} 
              className="ml-2 font-bold text-white/80 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>,
        document.body
      )}

    </>
  );
}