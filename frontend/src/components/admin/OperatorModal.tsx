import { useState, useEffect } from "react";
import { Category, Campus, OperatorFormData } from "../../pages/Admin/OperatorsManagement";

interface OperatorModalProps {
  isOpen: boolean;
  isEditing: boolean;
  initialData: OperatorFormData;
  categories: Category[];
  campuses: Campus[];
  error: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (data: OperatorFormData) => void;
}

export default function OperatorModal({
  isOpen,
  isEditing,
  initialData,
  categories,
  campuses,
  error,
  isSubmitting,
  onClose,
  onSubmit
}: OperatorModalProps) {
  
  const [formData, setFormData] = useState<OperatorFormData>(initialData);

  useEffect(() => {
    setFormData(initialData);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleCampusToggle = (campusId: string) => {
    setFormData((prev) => {
      const isSelected = prev.campus_ids.includes(campusId);
      return {
        ...prev,
        campus_ids: isSelected
          ? prev.campus_ids.filter((id) => id !== campusId)
          : [...prev.campus_ids, campusId],
      };
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const hasCategoryChanged = formData.category_id !== initialData.category_id;
  const hasCampusesChanged = 
    formData.campus_ids.length !== initialData.campus_ids.length || 
    !formData.campus_ids.every(id => initialData.campus_ids.includes(id));
    
  const hasChanges = hasCategoryChanged || hasCampusesChanged;
  const isSaveDisabled = isSubmitting || (isEditing && !hasChanges);

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg flex flex-col max-h-[90vh] rounded-2xl bg-white shadow-2xl overflow-hidden dark:bg-slate-800">
        
        <div className="px-6 py-5 bg-slate-50 border-b border-slate-200 dark:bg-slate-900 dark:border-slate-700">
          <h3 className="text-xl font-extrabold text-slate-800 dark:text-white">
            {isEditing ? "Modifica Permessi" : "Registrazione Nuovo Operatore"}
          </h3>
        </div>

        <div className="overflow-y-auto p-6 flex-1">
          <form id="operatorForm" onSubmit={handleFormSubmit}>
            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="mb-5">
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
                Indirizzo E-mail esistente
              </label>
              <input
                type="email"
                required
                disabled={isEditing}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="es. operatore@gmail.com"
                className="w-full rounded-lg border border-slate-300 bg-white py-3 px-4 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            <div className="mb-5">
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
                Categoria di competenza
              </label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white py-3 px-4 text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Nessuna Categoria --</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-2">
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">
                Campus assegnati
              </label>
              <p className="mb-3 text-xs font-medium text-slate-500">
                Seleziona i perimetri geografici. Se lasci tutto vuoto, l'Operatore non vedrà nessun campus.
              </p>
              
              <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-48 overflow-y-auto">
                {campuses.length === 0 ? (
                  <span className="text-sm italic text-slate-500 p-2">Nessun campus configurato nel sistema.</span>
                ) : (
                  campuses.map((campus) => (
                    <label key={campus.id} className="flex cursor-pointer items-center gap-3 py-2 px-3 hover:bg-white rounded-md transition-colors border border-transparent hover:border-slate-200">
                      <input
                        type="checkbox"
                        checked={formData.campus_ids.includes(campus.id)}
                        onChange={() => handleCampusToggle(campus.id)}
                        className="h-5 w-5 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-bold text-slate-700">
                        {campus.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 dark:bg-slate-900 dark:border-slate-700 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-100 focus:ring-2 focus:ring-slate-200"
          >
            Annulla
          </button>
          
          <button
            type="submit"
            form="operatorForm"
            disabled={isSaveDisabled}
            className={`rounded-lg px-6 py-2.5 text-sm font-bold text-white shadow-md transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              isSaveDisabled 
                ? 'bg-slate-400 cursor-not-allowed dark:bg-slate-600 dark:text-slate-300' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSubmitting ? "Salvataggio..." : isEditing ? "Aggiorna Permessi" : "Salva Operatore"}
          </button>
        </div>

      </div>
    </div>
  );
}