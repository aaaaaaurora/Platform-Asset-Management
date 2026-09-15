import { useEffect, useState } from 'react';

// Componente helper per l'animazione fluida dei numeri (effetto odometro)
function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let start = displayValue;
    const end = value;
    if (start === end) return;

    const duration = 1200; // 1.2 secondi di animazione fluida
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);

      // Funzione di Easing (easeOutExpo) per un rallentamento morbido e molto elegante alla fine
      const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentVal = Math.floor(start + (end - start) * easeOut);

      setDisplayValue(currentVal);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
      }
    };

    requestAnimationFrame(animate);
  }, [value]); // Si innesca automaticamente ogni volta che il websocket cambia il prop 'value'

  // Formattazione con il punto per le migliaia (standard italiano)
  return <>{new Intl.NumberFormat('it-IT').format(displayValue)}</>;
}

interface AssetMetricsProps {
  totals: {
    assets: number;
    tickets: number;
    interventions: number;
  } | null;
}

export default function AssetMetrics({ totals }: AssetMetricsProps) {
  // Il backend ora calcola i valori netti (creati - eliminati/risolti)
  const data = totals || { assets: 0, tickets: 0, interventions: 0 };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Card 1: Totale Asset Attivi */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 transition-transform hover:-translate-y-1 duration-300">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assets Attivi</span>
            <h4 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              <AnimatedNumber value={data.assets} />
            </h4>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
        </div>
      </div>

      {/* Card 2: Segnalazioni / Ticket */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 transition-transform hover:-translate-y-1 duration-300">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Segnalazioni Aperte</span>
            <h4 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              <AnimatedNumber value={data.tickets} />
            </h4>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/10 dark:text-amber-400">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Card 3: Interventi */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 transition-transform hover:-translate-y-1 duration-300">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Segnalazioni Risolte</span>
            <h4 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              <AnimatedNumber value={data.interventions} />
            </h4>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-400">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}