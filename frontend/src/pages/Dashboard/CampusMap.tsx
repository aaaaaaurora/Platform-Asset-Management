import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import Map, { Source, Layer, MapRef, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../context/AuthContext';
import WarningFormModal from '../../components/guest/WarningFormModal';
import Supercluster from 'supercluster';

// Funzione ausiliaria per verificare se un punto [lng, lat] si trova dentro un poligono GeoJSON (Ray-casting algorithm)
function isPointInPolygon(point: [number, number], polygonCoords: number[][][]) {
  const [x, y] = point;
  let inside = false;
  
  for (const ring of polygonCoords) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function AuthorizedImage({ mediaId, token }: { mediaId: string; token: string }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchImage = async () => {
      try {
        const response = `${import.meta.env.VITE_API_URL}/media/images/${mediaId}`;
        const res = await fetch(response, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const blob = await res.blob();
          if (isMounted) {
            setImageSrc(URL.createObjectURL(blob));
          }
        }
      } catch (err) {
        console.error("Errore caricamento immagine:", err);
      }
    };
    fetchImage();
    return () => {
      isMounted = false;
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [mediaId, token]);

  if (!imageSrc) {
    return (
      <div className="h-48 w-full bg-gray-100 dark:bg-meta-4 animate-pulse rounded-lg flex items-center justify-center text-xs text-gray-500">
        Caricamento immagine...
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt="Immagine Asset"
      className="h-48 w-full object-cover rounded-lg shadow-sm border border-stroke dark:border-strokedark bg-gray-100 dark:bg-meta-4"
    />
  );
}

export default function CampusMap() {
  const mapRef = useRef<MapRef>(null);
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'AMMINISTRATORE';

  const focusAssetId = location.state?.focusAssetId;
  const focusCampusId = location.state?.focusCampusId;

  const [viewState, setViewState] = useState({ longitude: 14.7900, latitude: 40.7700, zoom: 15, pitch: 45, bearing: 0 });
  const [campuses, setCampuses] = useState<any[]>([]);
  const [isInitializingLocation, setIsInitializingLocation] = useState(true); // Stato per lo spinner iniziale
  
  // FILTRO CAMPUS (Singolo)
  const [selectedCampus, setSelectedCampus] = useState<string>('');
  const [isCampusDropdownOpen, setIsCampusDropdownOpen] = useState(false);
  
  // FILTRI AGGIUNTIVI
  const [selectedCategoriesAdmin, setSelectedCategoriesAdmin] = useState<string[]>([]);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [dynamicFilters, setDynamicFilters] = useState<Record<string, string>>({});
  
  const [categories, setCategories] = useState<any[]>([]);
  const [maxBounds, setMaxBounds] = useState<[number, number, number, number] | undefined>(undefined);
  const [userLocation, setUserLocation] = useState<{longitude: number, latitude: number} | null>(null);

  const [assets, setAssets] = useState<any[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const [permissionLimitationMsg, setPermissionLimitationMsg] = useState<string | null>(null);
  
  const [clusters, setClusters] = useState<any[]>([]);

  // 1. Geolocalizzazione iniziale con blocco dello spinner
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = { longitude: position.coords.longitude, latitude: position.coords.latitude };
          setUserLocation(coords);
          
          if (!focusCampusId) {
            setViewState(prev => ({ ...prev, ...coords }));
          }
          setIsInitializingLocation(false);
        },
        (error) => {
          console.warn("Geolocalizzazione negata o fallita.", error);
          if (error.code === 1) { 
            setPermissionLimitationMsg("Consenso GPS rifiutato. L'utente senza GPS è limitato nella visualizzazione e ricerca degli asset intorno a lui.");
          }
          if (!focusCampusId) {
            const defaultCoords = { longitude: 14.7900, latitude: 40.7700 };
            setViewState(prev => ({ ...prev, ...defaultCoords }));
          }
          setIsInitializingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setIsInitializingLocation(false);
    }
  }, [focusCampusId]);

  // 2. Caricamento Campus e Categorie + Logica di auto-selezione basata sul perimetro (Geo-fencing)
  useEffect(() => {
    if (user) {
      const fetchStaticData = async () => {
        try {
          const [campusesRes, categoriesRes] = await Promise.all([
            fetch(`${import.meta.env.VITE_API_URL}/geozone/api/geozones/campuses`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${import.meta.env.VITE_API_URL}/asset/api/categories`, { headers: { 'Authorization': `Bearer ${token}` } })
          ]);

          if (campusesRes.ok) {
            const realCampuses = await campusesRes.json();
            setCampuses(realCampuses);
            
            if (focusCampusId && realCampuses.some((c: any) => c.id === focusCampusId)) {
              setSelectedCampus(focusCampusId);
            } else if (userLocation) {
              // Verifica automatica se l'utente si trova all'interno di un perimetro campus
              const matchedCampus = realCampuses.find((c: any) => {
                if (c.geometry && c.geometry.type === 'Polygon' && c.geometry.coordinates) {
                  return isPointInPolygon([userLocation.longitude, userLocation.latitude], c.geometry.coordinates);
                }
                return false;
              });

              if (matchedCampus) {
                setSelectedCampus(matchedCampus.id);
              }
            }
          }

          if (categoriesRes.ok) {
            setCategories(await categoriesRes.json());
          }
        } catch (error) { 
          console.error("Errore nel recupero dati statici:", error); 
        }
      };

      fetchStaticData(); 
    }
  }, [user, token, focusCampusId, userLocation]);

  // Gestione Reset Filtri Dinamici al cambio categoria
  useEffect(() => {
    setDynamicFilters({});
  }, [selectedCategoriesAdmin]);

  // 3. Recupero Asset con protezione contro le race conditions
  useEffect(() => {
    let isActive = true;

    const fetchAllMapAssets = async () => {
      if (!token || !selectedCampus) {
        if (isActive) setAssets([]);
        return;
      }

      try {
        const limit = 500; 
        const baseUrl = import.meta.env.VITE_API_URL || '';
        
        const params = new URLSearchParams();
        params.append('campus_id', selectedCampus);
        params.append('limit', limit.toString());
        params.append('page', '1');
        
        if (isAdmin && selectedCategoriesAdmin.length > 0) {
          params.append('category_id', selectedCategoriesAdmin.join(','));
        } else if (!isAdmin && user?.category_id) {
          params.append('category_id', user.category_id);
        }

        Object.entries(dynamicFilters).forEach(([key, value]) => {
          if (value) params.append(`attr_${key}`, value);
        });

        const url = `${baseUrl}/asset/api/assets?${params.toString()}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Errore nel recupero asset');
        const data = await response.json();
        
        let allFetchedAssets = data.assets || [];
        const totalPages = data.pagination?.total_pages || 1;

        if (totalPages > 1) {
          const fetchPromises = [];
          for (let i = 2; i <= totalPages; i++) {
            params.set('page', i.toString());
            fetchPromises.push(
              fetch(`${baseUrl}/asset/api/assets?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              }).then(res => res.json())
            );
          }

          const pagineSuccessive = await Promise.all(fetchPromises);
          pagineSuccessive.forEach(pageData => {
            if (pageData.assets) {
              allFetchedAssets = [...allFetchedAssets, ...pageData.assets];
            }
          });
        }
        
        if (!isAdmin && user?.category_id) {
          allFetchedAssets = allFetchedAssets.filter((a: any) => a.category_id === user.category_id);
        }

        if (isActive) {
          setAssets(allFetchedAssets);
        }
        
      } catch (error) { 
        console.error("Errore nel recupero massivo degli asset per la mappa:", error); 
      }
    };
    
    if (selectedCampus) {
      fetchAllMapAssets();
    } else {
      if (isActive) setAssets([]); 
    }

    return () => {
      isActive = false;
    };
  }, [selectedCampus, token, user, selectedCategoriesAdmin, dynamicFilters, isAdmin]);

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

  const toggleCategoryAdmin = (id: string) => {
    setSelectedCategoriesAdmin(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const handleDynamicFilterChange = (attrName: string, value: string) => {
    setDynamicFilters(prev => ({ ...prev, [attrName]: value }));
  };

  const activeCategoriesForFilters = isAdmin 
    ? categories.filter(c => selectedCategoriesAdmin.includes(c._id))
    : categories.filter(c => c._id === user?.category_id);

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

  const supercluster = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 18 });
    const points = assets.map(asset => ({
      type: 'Feature' as const,
      properties: { cluster: false, assetId: asset._id, asset },
      geometry: { type: 'Point' as const, coordinates: asset.geometry.coordinates }
    }));
    sc.load(points);
    return sc;
  }, [assets]);

  useEffect(() => {
    if (mapRef.current) {
      const bounds = mapRef.current.getBounds();
      if (bounds) {
        const bbox: [number, number, number, number] = [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth()
        ];
        const zoom = Math.round(viewState.zoom);
        setClusters(supercluster.getClusters(bbox, zoom));
      }
    }
  }, [assets, viewState, supercluster, maxBounds]);

  return (
    <div className="flex flex-col h-[750px] w-full relative mb-10">
      
      {/* SPINNER DI CARICAMENTO INIZIALE GPS */}
      {isInitializingLocation && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm transition-all">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-3"></div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Rilevamento posizione...</p>
        </div>
      )}

      {campuses.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 shrink-0">
          <div className={`grid grid-cols-1 ${isAdmin ? 'sm:grid-cols-2' : ''} gap-6`}>
            
            {/* FILTRO CAMPUS (Singolo) */}
            <div className="relative">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Filtro Campus
              </label>
              <div 
                onClick={() => setIsCampusDropdownOpen(!isCampusDropdownOpen)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
              >
                <span className={`truncate pr-2 ${selectedCampus === '' ? 'text-slate-400 dark:text-slate-500 font-normal italic' : 'font-semibold'}`}>
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
                    
                    {/* Opzione segnaposto non cliccabile */}
                    <div className="px-4 py-3 h-12 flex items-center text-sm text-slate-400 dark:text-slate-500 italic bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 select-none">
                      Seleziona un campus...
                    </div>

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

            {isAdmin && (
              <div className="relative">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Filtro Categoria
                </label>
                <div 
                  onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-white outline-none cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400"
                >
                  <span className="truncate pr-2">
                    {selectedCategoriesAdmin.length === 0 
                      ? "Tutte le Categorie" 
                      : selectedCategoriesAdmin.length === 1 
                        ? categories.find(c => c._id === selectedCategoriesAdmin[0])?.name || 'Categoria Selezionata'
                        : `${selectedCategoriesAdmin.length} Categorie selezionate`}
                  </span>
                  <svg className={`w-4 h-4 text-slate-500 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {isCategoryDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsCategoryDropdownOpen(false)}></div>
                    <div className="absolute z-20 w-full left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto animate-fade-in-up">
                      <div 
                        className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-bold text-slate-700 dark:text-white border-b border-slate-100 dark:border-slate-700 transition-colors"
                        onClick={() => { setSelectedCategoriesAdmin([]); setIsCategoryDropdownOpen(false); }}
                      >
                        <div className="w-4 mr-3 flex-none"></div>
                        Tutte le Categorie
                      </div>
                      {categories.map((category) => (
                        <label key={category._id} className="flex items-center px-4 py-3 h-12 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                          <input
                            type="checkbox"
                            checked={selectedCategoriesAdmin.includes(category._id)}
                            onChange={() => toggleCategoryAdmin(category._id)}
                            className="mr-3 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 cursor-pointer"
                          />
                          <span className="truncate">{category.name}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* FILTRI DINAMICI SUDDIVISI PER CATEGORIA */}
        {/* FILTRI DINAMICI COMPATTI PER CATEGORIA */}
        {activeCategoriesForFilters.length > 0 && activeCategoriesForFilters.some(cat => cat.attributes?.some((attr: any) => attr.filterable && attr.status !== 'unavailable')) && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Filtri Specifici per Categoria
            </span>
            
            <div className="flex flex-wrap items-center gap-4">
              {activeCategoriesForFilters.map(cat => {
                const catAttributes = cat.attributes?.filter((attr: any) => attr.filterable && attr.status !== 'unavailable') || [];
                if (catAttributes.length === 0) return null;

                return (
                  <div key={cat._id} className="flex flex-wrap items-center gap-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                    {/* Badge Categoria */}
                    <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-slate-700">
                      <span className="text-sm">{cat.icon || '📌'}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                        {cat.name}
                      </span>
                    </div>

                    {/* Controlli compatti */}
                    <div className="flex flex-wrap items-center gap-3">
                      {catAttributes.map((attr: any) => (
                        <div key={attr.name} className="flex items-center gap-1.5">
                          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 capitalize whitespace-nowrap">
                            {attr.name.replace('_', ' ')}:
                          </label>
                          
                          {attr.type === 'enum' ? (
                            <select 
                              value={dynamicFilters[`${cat._id}_${attr.name}`] || ''}
                              onChange={(e) => handleDynamicFilterChange(`${cat._id}_${attr.name}`, e.target.value)}
                              className="rounded border border-slate-300 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-800 dark:text-white outline-none focus:border-blue-500"
                            >
                              <option value="">Tutti</option>
                              {attr.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          ) : attr.type === 'boolean' ? (
                             <select 
                              value={dynamicFilters[`${cat._id}_${attr.name}`] || ''}
                              onChange={(e) => handleDynamicFilterChange(`${cat._id}_${attr.name}`, e.target.value)}
                              className="rounded border border-slate-300 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-800 dark:text-white outline-none focus:border-blue-500"
                            >
                              <option value="">Tutti</option>
                              <option value="true">Sì</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input 
                              type={attr.type === 'number' ? 'number' : 'text'}
                              value={dynamicFilters[`${cat._id}_${attr.name}`] || ''}
                              onChange={(e) => handleDynamicFilterChange(`${cat._id}_${attr.name}`, e.target.value)}
                              placeholder="Cerca..."
                              className="w-28 rounded border border-slate-300 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-800 dark:text-white outline-none focus:border-blue-500"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
          onLoad={() => {
            if (mapRef.current) {
              const bounds = mapRef.current.getBounds();
              if (bounds) {
                setClusters(supercluster.getClusters(
                  [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], 
                  Math.round(viewState.zoom)
                ));
              }
            }
          }}
        >
          {activeCampusData && (
            <Source id="campus-boundary" type="geojson" data={activeCampusData as any}>
              <Layer id="campus-fill" type="fill" paint={{ 'fill-color': '#3C50E0', 'fill-opacity': 0.2 }} />
              <Layer id="campus-outline" type="line" paint={{ 'line-color': '#3C50E0', 'line-width': 2 }} />
            </Source>
          )}

          {clusters.map(cluster => {
            const [longitude, latitude] = cluster.geometry.coordinates;
            const { cluster: isCluster, point_count: pointCount, asset } = cluster.properties;

            if (isCluster) {
              return (
                <Marker 
                  key={`cluster-${cluster.id}`} 
                  longitude={longitude} 
                  latitude={latitude}
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(cluster.id), 20);
                    mapRef.current?.flyTo({ center: [longitude, latitude], zoom: expansionZoom, speed: 1.2 });
                  }}
                >
                  <div className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-blue-600/90 text-white shadow-lg border-2 border-white font-bold hover:scale-110 transition-transform">
                    {pointCount}
                  </div>
                </Marker>
              );
            }

            return (
              <Marker 
                key={asset._id} 
                longitude={longitude} 
                latitude={latitude} 
                onClick={(e) => { 
                  e.originalEvent.stopPropagation(); 
                  setSelectedAsset(asset);
                }}
              >
                <div className="text-2xl cursor-pointer hover:scale-125 transition-transform">
                  {getAssetIcon(asset)}
                </div>
              </Marker>
            );
          })}

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

      {permissionLimitationMsg && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-boxdark border border-stroke dark:border-strokedark overflow-hidden animate-fade-in-up">
            <div className="p-5 text-center">
              <svg className="mx-auto mb-3 w-10 h-10 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="mb-2 text-lg font-bold text-black dark:text-white">Limitazioni Attive</h3>
              <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
                {permissionLimitationMsg}
              </p>
              <button 
                onClick={() => setPermissionLimitationMsg(null)} 
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                Ho capito
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
                      onClick={() => navigate('/assets/list', { state: { editAssetId: selectedAsset._id, editCampusId: selectedAsset.campus_id, fullAsset: selectedAsset } })}                      className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
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
                      <AuthorizedImage key={mediaId} mediaId={mediaId} token={token!} />
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