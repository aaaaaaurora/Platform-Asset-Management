import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Category, CategoryAttribute } from "../../pages/Admin/CategoriesManagement";
import { useAuth } from "../../context/AuthContext";
import AttributeFormModal from "../../components/admin/AttributeFormModal";
import ConfirmAlertModal from "../../components/admin/ConfirmAlertModal";
import Picker from '@emoji-mart/react';

export default function CategoryEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const baseUrl = import.meta.env.VITE_API_URL || '';
  
  const [currentCategory, setCurrentCategory] = useState<Category | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  
  // Dati Base
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catIcon, setCatIcon] = useState("📍");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  // Attributi e JSON
  const [localAttributes, setLocalAttributes] = useState<CategoryAttribute[]>([]);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  
  // Modali e Conflitti
  const [attrFormOpen, setAttrFormOpen] = useState(false);
  const [editingAttr, setEditingAttr] = useState<CategoryAttribute | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{isOpen: boolean, pendingAttr: CategoryAttribute | null, oldName?: string}>({ isOpen: false, pendingAttr: null });
  const [deleteCategoryAlert, setDeleteCategoryAlert] = useState(false);

  // Caricamento Dati in Modifica
  useEffect(() => {
    if (id) {
      const fetchCategory = async () => {
        setIsLoading(true);
        try {
          const res = await fetch(`${baseUrl}/asset/api/categories/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error("Categoria non trovata");
          const data = await res.json();
          setCurrentCategory(data);
          setCatName(data.name || "");
          setCatDesc(data.description || "");
          setCatIcon(data.icon || "📍");
          setLocalAttributes(data.attributes.map((a: any) => ({ ...a, _originalName: a.name })));
        } catch (err: any) {
          setError(err.message);
        } finally {
          setIsLoading(false);
        }
      };
      fetchCategory();
    }
  }, [id, token, baseUrl]);

  // Controlli per abilitare il pulsante Salva
  const safeOriginalName = currentCategory?.name || "";
  const safeOriginalDesc = currentCategory?.description || "";
  const safeOriginalIcon = currentCategory?.icon || "📍";
  
  const cleanAttr = (attr: any) => {
    const { _originalName, ...rest } = attr;
    return rest;
  };

  const hasGeneralChanges = currentCategory && (catName !== safeOriginalName || catDesc !== safeOriginalDesc || catIcon !== safeOriginalIcon);
  const hasAttributeChanges = currentCategory && (
    JSON.stringify(localAttributes.map(cleanAttr)) !== JSON.stringify(currentCategory?.attributes || [])
  );
  const hasChanges = !currentCategory || hasGeneralChanges || hasAttributeChanges;

  // SALVATAGGIO (Creazione o Modifica)
  const handleSaveAll = async () => {
    if (localAttributes.length === 0) return setError("Aggiungi almeno un attributo.");
    if (!catName.trim()) return setError("Il nome della categoria è obbligatorio.");
    
    setIsSubmitting(true); 
    setError(""); 
    setSuccessMsg("");

    try {
      if (!currentCategory) {
        // Creazione Nuova
        const catRes = await fetch(`${baseUrl}/asset/api/categories`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: catName, description: catDesc, icon: catIcon }),
        });
        const catData = await catRes.json();
        if (!catRes.ok) throw new Error(catData.error || "Errore creazione categoria");

        const newCatId = catData.category._id;
        for (const attr of localAttributes) {
          const attrRes = await fetch(`${baseUrl}/asset/api/categories/${newCatId}/attributes`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(cleanAttr(attr)),
          });
          if (!attrRes.ok) throw new Error((await attrRes.json()).error || `Errore salvataggio ${attr.name}`);
        }
        
        setSuccessMsg("Categoria creata con successo!");
        setTimeout(() => navigate('/admin/categories'), 1500);

      } else {
        // Modifica Esistente
        if (hasGeneralChanges) {
          const res = await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}`, {
            method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: catName, description: catDesc, icon: catIcon }),
          });
          if (!res.ok) throw new Error((await res.json()).error || "Errore aggiornamento info generali");
        }

        if (hasAttributeChanges) {
          for (const attr of localAttributes) {
            const isNew = !(attr as any)._originalName;
            const originalAttr = currentCategory.attributes.find(a => a.name === (attr as any)._originalName);
            const cleanAttrData = cleanAttr(attr);

            if (isNew) {
              const res = await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}/attributes`, {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(cleanAttrData),
              });
              if (!res.ok) throw new Error((await res.json()).error || `Errore salvataggio ${attr.name}`);
            } else if (originalAttr && JSON.stringify(cleanAttrData) !== JSON.stringify(originalAttr)) {
              const res = await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}/attributes/${(attr as any)._originalName}`, {
                method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(cleanAttrData),
              });
              
              if (res.status === 409) {
                const data = await res.json();
                if (data.error?.includes("incompatibilità")) {
                  setConflictPrompt({ isOpen: true, pendingAttr: cleanAttrData, oldName: (attr as any)._originalName });
                  setIsSubmitting(false);
                  return; 
                }
              }
              if (!res.ok) throw new Error((await res.json()).error || `Errore aggiornamento ${attr.name}`);
            }
          }
        }
        setSuccessMsg("Tutte le modifiche sono state salvate!");
        setTimeout(() => navigate('/admin/categories'), 1500);
      }
    } catch (err: any) { 
      setError(err.message); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  // IMPORTAZIONE JSON
  const handleJsonImport = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const newAttrs: CategoryAttribute[] = [];
      
      for (const item of arr) {
        if (!item.name || !item.type) throw new Error(`Attributo mancante di 'name' o 'type' (${JSON.stringify(item)})`);
        if (item.type === 'enum' && (!Array.isArray(item.options) || item.options.length === 0)) {
          throw new Error(`L'attributo enum '${item.name}' richiede un array 'options'`);
        }
        newAttrs.push({
          name: item.name.trim(),
          type: item.type.toLowerCase(),
          required: !!item.required,
          filterable: !!item.filterable,
          editable: item.editable !== false,
          visible: item.visible !== false,
          options: item.options || [],
          status: item.status || 'active'
        });
      }
      
      setLocalAttributes(prev => {
        const merged = [...prev];
        let addedCount = 0;
        newAttrs.forEach(na => {
          if (!merged.some(a => a.name.toLowerCase() === na.name.toLowerCase())) {
            merged.push(na);
            addedCount++;
          }
        });
        if (addedCount === 0) throw new Error("Tutti gli attributi nel JSON esistono già in memoria.");
        return merged;
      });
      
      setShowJsonImport(false);
      setJsonText("");
      setJsonError("");
    } catch (err: any) {
      setJsonError(err.message);
    }
  };

  const handleSaveAttribute = (attrData: CategoryAttribute) => {
    setError("");
    if (localAttributes.some(a => a.name.toLowerCase() === attrData.name.toLowerCase() && (!editingAttr || editingAttr.name !== a.name))) {
      return setError("Un attributo con questo nome esiste già.");
    }
    
    if (editingAttr) {
      setLocalAttributes(prev => prev.map(a => a.name === editingAttr.name ? { ...attrData, _originalName: (a as any)._originalName } : a));
    } else {
      setLocalAttributes([...localAttributes, attrData]);
    }
    setAttrFormOpen(false);
  };

  const setAttrDeprecationStatus = (attrName: string, deprecate: boolean) => {
    if (deprecate) {
      const activeAttributesCount = localAttributes.filter(a => a.status !== 'unavailable' && a.name !== attrName).length;
      if (activeAttributesCount === 0) {
        setError("Impossibile eliminare l'unico attributo rimanente. Una categoria deve avere almeno un attributo attivo.");
        setTimeout(() => setError(""), 4000);
        return;
      }
    }
    
    setLocalAttributes(prev => prev.map(a => a.name === attrName ? { ...a, status: deprecate ? 'unavailable' : 'active' } : a));
  };

  const handleDeleteCategory = async () => {
    if (!currentCategory) return;
    setIsSubmitting(true);
    setDeleteCategoryAlert(false); 
    try {
      const res = await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json()).error || "Impossibile eliminare");
      navigate('/admin/categories');
    } catch (err: any) { 
      setError(err.message); 
      setIsSubmitting(false); 
    }
  };

  const handleResolveConflict = async () => {
    if (!currentCategory || !conflictPrompt.pendingAttr) return;
    setIsSubmitting(true);
    try {
      const oldName = conflictPrompt.oldName || conflictPrompt.pendingAttr.name;
      await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}/attributes/${oldName}`, {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: "unavailable", type: conflictPrompt.pendingAttr.type }),
      });
      const newAttr = { ...conflictPrompt.pendingAttr, name: `${conflictPrompt.pendingAttr.name}_new` };
      await fetch(`${baseUrl}/asset/api/categories/${currentCategory._id}/attributes`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(newAttr),
      });
      setConflictPrompt({ isOpen: false, pendingAttr: null });
      navigate('/admin/categories'); 
    } catch(err: any) { 
      setError(err.message); 
      setIsSubmitting(false); 
    }
  };

  if (isLoading) return <div className="flex justify-center p-10"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div></div>;

  return (
    <>
      {/* HEADER PAGINA */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button onClick={() => navigate('/admin/categories')} className="text-sm font-semibold text-slate-500 hover:text-blue-600 mb-1 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Torna alle Categorie
          </button>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {currentCategory ? `Gestione Categoria: ${currentCategory.name}` : "Nuova Categoria"}
          </h2>
        </div>
      </div>

      {/* CONTENITORE CENTRATO PER BOX E MESSAGGI */}
      <div className="max-w-5xl mx-auto pb-4 w-full">
        {/* MESSAGGI DI STATO */}
        {error && <div className="mb-6 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-4 text-rose-800 shadow-sm font-medium">{error}</div>}
        {successMsg && <div className="mb-6 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-emerald-800 shadow-sm font-medium">{successMsg}</div>}

        <div className="flex flex-col gap-6 items-stretch">
          
          {/* BLOCCO SUPERIORE: Info Generali */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-none">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">Informazioni Base</h3>
            </div>
            
            {/* Layout a griglia 2 colonne */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
              <div className="flex gap-4 items-start">
                <div className="relative">
                  <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Icona</label>
                  <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="h-11 w-12 flex items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-xl shadow-sm hover:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors">
                    {catIcon}
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute top-full mt-2 left-0 z-50 shadow-2xl">
                      <Picker locale="it" theme="light" onEmojiSelect={(emoji: any) => { setCatIcon(emoji.native); setShowEmojiPicker(false); }} />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Nome Categoria <span className="text-rose-500">*</span></label>
                  <input type="text" value={catName} onChange={e => setCatName(e.target.value)} placeholder="Es. Macchinari" className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white shadow-sm" />
                </div>
              </div>
              
              <div>
                <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Descrizione (opzionale)</label>
                <input type="text" value={catDesc} onChange={e => setCatDesc(e.target.value)} placeholder="Dettagli operativi o linee guida..." className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white shadow-sm" />
              </div>
            </div>
          </div>

          {/* BLOCCO INFERIORE: Metadati */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center flex-none">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">Tracciato Metadati</h3>
              <div className="flex gap-2">
                <button onClick={() => setShowJsonImport(!showJsonImport)} className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shadow-sm">
                  {showJsonImport ? 'Chiudi JSON' : 'Importa JSON'}
                </button>
                <button onClick={() => { setEditingAttr(null); setAttrFormOpen(true); }} className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 border border-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-sm">
                  + Aggiungi attributo
                </button>
              </div>
            </div>

            {/* AREA DI IMPORT JSON */}
            {showJsonImport && (
              <div className="p-6 pb-0 border-b border-slate-100 dark:border-slate-700">
                <div className="p-5 rounded-xl border border-slate-300 bg-slate-50 dark:bg-slate-900 shadow-inner animate-fade-in-up">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Configura dinamicamente lo schema JSON</label>
                  <textarea 
                    rows={12} 
                    value={jsonText} 
                    onChange={e => { setJsonText(e.target.value); setJsonError(""); }}
                    placeholder={`[\n  {\n    "name": "Stato operativo",\n    "type": "enum",\n    "required": true,\n    "filterable": true,\n    "editable": true,\n    "visible": true,\n    "options": [...]\n  }\n]`}
                    className="w-full font-mono text-sm p-4 rounded-lg border border-slate-300 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-green-400 shadow-sm"
                  />
                  {jsonError && <p className="text-sm text-rose-600 font-bold mt-3 bg-rose-50 p-2 rounded border border-rose-100">{jsonError}</p>}
                  <div className="mt-4 flex justify-end gap-3">
                    <button onClick={() => setJsonText("")} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">Svuota</button>
                    <button onClick={handleJsonImport} className="px-5 py-2 text-sm font-bold text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors shadow-sm">Elabora e Inserisci</button>
                  </div>
                </div>
              </div>
            )}

            {/* AREA METADATI: Compatta e con Scrollbar */}
            <div className="p-5 flex-1 overflow-y-auto max-h-[450px]">
              {localAttributes.length === 0 ? (
                <div className="text-center py-16 px-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/50 dark:bg-slate-900/50 dark:border-slate-700">
                  <div className="mx-auto h-12 w-12 text-slate-300 mb-3">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  </div>
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Nessun attributo configurato.</p>
                  <p className="text-sm text-slate-500 mt-1">Aggiungi manualmente i campi o importa uno schema JSON.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...localAttributes]
                    .sort((a, b) => (a.status === 'unavailable' ? 1 : 0) - (b.status === 'unavailable' ? 1 : 0))
                    .map((attr) => {
                    const originalDbAttr = currentCategory?.attributes.find(a => a.name === (attr as any)._originalName);
                    const isDeprecatedInDb = originalDbAttr?.status === 'unavailable';
                    const isPendingDeletion = !isDeprecatedInDb && attr.status === 'unavailable';
                    const isEffectivelyDeprecated = isDeprecatedInDb && attr.status === 'unavailable';
                    const isPendingRestore = isDeprecatedInDb && attr.status === 'active';
                    const isDimmed = isEffectivelyDeprecated || isPendingDeletion;

                    return (
                      <div key={attr.name} className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3 rounded-lg border shadow-sm transition-all ${isDimmed ? 'bg-slate-50 border-slate-200 opacity-60 dark:bg-slate-800' : 'bg-white border-slate-200 hover:border-blue-300 dark:bg-slate-800'}`}>
                        <div className={isDimmed ? 'line-through text-slate-400' : ''}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-800 dark:text-white">{attr.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase font-bold tracking-wide">{attr.type}</span>
                            {attr.required && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 uppercase font-bold tracking-wide">Obbligatorio</span>}
                            
                            {isPendingDeletion && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 font-bold ml-1.5">IN ELIMINAZIONE</span>}
                            {isEffectivelyDeprecated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-300 font-bold ml-1.5">DEPRECATO</span>}
                            {isPendingRestore && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold ml-1.5">IN RIPRISTINO</span>}
                          </div>
                          {attr.type === 'enum' && <p className="text-[11px] mt-1 text-slate-500 dark:text-slate-400 truncate max-w-md font-medium">Opzioni: {attr.options.join(', ')}</p>}
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {isEffectivelyDeprecated ? (
                              <button onClick={() => setAttrDeprecationStatus(attr.name, false)} className="text-[11px] font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">Ripristina</button>
                          ) : isPendingDeletion ? (
                              <button onClick={() => setAttrDeprecationStatus(attr.name, false)} className="text-[11px] font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">Annulla Eliminazione</button>
                          ) : isPendingRestore ? (
                              <button onClick={() => setAttrDeprecationStatus(attr.name, true)} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 transition-colors">Annulla Ripristino</button>
                          ) : (
                            <>
                              <button onClick={() => { setEditingAttr(attr); setAttrFormOpen(true); }} className="text-[11px] font-bold text-blue-600 hover:text-blue-800 transition-colors">Modifica</button>
                              {!currentCategory || !(attr as any)._originalName ? (
                                <button 
                                  onClick={() => {
                                    if (localAttributes.filter(a => a.status !== 'unavailable').length <= 1) {
                                      setError("Impossibile rimuovere l'unico attributo. Una categoria deve avere almeno un attributo.");
                                      setTimeout(() => setError(""), 4000);
                                      return;
                                    }
                                    setLocalAttributes(prev => prev.filter(a => a.name !== attr.name))
                                  }} 
                                  className="text-[11px] font-bold text-rose-600 hover:text-rose-800 transition-colors"
                                >
                                  Rimuovi
                                </button>
                              ) : (
                                <button onClick={() => setAttrDeprecationStatus(attr.name, true)} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 transition-colors">Elimina</button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER AZIONI */}
        <div className="sticky bottom-6 z-40 mt-8 p-4 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 transition-all">
          <div className="w-full sm:w-auto">
            {currentCategory && (
              <button onClick={() => setDeleteCategoryAlert(true)} className="w-full sm:w-auto px-4 py-2.5 text-sm font-bold text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 rounded-lg shadow-sm transition-colors flex justify-center items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Elimina definitivamente
              </button>
            )}
          </div>
          <div className="flex w-full sm:w-auto gap-3">
            <button onClick={() => navigate('/admin/categories')} disabled={isSubmitting} className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50">
              Annulla
            </button>
            <button onClick={handleSaveAll} disabled={isSubmitting || !hasChanges} className="flex-1 sm:flex-none px-8 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:bg-slate-400">
              {isSubmitting ? "Salvataggio..." : (currentCategory ? "Aggiorna categoria" : "Crea categoria")}
            </button>
          </div>
        </div>

        <AttributeFormModal isOpen={attrFormOpen} initialData={editingAttr} onClose={() => setAttrFormOpen(false)} onSave={handleSaveAttribute} isSubmitting={false} />
        <ConfirmAlertModal isOpen={conflictPrompt.isOpen} title="Conflitto Storico" confirmText="Depreca e Genera Nuovo" confirmColor="amber" onClose={() => setConflictPrompt({isOpen: false, pendingAttr: null})} onConfirm={handleResolveConflict} isSubmitting={isSubmitting} message={<>Esistono vecchi asset con questo formato. Vuoi deprecare il vecchio attributo e generarne uno nuovo?</>} />
        <ConfirmAlertModal isOpen={deleteCategoryAlert} title="Elimina Categoria" confirmText="Elimina definitivamente" confirmColor="rose" onClose={() => setDeleteCategoryAlert(false)} onConfirm={handleDeleteCategory} isSubmitting={isSubmitting} message={<>Questa operazione eliminerà l'intera categoria. Sicuro di procedere?</>} />
      </div>
    </>
  );
}