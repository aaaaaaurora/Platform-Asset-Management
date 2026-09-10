import ReactApexChart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';

interface TimeSeriesData {
  date: string;
  count: number;
}

interface TimeSeriesChartProps {
  timeSeries: TimeSeriesData[] | null;
}

export default function TimeSeriesChart({ timeSeries }: TimeSeriesChartProps) {
  const hasData = timeSeries && timeSeries.length > 0;

  const categories = hasData ? timeSeries.map((item) => item.date) : [];
  const seriesData = hasData ? timeSeries.map((item) => item.count) : [];

  const options: ApexOptions = {
    chart: { 
      type: 'area', 
      toolbar: { show: false }, 
      fontFamily: 'inherit',
      zoom: { enabled: false },
      locales: [{
        name: 'it',
        options: {
          months: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
          shortMonths: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'],
          days: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
          shortDays: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
          toolbar: {
            download: 'Scarica',
            selection: 'Selezione',
            selectionZoom: 'Zoom Selezione',
            zoomIn: 'Zoom In',
            zoomOut: 'Zoom Out',
            pan: 'Sposta',
            reset: 'Ripristina Zoom',
          }
        }
      }],
      defaultLocale: 'it'
    },
    colors: ['#3B82F6'],
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.05,
        stops: [0, 100]
      }
    },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 3 },
    xaxis: {
      type: 'datetime',
      categories: categories,
      labels: {
        format: 'dd MMM',
        style: { colors: '#64748B', fontSize: '12px', fontWeight: 600 }
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false }
    },
    yaxis: {
      title: { text: 'Bilancio Asset (Creati - Eliminati)', style: { color: '#64748B', fontWeight: 600 } },
      labels: {
        minWidth: 40, // Previene il taglio dei numeri a sinistra
        formatter: (val) => Math.floor(val).toString(),
        style: { colors: '#64748B', fontSize: '12px', fontWeight: 600 }
      }
    },
    grid: {
      borderColor: '#E2E8F0',
      strokeDashArray: 4,
      padding: { left: 15, right: 15 }, // Aggiunge respiro laterale al grafico
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } }
    },
    tooltip: {
      theme: 'light',
      x: { format: 'dd MMMM yyyy' },
      y: { formatter: (val) => `${val} Asset netti` }
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 h-full flex flex-col">
      <div className="mb-4">
        <h4 className="text-xl font-extrabold text-slate-900 dark:text-white">Andamento Temporale</h4>
        <p className="text-sm font-medium text-slate-500">Evoluzione netta del patrimonio asset nel tempo</p>
      </div>

      <div className="flex-1 min-h-[300px] w-full">
        {hasData ? (
          <ReactApexChart options={options} series={[{ name: 'Bilancio', data: seriesData }]} type="area" height="100%" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400">
            Nessun dato storico disponibile per questo periodo.
          </div>
        )}
      </div>
    </div>
  );
}