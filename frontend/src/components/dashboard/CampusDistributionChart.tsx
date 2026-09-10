import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface CampusDistributionProps {
  distributionData: Record<string, number> | null;
}

export default function CampusDistributionChart({ distributionData }: CampusDistributionProps) {
  const labels = distributionData ? Object.keys(distributionData) : [];
  const seriesData = distributionData ? Object.values(distributionData) : [];

  const hasData = seriesData.length > 0 && seriesData.some((val) => val > 0);
  const dynamicHeight = Math.max(300, labels.length * 60);

  // Calcola il valore massimo per definire i tick dell'asse X senza decimali
  const maxVal = seriesData.length > 0 ? Math.max(...seriesData) : 1;

  const options: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    // Array di colori per differenziare i campus
    colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'], 
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
        barHeight: '28px', // Mantiene le barre sottili ed eleganti
        dataLabels: { position: 'top' },
        distributed: true // Abilita l'uso sequenziale dell'array di colori per ogni barra
      },
    },
    legend: { show: false }, // Nasconde la legenda automatica generata dal parametro 'distributed'
    dataLabels: { 
      enabled: true, 
      offsetX: -10, // Spinge il numero verso l'interno della barra
      style: { colors: ['#ffffff'], fontSize: '11px', fontWeight: 700 } // Più piccolo, bianco e meno invasivo
    },
    xaxis: {
      categories: labels,
      title: { text: 'Volume Asset Attivi', style: { color: '#64748B', fontWeight: 600 } },
      labels: { 
        style: { colors: '#64748B', fontWeight: 600 },
        formatter: (val) => Math.floor(Number(val)).toString(), // Rimuove forzatamente i decimali
      },
      tickAmount: maxVal < 5 ? maxVal : 5, // Mostra intervalli di numeri interi coerenti
    },
    yaxis: {
      labels: { 
        maxWidth: 180, // Riduce l'ingombro del testo: i nomi lunghi avranno "..." ma saranno visibili dal tooltip
        style: { colors: '#475569', fontSize: '13px', fontWeight: 600 } 
      }
    },
    grid: {
      borderColor: '#E2E8F0',
      strokeDashArray: 4, // Linea tratteggiata per rendere lo sfondo più leggero e premium
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
    },
    tooltip: { 
      theme: 'light',
      y: { formatter: (val) => `${val}` }
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-4">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Distribuzione Territoriale</h4>
        <p className="text-sm font-medium text-slate-500">Confronto volumi tra poli universitari</p>
      </div>

      <div className="flex-1 w-full overflow-x-hidden overflow-y-auto">
        {hasData ? (
          <ReactApexChart options={options} series={[{ name: 'Assets', data: seriesData }]} type="bar" height={dynamicHeight} />
        ) : (
          <div className="flex h-[300px] items-center justify-center text-sm font-medium text-slate-400">
            Nessun dato per i campus attualmente disponibili.
          </div>
        )}
      </div>
    </div>
  );
}