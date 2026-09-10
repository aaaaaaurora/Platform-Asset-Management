import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import CampusMapPreview from "../../components/admin/CampusMapPreview";

export default function CreateCampusPage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [description, setDescription] = useState("");
  const [geoJsonData, setGeoJsonData] = useState<any | null>(null);
  
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // =================================================================
  // Ricerca Area Geografica via Nominatim 
  // =================================================================
  const handleSearchArea = async () => {
    if (!searchQuery.trim()) {
      setErrorMsg("Campo nome vuoto: Inserisci il nome del campus per avviare la ricerca.");
      return;
    }

    setIsSearching(true);
    setErrorMsg("");
    setGeoJsonData(null);

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=geojson&polygon_geojson=1&countrycodes=it`);
      const data = await res.json();

      if (!data.features || data.features.length === 0) {
        throw new Error("Area non trovata: Impossibile recuperare corrispondenze valide.");
      }

      const polygonFeature = data.features.find(
        (f: any) => f.geometry && f.geometry.type === 'Polygon'
      );

      if (!polygonFeature) {
        throw new Error("Area trovata, ma non possiede un perimetro poligonale valido.");
      }

      // ESTRAZIONE NOME UFFICIALE: Prende il nome esatto da OSM, o la prima parte dell'indirizzo
      const officialName = polygonFeature.properties?.name || polygonFeature.properties?.display_name?.split(',')[0] || searchQuery.trim();
      
      // Sovrascrive il testo digitato dall'utente con il nome ufficiale formattato
      setSearchQuery(officialName);
      
      setGeoJsonData(polygonFeature.geometry);

    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  // =================================================================
  // Salvataggio nel Backend (Step 6 & 7)
  // =================================================================
  const handleSaveCampus = async () => {
    if (!searchQuery.trim() || !geoJsonData) {
      setErrorMsg("Assicurati di aver inserito un nome e generato correttamente il perimetro cartografico.");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${baseUrl}/geozone/api/geozones/campuses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: searchQuery.trim(),
          description: description.trim(),
          geometry: geoJsonData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        // Gestione esplicita errore duplicato (409) dettato dai requisiti
        if (response.status === 409) {
          throw new Error(`Campus già presente: Un campus con il nome '${searchQuery}' risulta già censito nel database.`);
        }
        throw new Error(data.error || "Errore sconosciuto durante il salvataggio.");
      }

      setSuccessMsg("Nuovo campus registrato con successo. Il perimetro è ora attivo. Attendere...");
      
      // Redirect temporizzato verso la lista dei campus
      setTimeout(() => {
        navigate('/admin/campuses');
      }, 2500);

    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageMeta
        title="Registrazione Nuovo Campus | Asset Management"
        description="Aggiungi un nuovo polo territoriale alla piattaforma tracciandone i confini."
      />

      <div className="mb-8 flex flex-col gap-2">
        <div>
          <button onClick={() => navigate('/admin/campuses')} className="text-sm font-semibold text-slate-500 hover:text-blue-600 mb-1 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Torna ai campus
          </button>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Nuovo Campus
          </h2>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ricerca un'area istituzionale per estrarne automaticamente i confini ufficiali e registrarla a sistema.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Colonna Sinistra: Form e Controlli */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            
            {errorMsg && (
              <div className="mb-6 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                {errorMsg}
              </div>
            )}
            
            {successMsg && (
              <div className="mb-6 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                {successMsg}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Nome Identificativo Area <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-col gap-2 xl:flex-row">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setGeoJsonData(null); // Resetta la mappa se l'utente cambia il nome
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isSearching && !isSaving && searchQuery.trim()) {
                        e.preventDefault();
                        handleSearchArea();
                      }
                    }}
                    disabled={isSaving}
                    placeholder="[Nome Università], [Comune]"
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white"
                  />
                  <button
                    onClick={handleSearchArea}
                    disabled={isSearching || isSaving || !searchQuery.trim()}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    {isSearching ? 'Ricerca...' : 'Trova Area'}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Il nome inserito verrà utilizzato per ricercare i confini geografici.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Note Descrittive (Opzionale)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSaving}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white"
                  placeholder="Inserisci dettagli aggiuntivi..."
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-100 pt-6 dark:border-slate-700">
              <button
                type="button"
                onClick={() => navigate(-1)}
                disabled={isSaving}
                className="rounded-lg px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Annulla
              </button>
              <button
                onClick={handleSaveCampus}
                disabled={!geoJsonData || isSaving}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? 'Salvataggio...' : 'Conferma e Salva'}
              </button>
            </div>
          </div>
        </div>

        {/* Colonna Destra: Anteprima Cartografica */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-4 text-lg font-bold text-slate-800 dark:text-white">Anteprima Geografica</h3>
            <CampusMapPreview geoJsonData={geoJsonData} />
            
            {geoJsonData && (
              <div className="mt-4 rounded-md bg-blue-50 p-3 border border-blue-100 dark:bg-slate-700 dark:border-slate-600">
                <div className="flex items-start">
                  <svg className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-blue-800 dark:text-slate-200">
                    Perimetro rilevato correttamente. Assicurati che l'area evidenziata copra l'esatta giurisdizione del polo universitario prima di salvare.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}