import { Operator, Category, Campus } from "../../pages/Admin/OperatorsManagement";

interface OperatorsTableProps {
  operators: Operator[];
  categories: Category[];
  campuses: Campus[];
  isLoading: boolean;
  onEditClick: (op: Operator) => void;
}

export default function OperatorsTable({ operators, categories, campuses, isLoading, onEditClick }: OperatorsTableProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
            <tr>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Email Operatore</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Categoria Assegnata</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs min-w-[200px] sm:w-[30%]">Campus Assegnati</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Stato</th>
              <th className="py-4 px-6 font-semibold text-right"></th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-10 text-center font-medium text-slate-500">Caricamento operatori in corso...</td>
              </tr>
            ) : operators.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center font-medium text-slate-500">Nessun operatore configurato.</td>
              </tr>
            ) : (
              operators.map((op, index) => {
                const catName = categories.find((c: any) => String(c.id) === String(op.category_id) || String(c._id) === String(op.category_id))?.name || "Nessuna specifica";
                const isFunctionallyActive = op.is_active && op.campus_ids.length > 0;

                return (
                  <tr 
                    key={op.id} 
                    className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors`}
                  >
                    <td className="py-4 px-6">
                      <span className="font-semibold text-slate-800 dark:text-white">{op.email}</span>
                    </td>
                    
                    <td className="py-4 px-6 font-medium text-slate-600 dark:text-slate-300">
                      {catName}
                    </td>
                    
                    <td className="py-4 px-6">
                      {op.campus_ids.length === 0 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
                          Nessuno
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {op.campus_ids.map(id => {
                            const rawCampus = campuses.find((c) => c.id === id);
                            const cName = rawCampus ? rawCampus.name : `Campus (${id.substring(0, 5)}...)`;
                            
                            return (
                              <span key={id} className="inline-flex items-center text-center whitespace-normal break-words rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 border border-blue-200 shadow-sm">
                                {cName}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold border ${
                        isFunctionallyActive 
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                          : 'bg-rose-100 text-rose-800 border-rose-200'
                      }`}>
                        {isFunctionallyActive ? 'Operativo' : 'Non operativo'}
                      </span>
                    </td>
                    
                    <td className="py-4 px-6 text-right">
                      <button 
                        onClick={() => onEditClick(op)} 
                        className="inline-flex items-center justify-center rounded-lg bg-white border border-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-100 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-blue-400"
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