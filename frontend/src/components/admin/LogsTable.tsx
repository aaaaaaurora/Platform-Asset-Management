export interface AuditLog {
  id: string;
  correlation_id: string | null;
  service_name: string;
  action: string;
  actor_id: string | null;
  entity_id: string | null;
  payload: any;
  created_at: string;
}

interface LogsTableProps {
  logs: AuditLog[];
  isLoading: boolean;
  viewType?: 'business' | 'system';
}

export default function LogsTable({ logs, isLoading, viewType = 'business' }: LogsTableProps) {
  
  const formatDate = (isoString: string) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString('it-IT', { 
      day: '2-digit', month: 'short', year: 'numeric', 
      hour: '2-digit', minute:'2-digit', second:'2-digit'
    });
  };

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').toUpperCase();
  };

  const getUserDisplay = (log: AuditLog) => {
    if (log.actor_id === 'system') {
      return <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px] uppercase">System Auto</span>;
    }

    const payload = log.payload || {};
    const extraData = payload.extra_data || {};
    const humanReadable = payload.email || extraData.email || payload.name || extraData.name;

    if (humanReadable) {
      return <span className="font-semibold text-slate-700 dark:text-slate-200">{humanReadable}</span>;
    }

    return <span className="text-slate-400 italic text-xs">Nessun utente coinvolto</span>;
  };

  // Determina dinamicamente il numero di colonne visualizzate per il colSpan del loader
  const colCount = viewType === 'business' ? 5 : 3;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-700 dark:bg-slate-800">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
          
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-700 dark:text-white dark:border-slate-600">
            <tr>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs w-48">Data e Ora</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Azione Effettuata</th>
              <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Utente / Operatore</th>
              {viewType === 'business' && (
                <>
                  <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Campus</th>
                  <th className="py-4 px-6 font-semibold uppercase tracking-wider text-xs">Asset</th>
                </>
              )}
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-t-transparent"></div>
                    <span className="font-medium text-slate-500">Caricamento storico in corso...</span>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-16 text-center">
                  <svg className="mx-auto h-12 w-12 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-lg font-bold text-slate-700 dark:text-slate-200">Nessun dato storico disponibile</p>
                  <p className="text-sm text-slate-500 mt-1">Non sono state registrate operazioni per i filtri correnti.</p>
                </td>
              </tr>
            ) : (
              logs.map((log, index) => {
                const extra = log.payload?.extra_data || log.payload || {};
                const campusName = extra.campus_name; 
                const assetName = extra.asset_name;

                return (
                  <tr 
                    key={log.id} 
                    className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors`}
                  >
                    <td className="py-4 px-6 whitespace-nowrap">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {formatDate(log.created_at)}
                      </span>
                    </td>
                    
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 border border-blue-200 uppercase tracking-wide shadow-sm">
                        {formatAction(log.action)}
                      </span>
                      {log.service_name && (
                        <span className="block text-[10px] text-slate-400 mt-1.5 font-semibold">
                          VIA: {log.service_name.toUpperCase()}
                        </span>
                      )}
                    </td>
                    
                    <td className="py-4 px-6">
                      {getUserDisplay(log)}
                    </td>
                    
                    {viewType === 'business' && (
                      <>
                        <td className="py-4 px-6">
                          {campusName ? (
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{campusName}</span>
                          ) : (
                            <span className="text-slate-400 italic text-xs">Nessun campus</span>
                          )}
                        </td>

                        <td className="py-4 px-6">
                          {assetName ? (
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{assetName}</span>
                          ) : (
                            <span className="text-slate-400 italic text-xs">Nessun asset</span>
                          )}
                        </td>
                      </>
                    )}
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