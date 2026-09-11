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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Redirect temporizzato verso la lista dei campus
      setTimeout(() => {
        navigate('/admin/campuses');
      }, 2500);

    } catch (err: any) {
      setErrorMsg(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

      {/* HEADER ALLINEATO A SINISTRA */}
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

      {/* CONTENITORE CENTRATO PER BOX E MESSAGGI */}
      <div className="max-w-5xl mx-auto pb-4 w-full">
        
        {/* MESSAGGI DI STATO */}
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

        <div className="flex flex-col gap-6 items-stretch">
          
          {/* BLOCCO SUPERIORE: Informazioni Base */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-none">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">Informazioni Base</h3>
            </div>
            
            {/* Layout Flessibile: Campi di testo affiancati e larghi uguali, bottone al centro */}
            <div className="p-6 flex flex-col lg:flex-row gap-4 lg:gap-6 items-start flex-1">
              
              {/* Box Nome Identificativo (Metà larghezza) */}
              <div className="flex-1 w-full">
                <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Nome identificativo area <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setGeoJsonData(null); 
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isSearching && !isSaving && searchQuery.trim()) {
                      e.preventDefault();
                      handleSearchArea();
                    }
                  }}
                  disabled={isSaving}
                  placeholder="[Nome Università], [Sede]"
                  className="w-full resize-none rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white shadow-sm"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Il nome inserito verrà utilizzato per ricercare i confini.
                </p>
              </div>

              {/* Bottone "Trova Area" (Allineato in altezza ai campi) */}
              <div className="w-full lg:w-auto lg:mt-[24px] shrink-0">
                <button
                  onClick={handleSearchArea}
                  disabled={isSearching || isSaving || !searchQuery.trim()}
                  className="h-11 w-full lg:w-auto inline-flex items-center justify-center rounded-lg bg-slate-800 px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {isSearching ? 'Ricerca...' : 'Trova Area'}
                </button>
              </div>

              {/* Box Note Descrittive*/}
              <div className="flex-1 w-full">
                <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Descrizione
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSaving}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white shadow-sm"
                  placeholder="Inserisci dettagli aggiuntivi..."
                />
              </div>

            </div>
          </div>

          {/* BLOCCO INFERIORE: Anteprima Cartografica */}
          <div className="w-full bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-none">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">Anteprima Geografica</h3>
            </div>
            
            <div className="p-6 flex-1">
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

        {/* FOOTER AZIONI */}
        <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-end items-center gap-4">
          <div className="flex w-full sm:w-auto gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              disabled={isSaving}
              className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              onClick={handleSaveCampus}
              disabled={!geoJsonData || isSaving}
              className="flex-1 sm:flex-none px-8 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-400"
            >
              {isSaving ? 'Salvataggio...' : 'Conferma e Salva'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}