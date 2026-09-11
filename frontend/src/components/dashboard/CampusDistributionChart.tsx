import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface CampusDistributionProps {
  distributionData: Record<string, number> | null;
}

export default function CampusDistributionChart({ distributionData }: CampusDistributionProps) {
  const labels = distributionData ? Object.keys(distributionData) : [];
  
  // Dati Reali
  const realSeries = distributionData ? Object.values(distributionData) : [];
  const hasData = realSeries.length > 0 && realSeries.some((val) => val > 0);
  const dynamicHeight = Math.max(300, labels.length * 60);

  // Calcola il valore massimo REALE per definire i tick dell'asse X e la larghezza visiva
  const maxVal = realSeries.length > 0 ? Math.max(...realSeries) : 1;

  // Calcoliamo un valore "Visivo" minimo (1% del valore massimo). 
  // Aggiungiamo un decimale microscopico univoco (idx * 0.0001) per rintracciare 
  // il valore reale durante l'hover o il render dell'etichetta.
  const minVisualValue = maxVal * 0.01; 
  const visualSeries = realSeries.map((val, idx) => 
    val > 0 && val < minVisualValue ? minVisualValue + (idx * 0.0001) : val
  );

  const options: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'], 
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
        barHeight: '28px',
        dataLabels: { position: 'top' },
        distributed: true 
      },
    },
    legend: { show: false },
    dataLabels: { 
      enabled: true, 
      offsetX: -10,
      style: { colors: ['#ffffff'], fontSize: '11px', fontWeight: 700 },
      // Intercettiamo il valore visivo gonfiato e stampiamo nella barra il numero reale
      formatter: (val) => {
        const numVal = Number(val);
        const index = visualSeries.findIndex(v => v === numVal);
        return index !== -1 ? realSeries[index].toString() : val.toString();
      }
    },
    xaxis: {
      categories: labels,
      title: { text: 'Volume Asset Attivi', style: { color: '#64748B', fontWeight: 600 } },
      labels: { 
        style: { colors: '#64748B', fontWeight: 600 },
        formatter: (val) => Math.floor(Number(val)).toString(), 
      },
      tickAmount: maxVal < 5 ? maxVal : 5, 
    },
    yaxis: {
      labels: { 
        maxWidth: 180, 
        style: { colors: '#475569', fontSize: '13px', fontWeight: 600 } 
      }
    },
    grid: {
      borderColor: '#E2E8F0',
      strokeDashArray: 4, 
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
    },
    tooltip: { 
      theme: 'light',
      y: { 
        // Sovrascriviamo il tooltip per mostrare sempre il valore reale
        formatter: (val, opts) => {
          if (opts && opts.dataPointIndex !== undefined) {
            return `${realSeries[opts.dataPointIndex]}`;
          }
          const numVal = Number(val);
          const index = visualSeries.findIndex(v => v === numVal);
          return index !== -1 ? `${realSeries[index]}` : `${val}`;
        } 
      }
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-4">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Distribuzione Territoriale</h4>
        <p className="text-sm font-medium text-slate-500">Confronta i volumi tra poli universitari</p>
      </div>

      <div className="flex-1 w-full overflow-x-hidden overflow-y-auto">
        {hasData ? (
          <ReactApexChart options={options} series={[{ name: 'Assets', data: visualSeries }]} type="bar" height={dynamicHeight} />
        ) : (
          <div className="flex h-[300px] items-center justify-center text-sm font-medium text-slate-400">
            Nessun dato per i campus attualmente disponibili.
          </div>
        )}
      </div>
    </div>
  );
}