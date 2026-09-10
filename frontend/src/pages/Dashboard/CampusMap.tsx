import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import Map, { Source, Layer, MapRef, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../context/AuthContext';
import WarningFormModal from '../../components/guest/WarningFormModal'; 

export default function CampusMap() {
  const mapRef = useRef<MapRef>(null);
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const focusAssetId = location.state?.focusAssetId;
  const focusCampusId = location.state?.focusCampusId;

  const [viewState, setViewState] = useState({ longitude: 14.7900, latitude: 40.7700, zoom: 15, pitch: 45, bearing: 0 });
  const [campuses, setCampuses] = useState<any[]>([]);
  
  // MODIFICA: Inizializzato a vuoto per la selezione di default
  const [selectedCampus, setSelectedCampus] = useState<string>('');
  const [isCampusDropdownOpen, setIsCampusDropdownOpen] = useState(false);
  
  const [categories, setCategories] = useState<any[]>([]);
  const [maxBounds, setMaxBounds] = useState<[number, number, number, number] | undefined>(undefined);
  const [userLocation, setUserLocation] = useState<{longitude: number, latitude: number} | null>(null);

  const [assets, setAssets] = useState<any[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = { longitude: position.coords.longitude, latitude: position.coords.latitude };
          setUserLocation(coords);
          
          // Se non è stato imposto un campus specifico dal router, vai alla posizione utente
          if (!focusCampusId) {
            setViewState(prev => ({ ...prev, ...coords }));
          }
        },
        (error) => {
          console.warn("Geolocalizzazione negata o fallita. Uso coordinate di default.", error);
          if (!focusCampusId) {
            const defaultCoords = { longitude: 14.7900, latitude: 40.7700 };
            setViewState(prev => ({ ...prev, ...defaultCoords }));
          }
        }
      );
    }
  }, [focusCampusId]);

  useEffect(() => {
    if (user) {
      const fetchCampuses = async () => {
        try {
          const response = await fetch(`${import.meta.env.VITE_API_URL}/geozone/api/geozones/campuses`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!response.ok) throw new Error(`Errore HTTP: ${response.status}`);
          const realCampuses = await response.json();
          setCampuses(realCampuses);
          
          if (focusCampusId && realCampuses.some((c: any) => c.id === focusCampusId)) {
            setSelectedCampus(focusCampusId);
          } else {
            // MODIFICA: Assicura che si parta dalla voce vuota, non dal primo array
            setSelectedCampus('');
          }
        } catch (error) { console.error("Errore recupero campus:", error); }
      };

      const fetchCategories = async () => {
        try {
          const response = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/categories`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            setCategories(await response.json());
          }
        } catch (error) { console.error("Errore recupero categorie:", error); }
      };

      fetchCampuses();
      fetchCategories(); 
    }
  }, [user, token, focusCampusId]);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const params = new URLSearchParams();
        if (selectedCampus) params.append('campus_id', selectedCampus);
        
        // Se l'utente è un operatore, richiediamo al backend solo gli asset della sua categoria
        if (user?.role === 'OPERATORE' && user?.category_id) {
          params.append('category_id', user.category_id);
        }

        const url = `${import.meta.env.VITE_API_URL}/asset/api/assets?${params.toString()}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Errore nel recupero asset');
        const data = await response.json();
        
        let fetchedAssets = data.assets || [];
        
        // Filtro di sicurezza aggiuntivo lato frontend
        if (user?.role === 'OPERATORE' && user?.category_id) {
          fetchedAssets = fetchedAssets.filter((a: any) => a.category_id === user.category_id);
        }

        setAssets(fetchedAssets);
      } catch (error) { console.error("Errore recupero asset:", error); }
    };
    
    // MODIFICA: Effettua il fetch degli asset solo se è stato effettivamente selezionato un campus
    if (selectedCampus) {
      fetchAssets();
    } else {
      setAssets([]); // Se torno su "Seleziona...", svuoto la mappa
    }
  }, [selectedCampus, token, user]);

  useEffect(() => {
      if (focusAssetId && assets.length > 0) {
        const assetToFocus = assets.find(a => a._id === focusAssetId);
        if (assetToFocus) {
          setSelectedAsset(assetToFocus);
          navigate(location.pathname, { replace: true, state: {} });
        }
      }
    }, [focusAssetId, assets, navigate, location.pathname]);

  useEffect(() => {
    const activeCampus = campuses.find(c => c.id === selectedCampus);
    if (activeCampus?.geometry?.coordinates && mapRef.current) {
      
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

      const extractCoords = (coords: any[]) => {
        if (typeof coords[0] === 'number') {
          if (coords[0] < minLng) minLng = coords[0];
          if (coords[0] > maxLng) maxLng = coords[0];
          if (coords[1] < minLat) minLat = coords[1];
          if (coords[1] > maxLat) maxLat = coords[1];
        } else if (Array.isArray(coords)) {
          coords.forEach(extractCoords);
        }
      };

      extractCoords(activeCampus.geometry.coordinates);

      if (minLng !== Infinity) {
        const lngBuffer = (maxLng - minLng) * 0.10;
        const latBuffer = (maxLat - minLat) * 0.10;
        
        const bounds: [number, number, number, number] = [
          minLng - lngBuffer, 
          minLat - latBuffer, 
          maxLng + lngBuffer, 
          maxLat + latBuffer
        ];

        setMaxBounds(bounds);

        mapRef.current.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: 30, duration: 1000 } 
        );
      }
    }
  }, [selectedCampus, campuses]);

  const categoryIconMap = useMemo(() => {
    const dict: Record<string, string> = {};
    categories.forEach(c => {
      dict[c._id] = c.icon || '📍';
    });
    return dict;
  }, [categories]);

  const getAssetIcon = (asset: any) => {
    return categoryIconMap[asset.category_id] || '📍';
  };

  const activeCampusData = useMemo(() => {
    const campus = campuses.find(c => c.id === selectedCampus);
    return campus?.geometry 
      ? { type: 'Feature', geometry: campus.geometry } 
      : null;
  }, [campuses, selectedCampus]);

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] w-full relative">
      
      {campuses.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 shrink-0">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative w-full">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Campus
              </label>
              <div 
                onClick={() => setIsCampusDropdownOpen(!isCampusDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className="truncate pr-2">
                  {selectedCampus === '' 
                    ? "Seleziona un campus..." 
                    : campuses.find(c => c.id === selectedCampus)?.name || 'Campus Selezionato'}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCampusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isCampusDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsCampusDropdownOpen(false)}></div>
                  <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                    {campuses.map((campus) => (
                      <div 
                        key={campus.id} 
                        className={`flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0 ${
                          selectedCampus === campus.id 
                            ? 'text-blue-600 dark:text-blue-400 font-bold bg-slate-50 dark:bg-slate-700/50' 
                            : 'text-slate-600 dark:text-slate-300 font-medium'
                        }`}
                        onClick={() => { 
                          setSelectedCampus(campus.id); 
                          setSelectedAsset(null); 
                          setIsCampusDropdownOpen(false); 
                        }}
                      >
                        <span className="truncate">{campus.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative flex-1 w-full overflow-hidden border rounded-xl border-stroke shadow-default dark:border-strokedark dark:bg-boxdark">
        <Map 
          ref={mapRef} 
          {...viewState} 
          onMove={evt => setViewState(evt.viewState)} 
          style={{ width: '100%', height: '100%' }} 
          mapStyle="https://tiles.openfreemap.org/styles/liberty" 
          interactive={true}
          maxBounds={maxBounds} 
        >
          {activeCampusData && (
            <Source id="campus-boundary" type="geojson" data={activeCampusData as any}>
              <Layer id="campus-fill" type="fill" paint={{ 'fill-color': '#3C50E0', 'fill-opacity': 0.2 }} />
              <Layer id="campus-outline" type="line" paint={{ 'line-color': '#3C50E0', 'line-width': 2 }} />
            </Source>
          )}

          {assets.map(asset => (
            <Marker 
              key={asset._id} 
              longitude={asset.geometry.coordinates[0]} 
              latitude={asset.geometry.coordinates[1]} 
              onClick={(e) => { 
                e.originalEvent.stopPropagation(); 
                setSelectedAsset(asset);
              }}
            >
              <div className="text-2xl cursor-pointer hover:scale-125 transition-transform">
                {getAssetIcon(asset)}
              </div>
            </Marker>
          ))}

          {userLocation && (
            <Marker longitude={userLocation.longitude} latitude={userLocation.latitude}>
              <div className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-blue-500 shadow-md"></span>
              </div>
            </Marker>
          )}
        </Map>
        
        {user?.role === 'OPERATORE' && (
          <button
            onClick={() => navigate('/assets/new')}
            className="absolute bottom-6 left-6 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-blue-700"
            title="Censisci Nuovo Asset"
          >
            <span className="text-3xl font-light leading-none mb-1">+</span>
          </button>
        )}
      </div>

      {selectedAsset && createPortal(
        <>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="relative flex flex-col w-full max-w-md max-h-[90vh] rounded-xl bg-white shadow-2xl dark:bg-boxdark border border-stroke dark:border-strokedark overflow-hidden">
              
              <div className="flex justify-between items-center p-5 border-b border-stroke dark:border-strokedark bg-white dark:bg-boxdark z-10">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-xl text-black dark:text-white">
                    Dettagli Asset
                  </h3>
                  {user?.role === 'OPERATORE' && user?.campus_ids?.includes(selectedAsset.campus_id) && user?.category_id === selectedAsset.category_id && (
                    <button 
                      onClick={() => navigate('/assets/list', { state: { editAssetId: selectedAsset._id, editCampusId: selectedAsset.campus_id } })}
                      className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                      title="Modifica Asset"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedAsset(null)} 
                  className="text-gray-500 hover:text-black dark:hover:text-white text-xl font-bold bg-gray-100 dark:bg-meta-4 rounded-full w-8 h-8 flex items-center justify-center transition"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                
                {selectedAsset.media_ids && selectedAsset.media_ids.length > 0 && (
                  <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
                    {selectedAsset.media_ids.map((mediaId: string) => (
                      <img
                        key={mediaId}
                        src={`${import.meta.env.VITE_API_URL}/media/images/${mediaId}`}
                        alt="Immagine Asset"
                        className="h-48 w-full object-cover rounded-lg shadow-sm border border-stroke dark:border-strokedark bg-gray-100 dark:bg-meta-4 flex items-center justify-center text-xs text-center text-gray-500"
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-2 text-sm mb-5">
                  {Object.entries(selectedAsset.metadata || {})
                    .filter(([key]) => {
                      const isDeprecated = categories.some(cat => 
                        cat.attributes?.some((attr: any) => attr.name === key && attr.status === 'unavailable')
                      );
                      return !isDeprecated;
                    })
                    .map(([key, val]) => (
                    <div key={key} className="flex justify-between items-center border-b border-stroke dark:border-strokedark pb-1">
                      <span className="font-semibold text-body capitalize">{key.replace('_', ' ')}</span>
                      <span className="text-black dark:text-white font-medium">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {(user?.role === 'GUEST') && (
                <div className="p-5 border-t border-stroke dark:border-strokedark bg-white dark:bg-boxdark z-10">
                  <button 
                    onClick={() => setIsWarningModalOpen(true)} 
                    className="flex w-full justify-center rounded p-3 font-medium text-white transition bg-red-600 hover:bg-red-700"
                  >
                    Segnala un problema
                  </button>
                </div>
              )}

            </div>
          </div>
          
          <WarningFormModal 
            isOpen={isWarningModalOpen} 
            onClose={() => setIsWarningModalOpen(false)} 
            assetId={selectedAsset._id} 
          />
        </>,
        document.body
      )}
    </div>
  );
}