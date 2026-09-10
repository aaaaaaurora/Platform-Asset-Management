import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface CategoryDistributionProps {
  distributionData: Record<string, number> | null;
}

export default function CategoryDistributionChart({ distributionData }: CategoryDistributionProps) {
  const labels = distributionData ? Object.keys(distributionData) : [];
  const series = distributionData ? Object.values(distributionData) : [];

  const hasData = series.length > 0 && series.some((val) => val > 0);

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
            total: { show: true, label: 'Totale Asset', color: '#64748B', fontSize: '12px', fontWeight: 700 }
          }
        },
      },
    },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    tooltip: { theme: 'light', y: { formatter: (val) => `${val}` } }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-6">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Ripartizione Categorie</h4>
        <p className="text-sm font-medium text-slate-500">Asset attivi divisi per tipologia</p>
      </div>

      <div className="flex-1 flex items-center justify-center">
        {hasData ? (
          <ReactApexChart options={options} series={series} type="donut" height={320} width="100%" />
        ) : (
          <div className="text-sm font-medium text-slate-400">
            Nessuna categoria censita.
          </div>
        )}
      </div>
    </div>
  );
}