import { Category } from "../../pages/Admin/CategoriesManagement";

interface CategoriesTableProps {
  categories: Category[];
  isLoading: boolean;
  onManageClick: (cat: Category) => void;
}

export default function CategoriesTable({ categories, isLoading, onManageClick }: CategoriesTableProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
            <tr>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Nome Categoria</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Descrizione</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs text-center">N° Attributi attivi</th>
              <th className="py-4 px-6 font-semibold text-center w-28"></th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="py-10 text-center font-medium text-slate-500">Caricamento in corso...</td>
              </tr>
            ) : categories.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center font-medium text-slate-500">Nessuna categoria configurata.</td>
              </tr>
            ) : (
              categories.map((cat, index) => {
                // Contiamo solo gli attributi che non sono stati deprecati
                const activeAttrsCount = cat.attributes?.filter(a => a.status !== 'unavailable').length || 0;
                
                return (
                  <tr 
                    key={cat._id} 
                    className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors`}
                  >
                    <td className="py-4 px-6 font-bold text-slate-800 dark:text-white">
                      {cat.name}
                    </td>
                    <td className="py-4 px-6">
                      {cat.description || <span className="italic text-slate-400">Nessuna descrizione</span>}
                    </td>
                    <td className="py-4 px-6 text-center font-semibold text-blue-600 dark:text-blue-400">
                      {activeAttrsCount}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <button
                        onClick={() => onManageClick(cat)}
                        className="inline-flex items-center justify-center rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-blue-600 transition-all focus:ring-2 focus:ring-slate-200 shadow-sm"
                      >
                        Gestisci
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}