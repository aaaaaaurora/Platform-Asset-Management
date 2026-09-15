import React from 'react';

interface Props {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  confirmColor?: 'rose' | 'amber' | 'blue';
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}

export default function ConfirmAlertModal({ isOpen, title, message, confirmText = "Conferma", confirmColor = "rose", onClose, onConfirm, isSubmitting }: Props) {
  if (!isOpen) return null;

  const colorClasses = {
    rose: "bg-rose-600 hover:bg-rose-700 focus:ring-rose-500 text-white",
    amber: "bg-amber-500 hover:bg-amber-600 focus:ring-amber-400 text-white",
    blue: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 text-white"
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl flex flex-col overflow-hidden dark:bg-slate-800 dark:border dark:border-slate-700">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{title}</h3>
        </div>
        <div className="p-5 text-sm text-slate-600 dark:text-slate-300">
          {message}
        </div>
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button 
            onClick={onClose} disabled={isSubmitting} 
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            Annulla
          </button>
          <button 
            onClick={onConfirm} disabled={isSubmitting} 
            className={`px-4 py-2 text-sm font-medium rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 ${colorClasses[confirmColor]}`}
          >
            {isSubmitting ? "Attendere..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}