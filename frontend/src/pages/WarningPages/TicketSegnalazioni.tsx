import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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

interface Ticket {
  id: string;
  asset_id: string;
  category_id: string; 
  descrizione: string;
  status: 'aperta' | 'chiusa';
  campus_id: string;
  created_at: string;
}

interface Campus {
  id: string;
  name: string;
}

export default function TicketSegnalazioni() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'AMMINISTRATORE';
  
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedCampus, setSelectedCampus] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  
  // -- STATI PER IL CARICAMENTO E LA MODIFICA DELL'ASSET COLLEGATO --
  const [linkedAsset, setLinkedAsset] = useState<Asset | null>(null);
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [formData, setFormData] = useState<{ lat: number; lng: number; metadata: Record<string, any>; media_ids: string[] }>({ lat: 0, lng: 0, metadata: {}, media_ids: [] });
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [pendingUploads, setPendingUploads] = useState<{file: File, preview: string}[]>([]);

  const [notaIntervento, setNotaIntervento] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  useEffect(() => {
    const fetchStaticData = async () => {
      try {
        const [campRes, catRes] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_URL}/geozone/api/geozones/campuses`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`${import.meta.env.VITE_API_URL}/asset/api/categories`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        
        if (campRes.ok) setCampuses(await campRes.json());
        if (catRes.ok) setCategories(await catRes.json());
      } catch (error) {
        console.error("Errore nel recupero dati statici:", error);
      }
    };

    if (token) fetchStaticData();
  }, [token]);

  useEffect(() => {
    fetchTickets();
  }, [token, selectedCampus, selectedCategory, selectedStatus, user]);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (selectedCampus) params.append('campus_id', selectedCampus);
      if (selectedStatus) params.append('status', selectedStatus);
      
      if (user?.role === 'OPERATORE' && user?.category_id) {
        params.append('category_id', user.category_id);
      } else if (selectedCategory) {
        params.append('category_id', selectedCategory);
      }

      const url = `${import.meta.env.VITE_API_URL}/warning/warnings${params.toString() ? `?${params.toString()}` : ''}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Errore nel recupero dei ticket');
      const data = await response.json();
      
      let fetchedTickets = data;

      if (user?.role === 'OPERATORE' && user?.category_id) {
        fetchedTickets = fetchedTickets.filter((t: Ticket) => t.category_id === user.category_id);
      }

      setTickets(fetchedTickets);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Funzione chiamata quando si clicca su "Gestisci"
  const handleOpenTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setNotaIntervento('');
    setLoadingAsset(true);
    setPendingUploads([]);
    setPendingDeletes([]);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/assets/${ticket.asset_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        throw new Error('Impossibile caricare i dati dell\'asset collegato.');
      }
      
      const assetData: Asset = await response.json();
      setLinkedAsset(assetData);
      setFormData({
        lng: assetData.geometry.coordinates[0],
        lat: assetData.geometry.coordinates[1],
        metadata: { ...assetData.metadata },
        media_ids: assetData.media_ids ? [...assetData.media_ids] : []
      });
    } catch (error: any) {
      setNotification({ type: 'error', message: error.message });
      setLinkedAsset(null);
    } finally {
      setLoadingAsset(false);
    }
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

  const handleResolve = async () => {
    if (!selectedTicket || !notaIntervento.trim() || !linkedAsset) return;
    setIsResolving(true);

    try {
      // 1. Verifichiamo se ci sono state modifiche sull'asset rispetto al suo stato originale
      const hasChanges = (
        pendingUploads.length > 0 || 
        pendingDeletes.length > 0 || 
        formData.lat !== linkedAsset.geometry.coordinates[1] || 
        formData.lng !== linkedAsset.geometry.coordinates[0] ||
        JSON.stringify(formData.metadata) !== JSON.stringify(linkedAsset.metadata)
      );

      // Se ci sono modifiche fisiche all'asset, eseguiamo prima il suo aggiornamento
      if (hasChanges && user?.role === 'OPERATORE') {
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

          if (!res.ok) throw new Error("Errore durante l'upload delle nuove immagini dell'asset");
          const data = await res.json();
          newUploadedIds.push(data.uploaded[0].media_id);
        }

        const finalMediaIds = [...formData.media_ids, ...newUploadedIds];
        const payloadAsset = {
          geometry: { type: 'Point', coordinates: [formData.lng, formData.lat] },
          metadata: formData.metadata,
          media_ids: finalMediaIds 
        };

        const resAsset = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/assets/${linkedAsset._id}`, {
          method: 'PUT', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
          body: JSON.stringify(payloadAsset)
        });

        if (!resAsset.ok) {
          const err = await resAsset.json();
          throw new Error(err.error || "Errore durante l'aggiornamento dell'asset correlato al ticket");
        }
      }

      // 2. Risoluzione e Chiusura del Ticket nel Warning Service
      const responseWarning = await fetch(`${import.meta.env.VITE_API_URL}/warning/warnings/${selectedTicket.id}/resolve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        // In questo flusso stiamo risolvendo un problema, quindi usiamo la nota_intervento passata come testo correttivo
        body: JSON.stringify({ nota_intervento: notaIntervento.trim() })
      });

      if (!responseWarning.ok) throw new Error('Errore durante la chiusura del ticket nel sistema di segnalazioni');

      // 3. Registrazione esplicita nel Log delle manutenzioni (tipo correttiva, dato che scaturisce da un warning)
      const noteRes = await fetch(`${import.meta.env.VITE_API_URL}/warning/maintenances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ asset_id: selectedTicket.asset_id, tipo_intervento: 'correttiva', nota_intervento: notaIntervento.trim() })
      });
      
      if (!noteRes.ok) {
         console.warn("Il ticket è stato chiuso, ma la generazione del log di manutenzione è fallita.");
      }

      setTickets(prev => prev.map(t => 
        t.id === selectedTicket.id ? { ...t, status: 'chiusa' } : t
      ));
      
      closeModal();
      setNotification({ type: 'success', message: 'Intervento correttivo registrato e ticket chiuso con successo!' });
    } catch (error: any) {
      setNotification({ type: 'error', message: error.message });
    } finally {
      setIsResolving(false);
    }
  };

  const closeModal = () => {
    setSelectedTicket(null);
    setNotaIntervento('');
    setLinkedAsset(null);
  };
  
  const activeCategory = linkedAsset ? categories.find(c => c._id === linkedAsset.category_id) : null;

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Segnalazioni
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Gestisci i ticket aperti e visualizza lo storico degli interventi registrati.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Filtro Campus</label>
            <select 
              value={selectedCampus}
              onChange={(e) => setSelectedCampus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
            >
              <option value="">Tutti i Campus</option>
              {campuses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {user?.role !== 'OPERATORE' && (
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Filtro Categoria</label>
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
              >
                <option value="">Tutte le Categorie</option>
                {categories.map(c => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Stato segnalazione</label>
            <select 
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
            >
              <option value="">Tutti gli Stati</option>
              <option value="aperta">Solo Aperte</option>
              <option value="chiusa">Solo Chiuse</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
              <tr>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Data</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Descrizione Problema</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs text-center">Stato</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs text-center">Posizione</th>
                <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-blue-600 border-t-transparent"></div></div>
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center font-medium text-slate-500">
                    Nessuna segnalazione trovata.
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => {
                  const canManage = user?.role === 'OPERATORE' && user?.category_id === ticket.category_id;

                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="py-4 px-6">
                        <p className="font-bold text-slate-800 dark:text-slate-200">{new Date(ticket.created_at).toLocaleDateString('it-IT')}</p>
                        <p className="text-xs font-medium text-slate-500">{new Date(ticket.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute:'2-digit' })}</p>
                      </td>
                      <td className="py-4 px-6">
                        <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-xs" title={ticket.descrizione}>{ticket.descrizione}</p>
                        <p className="text-xs text-slate-500 mt-1 font-mono">Asset: {ticket.asset_id.substring(0, 8)}...</p>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${ticket.status === 'aperta' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          onClick={() => navigate('/map', { state: { focusAssetId: ticket.asset_id, focusCampusId: ticket.campus_id } })}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                          📍 Mappa
                        </button>
                      </td>
                      <td className="py-4 px-6 text-right">
                        {ticket.status === 'aperta' ? (
                        <button
                          onClick={() => handleOpenTicket(ticket)}
                          disabled={!canManage}
                          title={!canManage ? "Non hai i permessi per gestire questa categoria (o sei amministratore)" : ""}
                          className={`inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-200 
                            ${canManage 
                              ? 'bg-white text-slate-700 hover:bg-slate-100 hover:text-blue-600 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-blue-400' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-500'}`}
                        >
                          Gestisci
                        </button>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400 italic">Problema risolto</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALE DI GESTIONE RISOLUZIONE (SIMILE AD ASSET LIST) */}
      {selectedTicket && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto transform transition-all">
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-slate-700 pb-4">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">Risoluzione Ticket (Azione Correttiva)</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold transition-colors">✕</button>
            </div>
            
            <div className="mb-6">
              <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Descrizione Problema Segnalato:</span>
              <p className="text-sm text-rose-700 dark:text-rose-400 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800 leading-relaxed font-medium">
                "{selectedTicket.descrizione}"
              </p>
            </div>

            {loadingAsset ? (
               <div className="flex justify-center py-8">
                 <div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-blue-600 border-t-transparent"></div>
               </div>
            ) : linkedAsset ? (
              <>
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Gestione Foto Asset</h4>
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
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isResolving} />
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
                          
                          {(() => {
                            if (attr.type === 'enum') {
                              return (
                                <select 
                                  value={formData.metadata[attr.name] || ''} 
                                  disabled={isAdmin}
                                  onChange={(e) => handleMetadataChange(attr.name, e.target.value)}
                                  className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900"
                                >
                                  <option value="">Seleziona...</option>
                                  {attr.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                              );
                            }
                            if (attr.type === 'boolean') {
                              return (
                                <select 
                                  value={formData.metadata[attr.name] !== undefined ? String(formData.metadata[attr.name]) : ''} 
                                  disabled={isAdmin}
                                  onChange={(e) => handleMetadataChange(attr.name, e.target.value === 'true')}
                                  className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900"
                                >
                                  <option value="">Seleziona...</option>
                                  <option value="true">Vero (Sì)</option>
                                  <option value="false">Falso (No)</option>
                                </select>
                              );
                            }
                            if (attr.type === 'date') {
                              return (
                                <input 
                                  type="date"
                                  value={formData.metadata[attr.name] || ''}
                                  disabled={isAdmin}
                                  onChange={(e) => handleMetadataChange(attr.name, e.target.value)}
                                  className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900"
                                />
                              );
                            }
                            return (
                              <input 
                                type={attr.type === 'number' ? 'number' : 'text'} 
                                value={formData.metadata[attr.name] || ''} 
                                disabled={isAdmin}
                                onChange={e => handleMetadataChange(attr.name, attr.type === 'number' ? parseFloat(e.target.value) : e.target.value)} 
                                className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-slate-900" 
                              />
                            );
                          })()}
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

                <div className="mb-6 border-t border-slate-100 dark:border-slate-700 pt-5 mt-4">
                  <label className="mb-2 block text-sm font-bold text-blue-600 dark:text-blue-400">Nota Tecnica di Intervento Correttivo <span className="text-rose-500">*</span></label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    La nota giustificherà le eventuali modifiche apportate ai dati dell'asset e permetterà la chiusura definitiva della segnalazione da parte dell'utente.
                  </p>
                  <textarea 
                    rows={4} 
                    value={notaIntervento} 
                    onChange={(e) => setNotaIntervento(e.target.value)} 
                    placeholder="Descrivi dettagliatamente l'intervento effettuato per risolvere il problema..."
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800" 
                  />
                </div>
              </>
            ) : (
               <div className="py-8 text-center text-rose-500 font-semibold">
                 Asset eliminato o non disponibile.
               </div>
            )}
            
            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={closeModal} 
                disabled={isResolving} 
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Annulla
              </button>
              <button 
                onClick={handleResolve} 
                disabled={isResolving || !notaIntervento.trim() || !linkedAsset} 
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {isResolving ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Chiusura...
                  </>
                ) : 'Aggiorna Asset e Chiudi Ticket'}
              </button>
            </div>
          </div>
        </div>, document.body
      )}

      {notification && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden text-center p-6">
            {notification.type === 'success' ? (
              <svg className="mx-auto mb-4 w-12 h-12 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            ) : (
              <svg className="mx-auto mb-4 w-12 h-12 text-rose-600 dark:text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            )}
            <h3 className="mb-2 text-lg font-bold text-slate-800 dark:text-white">
              {notification.type === 'success' ? 'Operazione Completata' : 'Errore'}
            </h3>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              {notification.message}
            </p>
            <button
              onClick={() => setNotification(null)}
              className={`rounded-lg px-6 py-2 text-sm font-bold text-white shadow-sm transition-all focus:ring-2 focus:ring-offset-2 w-full sm:w-auto ${
                notification.type === 'success' 
                  ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500' 
                  : 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500'
              }`}
            >
              Chiudi
            </button>
          </div>
        </div>, document.body
      )}
    </>
  );
}