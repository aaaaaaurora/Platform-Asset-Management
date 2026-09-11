import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface CategoryDistributionProps {
  distributionData: Record<string, number> | null;
}

export default function CategoryDistributionChart({ distributionData }: CategoryDistributionProps) {
  const labels = distributionData ? Object.keys(distributionData) : [];
  
  // Dati Reali
  const realSeries = distributionData ? Object.values(distributionData) : [];
  const hasData = realSeries.length > 0 && realSeries.some((val) => val > 0);
  const realTotal = realSeries.reduce((acc, val) => acc + val, 0);

  // Calcoliamo un valore "Visivo" minimo (1.5% del totale) per garantire che ogni 
  // spicchio, anche se contiene solo 1 elemento su 5000, sia visibile ad occhio nudo.
  const minVisualValue = realTotal * 0.015; 
  const visualSeries = realSeries.map((val) => 
    val > 0 && val < minVisualValue ? minVisualValue : val
  );

  const options: ApexOptions = {
    chart: { type: 'donut', fontFamily: 'inherit' },
    colors: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899'],
    labels: labels,
    legend: {
      show: true,
      position: 'bottom',
      fontSize: '13px',
      fontWeight: 600
      // Rimossa la proprietà "markers: { radius: 12 }" che causava l'errore TypeScript 
    },
    plotOptions: {
      pie: {
        donut: { 
          size: '70%',
          labels: {
            show: true,
            name: { fontSize: '14px', fontWeight: 600, color: '#64748B' },
            value: { fontSize: '24px', fontWeight: 800, color: '#0F172A' },
            total: { 
              show: true, 
              label: 'Totale Asset', 
              color: '#64748B', 
              fontSize: '12px', 
              fontWeight: 700,
              // Sovrascriviamo il calcolo automatico per mostrare la somma REALE (5007)
              // e non quella falsata dai valori minimi visivi aggiunti per gli spicchi
              formatter: () => realTotal.toString() 
            }
          }
        },
      },
    },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    tooltip: { 
      theme: 'light', 
      y: { 
        // Sovrascriviamo il tooltip in modo che passando il mouse su uno spicchio 
        // ingrandito forzatamente, appaia comunque il valore reale (es. "1")
        formatter: (val, opts) => {
          if (opts && opts.seriesIndex !== undefined) {
            return `${realSeries[opts.seriesIndex]}`;
          }
          return `${val}`;
        } 
      } 
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-6">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Ripartizione Categorie</h4>
        <p className="text-sm font-medium text-slate-500">Visualizza gli assets attivi divisi per tipologia</p>
      </div>

      <div className="flex-1 flex items-center justify-center">
        {hasData ? (
          <ReactApexChart options={options} series={visualSeries} type="donut" height={320} width="100%" />
        ) : (
          <div className="text-sm font-medium text-slate-400">
            Nessuna categoria censita.
          </div>
        )}
      </div>
    </div>
  );
}