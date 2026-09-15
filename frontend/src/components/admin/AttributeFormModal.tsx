import { useState, useEffect } from "react";
import { CategoryAttribute } from "../../pages/Admin/CategoriesManagement";

interface Props {
  isOpen: boolean;
  initialData: CategoryAttribute | null;
  onClose: () => void;
  onSave: (attr: CategoryAttribute) => void;
  isSubmitting?: boolean;
}

export default function AttributeFormModal({ isOpen, initialData, onClose, onSave, isSubmitting }: Props) {
  // NOTA: filterable ora è false di default per evitare l'affollamento dei filtri
  const defaultAttr: CategoryAttribute = { name: "", type: "string", required: false, filterable: false, editable: true, visible: true, options: [], status: "active" };
  const [attrData, setAttrData] = useState<CategoryAttribute>(defaultAttr);
  const [optionInput, setOptionInput] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAttrData(initialData || defaultAttr);
      setOptionInput("");
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(attrData);
  };

  const addOption = () => {
    if (optionInput.trim()) {
      setAttrData({ ...attrData, options: [...attrData.options, optionInput.trim()] });
      setOptionInput("");
    }
  };

  // Funzione per gestire il cambio del tipo di dato e l'autofill intelligente
  const handleTypeChange = (newType: string) => {
    setAttrData(prev => ({
      ...prev,
      type: newType as CategoryAttribute["type"], 
      // Se l'utente seleziona enum o boolean, suggeriamo automaticamente l'uso come filtro
      filterable: newType === 'enum' || newType === 'boolean' ? true : prev.filterable
    }));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm transition-opacity">
      {/* 
        ALTEZZA FISSA: h-[460px].
        Il modale ora è solido e compatto, non cambierà mai dimensione. 
      */}
      <div className="w-full max-w-md h-[460px] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        
        {/* HEADER FISSO */}
        <div className="flex-none px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">
            {initialData ? "Modifica Metadato" : "Nuovo Metadato"}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-rose-500 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* BODY SCROLLABILE INTERNAMENTE */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900">
          <form id="attrForm" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Nome</label>
              <input type="text" required value={attrData.name} onChange={e => setAttrData({...attrData, name: e.target.value})} className="w-full rounded-md border border-slate-300 py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white transition-colors" />
            </div>
            
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Tipo di Dato</label>
              <select 
                value={attrData.type} 
                onChange={e => handleTypeChange(e.target.value)} 
                className="w-full rounded-md border border-slate-300 py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white transition-colors"
              >
                <option value="string">Testo (Stringa)</option>
                <option value="number">Numero</option>
                <option value="boolean">Vero/Falso (Boolean)</option>
                <option value="date">Data</option>
                <option value="enum">Menu a Tendina (Enum)</option>
              </select>
            </div>

            {/* SEZIONE ENUM CON SCROLLBAR DEDICATA PER I TAGS */}
            {attrData.type === 'enum' && (
              <div className="p-4 bg-white rounded-md border border-slate-200 dark:bg-slate-800 dark:border-slate-700 shadow-sm animate-fade-in-up">
                <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Opzioni Tendina</label>
                <div className="flex gap-2 mb-3">
                  <input type="text" value={optionInput} onChange={e => setOptionInput(e.target.value)} onKeyDown={e => { if(e.key === 'Enter'){ e.preventDefault(); addOption(); } }} placeholder="Scrivi e premi Invio..." className="flex-1 rounded-md border border-slate-300 py-1.5 px-3 text-sm focus:border-blue-500 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white transition-colors" />
                  <button type="button" onClick={addOption} className="px-3 py-1.5 bg-slate-800 text-white text-sm font-semibold rounded-md hover:bg-slate-700 transition-colors">Aggiungi</button>
                </div>
                {/* Scrollbar limitata per i tag (max-h-24) */}
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-1">
                  {attrData.options.map((opt, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-md border border-blue-200">
                      {opt} 
                      <button type="button" onClick={() => setAttrData({...attrData, options: attrData.options.filter((_, idx) => idx !== i)})} className="text-blue-500 hover:text-blue-800 focus:outline-none">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={attrData.required} onChange={e => setAttrData({...attrData, required: e.target.checked})} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 dark:text-slate-300 transition-colors">Campo obbligatorio</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={attrData.filterable} onChange={e => setAttrData({...attrData, filterable: e.target.checked})} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 dark:text-slate-300 transition-colors">Abilita come filtro ricerca</span>
              </label>
            </div>
          </form>
        </div>

        {/* FOOTER FISSO */}
        <div className="flex-none px-6 py-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600">Annulla</button>
          <button type="submit" form="attrForm" disabled={isSubmitting || (attrData.type === 'enum' && attrData.options.length === 0)} className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
            {isSubmitting ? "Attendere..." : "Conferma"}
          </button>
        </div>

      </div>
    </div>
  );
}