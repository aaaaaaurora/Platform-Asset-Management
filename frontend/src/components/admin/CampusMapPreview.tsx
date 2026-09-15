import { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

interface CampusMapPreviewProps {
  geoJsonData: any;
}

// Componente di utilità per ricalcolare i confini della mappa dinamicamente 
function MapBoundsUpdater({ geoJsonData }: { geoJsonData: any }) {
  const map = useMap();

  useEffect(() => {
    if (geoJsonData) {
      try {
        const geoJsonLayer = L.geoJSON(geoJsonData);
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch (e) {
        console.error("Errore nel calcolo dei confini:", e);
      }
    }
  }, [geoJsonData, map]);

  return null;
}

export default function CampusMapPreview({ geoJsonData }: CampusMapPreviewProps) {
  if (!geoJsonData) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50">
        <svg className="mb-2 h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-medium text-slate-500">Nessuna area geografica caricata</span>
      </div>
    );
  }

  return (
    <div className="relative z-0 h-96 w-full overflow-hidden rounded-lg border border-slate-300 shadow-sm dark:border-slate-600">
      <MapContainer 
        center={[40.77, 14.79]} 
        zoom={13} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON 
          data={geoJsonData} 
          style={{
            color: '#3b82f6', // blue-500
            weight: 3,
            fillColor: '#60a5fa', // blue-400
            fillOpacity: 0.2
          }} 
        />
        <MapBoundsUpdater geoJsonData={geoJsonData} />
      </MapContainer>
    </div>
  );
}