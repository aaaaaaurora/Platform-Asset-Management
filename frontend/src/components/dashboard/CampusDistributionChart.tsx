import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface CampusDistributionProps {
  distributionData: Record<string, number> | null;
}

export default function CampusDistributionChart({ distributionData }: CampusDistributionProps) {
  const labels = distributionData ? Object.keys(distributionData) : [];
  const seriesData = distributionData ? Object.values(distributionData) : [];

  const hasData = seriesData.length > 0 && seriesData.some((val) => val > 0);

  // Calcolo dinamico dell'altezza: garantisce leggibilità su mobile anche con 20 campus.
  // 55px per ogni barra, con un minimo garantito di 300px.
  const dynamicHeight = Math.max(300, labels.length * 55);

  const options: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: ['#10B981'], // Tailwind Emerald 500
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 6,
        columnWidth: '60%',
        dataLabels: { position: 'top' }
      },
    },
    dataLabels: { 
      enabled: true, 
      offsetX: 15,
      style: { colors: ['#475569'], fontSize: '13px', fontWeight: 800 }
    },
    xaxis: {
      categories: labels,
      title: { text: 'Volume Asset Attivi', style: { color: '#64748B', fontWeight: 600 } },
      labels: { style: { colors: '#64748B', fontWeight: 600 } }
    },
    yaxis: {
      labels: { style: { colors: '#475569', fontSize: '13px', fontWeight: 600 } }
    },
    grid: {
      borderColor: '#E2E8F0',
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
    },
    tooltip: { theme: 'light' }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-4">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Distribuzione Territoriale</h4>
        <p className="text-sm font-medium text-slate-500">Confronto volumi tra poli universitari</p>
      </div>

      <div className="flex-1 w-full overflow-x-hidden overflow-y-auto">
        {hasData ? (
          <ReactApexChart options={options} series={[{ name: 'Asset', data: seriesData }]} type="bar" height={dynamicHeight} />
        ) : (
          <div className="flex h-[300px] items-center justify-center text-sm font-medium text-slate-400">
            Nessun dato per i campus attualmente disponibili.
          </div>
        )}
      </div>
    </div>
  );
}