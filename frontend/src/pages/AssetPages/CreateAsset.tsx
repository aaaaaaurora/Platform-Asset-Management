import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import PageMeta from '../../components/common/PageMeta';
import { useAuth } from '../../context/AuthContext'; 
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

interface Attribute {
  name: string;
  type: string;
  required: boolean;
  options?: string[];
  status: string;
}

interface Category {
  _id: string;
  name: string;
  attributes: Attribute[];
}

interface PhotoData {
  file: File;
  preview: string;
  mediaId?: string;
}

const CreateAsset: React.FC = () => {
  const { user, token } = useAuth();

  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryObj, setSelectedCategoryObj] = useState<Category | null>(null);

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [matchedCampusId, setMatchedCampusId] = useState<string | null>(null); 
  
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<any>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [metadata, setMetadata] = useState<Record<string, any>>({});

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOperator = user?.role === 'OPERATORE';

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/categories`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('Errore nel recupero delle categorie');
        const data = await response.json();
        setCategories(data);
      } catch (err) {
        setError("Impossibile caricare le categorie dal server.");
      }
    };

    if (token) fetchCategories();
  }, [token]);

  useEffect(() => {
    if (isOperator && user?.category_id && categories.length > 0) {
      setSelectedCategory(user.category_id);
      const catObj = categories.find(c => c._id === user.category_id);
      if (catObj) {
        setSelectedCategoryObj(catObj);
      }
    }
  }, [isOperator, user, categories]);

  const captureLocation = async () => {
    setLoading('Acquisizione e validazione GPS...');
    setError(null);
    
    const campusList = user?.campus_ids || [];
    if (campusList.length === 0) {
      setError('Nessun campus assegnato al tuo profilo.');
      setLoading(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError("Il browser non supporta la geolocalizzazione.");
      setLoading(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        try {
          const validationPromises = campusList.map(async (campusId: string) => {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/geozone/api/geozones/verify-location`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ campusId, latitudine: lat, longitudine: lng })
            });
            if (!res.ok) throw new Error(`Errore API per il campus ${campusId}`);
            const data = await res.json();
            return { campusId, isInside: data.is_inside };
          });

          const results = await Promise.allSettled(validationPromises);
          const validResult = results.find(
            (r): r is PromiseFulfilledResult<{campusId: string, isInside: boolean}> => r.status === 'fulfilled' && r.value.isInside
          );

          if (validResult && validResult.status === 'fulfilled') {
            setLocation({ lat, lng });
            setMatchedCampusId(validResult.value.campusId);
          } else {
            setError("Coordinate fuori perimetro! Ti trovi all'esterno di tutti i campus a te assegnati.");
          }
        } catch (err: any) {
          setError(`Impossibile validare il perimetro: ${err.message}. (Bypass attivo per test)`);
          setLocation({ lat, lng }); 
          setMatchedCampusId(campusList[0]);
        } finally {
          setLoading(null);
        }
      },
      (error) => {
        if (error.code === 1) { // PERMISSION_DENIED
          setError("Senza il permesso GPS, il censimento degli asset è bloccato e limitato per l'operatore. Concedi i permessi dalle impostazioni del dispositivo.");
        } else {
          setError(`Errore GPS: ${error.message}`);
        }
        setLoading(null);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const processSelectedFiles = (newFiles: File[]) => {
    const newPhotos = newFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
  };

  const removePhoto = (index: number) => {
    const photoToRemove = photos[index];
    if (photoToRemove.mediaId) {
      fetch(`${import.meta.env.VITE_API_URL}/media/images/${photoToRemove.mediaId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => console.error("Errore cancellazione foto singola:", err));
    }
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const takePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const permissions = await Camera.checkPermissions();
        if (permissions.camera !== 'granted') {
          const request = await Camera.requestPermissions({ permissions: ['camera'] });
          if (request.camera !== 'granted') {
            throw new Error("Senza accesso alla fotocamera, il censimento è limitato e incompleto per l'operatore. Concedi i permessi dalle impostazioni del dispositivo.");
          }
        }

        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera
        });

        if (image.webPath) {
          const response = await fetch(image.webPath);
          const blob = await response.blob();
          const file = new File([blob], `camera_${Date.now()}.jpg`, { type: `image/${image.format || 'jpeg'}` });
          processSelectedFiles([file]);
        }
      } catch (err: any) {
        if (err.message !== 'User cancelled photos app') {
          setError(err.message.includes('Senza accesso') ? err.message : `Errore Fotocamera: ${err.message}`);
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const pickFromGallery = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const permissions = await Camera.checkPermissions();
        if (permissions.photos !== 'granted') {
          const request = await Camera.requestPermissions({ permissions: ['photos'] });
          if (request.photos !== 'granted') {
            throw new Error("Senza accesso alla galleria, il censimento è limitato e incompleto per l'operatore. Concedi i permessi dalle impostazioni del dispositivo.");
          }
        }

        const gallery = await Camera.pickImages({
          quality: 90,
          limit: 0 
        });
        
        const fetchedFiles = await Promise.all(gallery.photos.map(async (image, idx) => {
          if (image.webPath) {
            const response = await fetch(image.webPath);
            const blob = await response.blob();
            return new File([blob], `gallery_${Date.now()}_${idx}.jpg`, { type: `image/${image.format || 'jpeg'}` });
          }
          return null;
        }));
        
        processSelectedFiles(fetchedFiles.filter(Boolean) as File[]);
      } catch (err: any) {
        if (err.message !== 'User cancelled photos app') {
           setError(err.message.includes('Senza accesso') ? err.message : `Errore Galleria: ${err.message}`);
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleWebPhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processSelectedFiles(Array.from(e.target.files));
    }
  };

  const executeCancelProcess = async () => {
    setIsCancelModalOpen(false); 
    
    photos.forEach(p => {
      if (p.mediaId) {
        fetch(`${import.meta.env.VITE_API_URL}/media/images/${p.mediaId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(e => console.error("Errore pulizia file:", e));
      }
    });
    
    setStep(1);
    setLocation(null);
    setPhotos([]);
    setAiSuggestions(null);
    setMetadata({});
    setMatchedCampusId(null);
    
    if (!isOperator) {
      setSelectedCategory('');
      setSelectedCategoryObj(null);
    }
  };

  const closeSuccessModal = () => {
    setIsSuccessModalOpen(false);
    setStep(1);
    setLocation(null);
    setPhotos([]);
    setAiSuggestions(null);
    setMetadata({});
    setMatchedCampusId(null);

    if (!isOperator) {
      setSelectedCategory('');
      setSelectedCategoryObj(null);
    }
  };

  const handleNextStep1 = () => {
    if (!location) {
      setError("La posizione GPS è obbligatoria per il censimento.");
      return;
    }
    if (photos.length === 0) {
      setError("Senza l'accesso alla fotocamera/galleria il censimento è limitato. Inserisci almeno una foto.");
      return;
    }

    if (isOperator && selectedCategoryObj) {
      triggerAIAnalysis();
    } else {
      setStep(2);
    }
  };

  const triggerAIAnalysis = async () => {
    if (!selectedCategory || photos.length === 0) return;
    
    setError(null);
    setLoading('Upload in corso...');

    try {
      const photosToUpload = photos.filter(p => !p.mediaId);
      let updatedPhotos = [...photos];

      if (photosToUpload.length > 0) {
        const formData = new FormData();
        photosToUpload.forEach(p => formData.append('images', p.file));

        const uploadRes = await fetch(`${import.meta.env.VITE_API_URL}/media/images/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }, 
          body: formData
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || uploadData.errors?.length > 0) {
          throw new Error(uploadData.errors?.[0]?.error || "Errore durante l'upload su MinIO.");
        }

        let uploadIdx = 0;
        updatedPhotos = updatedPhotos.map(p => {
          if (!p.mediaId && uploadData.uploaded[uploadIdx]) {
            const newId = uploadData.uploaded[uploadIdx].media_id;
            uploadIdx++;
            return { ...p, mediaId: newId };
          }
          return p;
        });
        setPhotos(updatedPhotos);
      }

      setLoading('Analisi Computer Vision in corso...');
      const allMediaIds = updatedPhotos.map(p => p.mediaId).filter(Boolean) as string[];
      
      const analyzePromises = allMediaIds.map(id => 
        fetch(`${import.meta.env.VITE_API_URL}/media/images/${id}/analyze`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(res => res.json())
      );

      const analyzeResults = await Promise.all(analyzePromises);

      let bestSuggestion: any = null;
      const aggregatedTags = new Set<string>();

      analyzeResults.forEach(data => {
        if (data.status === "success" || data.status === "degraded") {
          const sug = data.suggestions;
          if (sug) {
            if (sug.tags) sug.tags.forEach((t: string) => aggregatedTags.add(t));
            if (!bestSuggestion || (sug.confidence_score > bestSuggestion.confidence_score)) {
              bestSuggestion = sug;
            }
          }
        }
      });

      if (bestSuggestion && selectedCategoryObj) {
        setAiSuggestions({
          suggested_title: bestSuggestion.suggested_title,
          confidence_score: bestSuggestion.confidence_score,
          tags: Array.from(aggregatedTags)
        });

        // Modifica: Cerca solo tra gli attributi stringa ATTIVI
        const primaryTextAttr = selectedCategoryObj.attributes.find(attr => attr.type === 'string' && attr.status !== 'unavailable');

        if (primaryTextAttr) {
          setMetadata(prev => ({ 
            ...prev, 
            [primaryTextAttr.name]: prev[primaryTextAttr.name] || bestSuggestion.suggested_title 
          }));
        }
      }

      setStep(3);
    } catch (err: any) {
      setError(`Errore Processo Media/IA: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const handleMetadataChange = (key: string, value: any) => {
    setMetadata(prev => ({ ...prev, [key]: value }));
  };

  const submitAsset = async () => {
    setLoading('Salvataggio asset in corso...');
    setError(null);
    
    try {
      const finalMediaIds = photos.map(p => p.mediaId).filter(Boolean);
      const payload = {
        category_id: selectedCategory,
        campus_id: matchedCampusId,
        media_ids: finalMediaIds, 
        media_id: finalMediaIds[0] || null, 
        geometry: { type: 'Point', coordinates: [location?.lng, location?.lat] },
        metadata: metadata
      };

      const response = await fetch(`${import.meta.env.VITE_API_URL}/asset/api/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Errore durante il salvataggio sul server');
      }

      setIsSuccessModalOpen(true);
      
    } catch (err: any) {
      setError(err.message || 'Errore imprevisto durante il salvataggio.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <PageMeta title="Nuovo Asset | Asset Management UNISA" description='' />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Censimento Nuovo Asset
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Registra un nuovo elemento sul territorio con l'ausilio dell'Intelligenza Artificiale.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
          
          <div className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 py-2.5 px-4 flex justify-between items-center">
            <h3 className="font-bold text-base text-slate-800 dark:text-white">
              {isOperator ? `Fase ${step === 3 ? 2 : 1} di 2` : `Fase ${step} di 3`}
            </h3>
            <div className="flex gap-2">
              {isOperator ? (
                [1, 2].map((i) => (
                  <div key={i} className={`h-2 w-8 rounded-full transition-colors ${((step === 1 && i === 1) || (step === 3 && i >= 1)) ? 'bg-blue-600 shadow-sm' : 'bg-slate-200 dark:bg-slate-700'}`}></div>
                ))
              ) : (
                [1, 2, 3].map((i) => (
                  <div key={i} className={`h-2 w-8 rounded-full transition-colors ${step >= i ? 'bg-blue-600 shadow-sm' : 'bg-slate-200 dark:bg-slate-700'}`}></div>
                ))
              )}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {error && (
              <div className="mb-4 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-3 text-rose-800 shadow-sm dark:bg-rose-900/20 dark:text-rose-400">
                <p className="font-semibold text-xs">{error}</p>
              </div>
            )}
 
            {step === 1 && (
              <div className="space-y-5">
                {isOperator && selectedCategoryObj && (
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                      Categoria Assegnata
                    </label>
                    <div className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300">
                      {selectedCategoryObj.name}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                    {isOperator ? '1. Posizione GPS e Validazione' : '1. Posizione GPS e Validazione'}
                  </label>
                  {location ? (
                    <div className="w-full rounded-lg border border-emerald-500 bg-emerald-50 py-2 px-3 text-emerald-700 text-sm font-semibold shadow-sm flex items-center gap-2 dark:bg-emerald-900/20 dark:text-emerald-400">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Coordinate acquisite: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                    </div>
                  ) : (
                    <button 
                      onClick={captureLocation}
                      disabled={!!loading}
                      className="flex w-full justify-center items-center rounded-lg bg-blue-600 p-2 text-sm font-bold text-white transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      {loading === 'Acquisizione e validazione GPS...' ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          Validazione in corso...
                        </span>
                      ) : 'Ottieni Posizione GPS'}
                    </button>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                    {isOperator ? "2. Foto dell'Asset" : "2. Foto dell'Asset"}
                  </label>
                  <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleWebPhotoCapture} className="hidden" />
                  
                  {photos.length > 0 ? (
                    <div className="space-y-3 mt-1">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {photos.map((p, index) => (
                          <div key={index} className="relative group aspect-square rounded-lg border border-slate-200 overflow-hidden shadow-sm dark:border-slate-700">
                            <img src={p.preview} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" />
                            <button 
                              onClick={() => removePhoto(index)}
                              className="absolute top-1.5 right-1.5 flex items-center justify-center w-7 h-7 bg-rose-500/90 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 shadow-sm"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      
                      <div className="flex gap-2">
                        {Capacitor.isNativePlatform() ? (
                          <>
                            <button onClick={takePhoto} className="flex-1 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors">
                              📷 Fotocamera
                            </button>
                            <button onClick={pickFromGallery} className="flex-1 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors">
                              🖼️ Galleria
                            </button>
                          </>
                        ) : (
                          <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors">
                            📷 Aggiungi Foto
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={Capacitor.isNativePlatform() ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
                      {Capacitor.isNativePlatform() ? (
                        <>
                          <button 
                            onClick={takePhoto} 
                            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-5 hover:bg-slate-100 hover:border-slate-400 transition-colors dark:bg-slate-800 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                          >
                            <svg className="h-7 w-7 text-slate-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Fotocamera</span>
                          </button>

                          <button 
                            onClick={pickFromGallery} 
                            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-5 hover:bg-slate-100 hover:border-slate-400 transition-colors dark:bg-slate-800 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                          >
                            <svg className="h-7 w-7 text-slate-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Scegli Galleria</span>
                          </button>
                        </>
                      ) : (
                        <button 
                          onClick={() => fileInputRef.current?.click()} 
                          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-5 hover:bg-slate-100 hover:border-slate-400 transition-colors dark:bg-slate-800 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                        >
                          <svg className="h-7 w-7 text-slate-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Carica Immagini (PC/Web)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                  <button 
                    disabled={!location || photos.length === 0 || (isOperator && !selectedCategoryObj)} 
                    onClick={handleNextStep1} 
                    className="flex w-full justify-center items-center rounded-lg bg-blue-600 p-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isOperator ? (
                      loading ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          Elaborazione in corso...
                        </span>
                      ) : 'Carica Immagini e Analizza'
                    ) : 'Avanti'}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && !isOperator && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">Seleziona Categoria Strutturale</label>
                  <select 
                    value={selectedCategory}
                    onChange={(e) => {
                      const catId = e.target.value;
                      setSelectedCategory(catId);
                      setSelectedCategoryObj(categories.find(c => c._id === catId) || null);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                  >
                    <option value="" disabled>Seleziona una categoria...</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4 border-t border-slate-100 dark:border-slate-700 mt-4">
                  <button 
                    onClick={() => setStep(1)} 
                    className="w-full sm:w-1/3 rounded-lg px-3 py-2 text-sm font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
                  >
                    Indietro
                  </button>
                  <button 
                    onClick={triggerAIAnalysis} 
                    disabled={!!loading || !selectedCategory} 
                    className="flex w-full sm:w-2/3 justify-center items-center rounded-lg bg-blue-600 p-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        {loading}
                      </span>
                    ) : 'Carica Immagini e Analizza'}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                
                {aiSuggestions && (
                  <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-3 shadow-sm dark:bg-blue-900/20 dark:border-blue-400">
                    <h5 className="font-bold text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      Analisi Cloud Vision
                    </h5>
                    <p className="text-xs text-slate-700 dark:text-slate-300 mb-0.5">
                      <strong className="font-semibold text-slate-900 dark:text-white">Miglior Rilevamento:</strong> {aiSuggestions.suggested_title} 
                      <span className="text-[10px] text-slate-500 ml-1.5 font-medium">(Affidabilità: {(aiSuggestions.confidence_score * 100).toFixed(0)}%)</span>
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      <strong className="font-semibold text-slate-900 dark:text-white">Tag Combinati:</strong> {aiSuggestions.tags.join(', ')}
                    </p>
                  </div>
                )}

                <div className="mb-2">
                  <h4 className="text-base font-bold text-slate-800 dark:text-white">Revisione Dati</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Compila i metadati per la categoria <span className="font-bold text-slate-700 dark:text-slate-300">"{selectedCategoryObj?.name}"</span>.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* MODIFICA: Filtriamo via gli attributi deprecati (unavailable) prima del map */}
                  {selectedCategoryObj?.attributes
                    .filter(attr => attr.status !== 'unavailable')
                    .map((attr) => (
                    <div key={attr.name}>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300 capitalize">
                        {attr.name.replace('_', ' ')} {attr.required && <span className="text-rose-500">*</span>}
                      </label>
                      
                      {(() => {
                        if (attr.type === 'enum') {
                          return (
                            <select 
                              value={metadata[attr.name] || ''} 
                              onChange={(e) => handleMetadataChange(attr.name, e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                            >
                              <option value="">Seleziona...</option>
                              {attr.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          );
                        }
                        if (attr.type === 'boolean') {
                          return (
                            <select 
                              value={metadata[attr.name] !== undefined ? String(metadata[attr.name]) : ''} 
                              onChange={(e) => handleMetadataChange(attr.name, e.target.value === 'true')}
                              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                            >
                              <option value="">Seleziona...</option>
                              <option value="true">Vero (Sì)</option>
                              <option value="false">Falso (No)</option>
                            </select>
                          );
                        }
                        if (attr.type === 'date') {
                          return (
                            <input 
                              type="date"
                              value={metadata[attr.name] || ''}
                              onChange={(e) => handleMetadataChange(attr.name, e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                            />
                          );
                        }
                        return (
                          <input 
                            type={attr.type === 'number' ? 'number' : 'text'}
                            value={metadata[attr.name] || ''}
                            onChange={(e) => handleMetadataChange(attr.name, attr.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:text-white dark:bg-slate-800"
                          />
                        );
                      })()}
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center border-t border-slate-100 dark:border-slate-700 pt-4 mt-4 gap-3">
                  <button 
                    onClick={() => setIsCancelModalOpen(true)} 
                    className="w-full sm:w-auto rounded-lg border border-rose-600 text-rose-600 px-4 py-2 text-sm font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    Annulla Censimento
                  </button>
                  
                  <div className="flex w-full sm:w-auto gap-2">
                    <button 
                      onClick={() => setStep(isOperator ? 1 : 2)} 
                      className="flex-1 sm:flex-none rounded-lg px-4 py-2 text-sm font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
                    >
                      Indietro
                    </button>
                    <button 
                      onClick={submitAsset} 
                      disabled={!!loading} 
                      className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Salvataggio...' : 'Conferma e Salva'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isCancelModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 text-center">
              <svg className="mx-auto mb-4 w-12 h-12 text-rose-600 dark:text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <h3 className="mb-2 text-lg font-bold text-slate-800 dark:text-white">Annullare l'operazione?</h3>
              <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
                Sei sicuro di voler annullare? Tutti i dati inseriti e le foto acquisite andranno persi in modo irreversibile.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-3">
                <button 
                  onClick={() => setIsCancelModalOpen(false)} 
                  className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
                >
                  No, continua
                </button>
                <button 
                  onClick={executeCancelProcess} 
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-rose-700 focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                >
                  Sì, annulla tutto
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isSuccessModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 text-center">
              <svg className="mx-auto mb-4 w-16 h-16 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <h3 className="mb-2 text-xl font-bold text-slate-800 dark:text-white">Censimento Completato!</h3>
              <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
                L'asset e i relativi contenuti multimediali sono stati salvati con successo.
              </p>
              <div className="flex justify-center">
                <button 
                  onClick={closeSuccessModal} 
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  Nuovo Censimento
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </>
  );
};

export default CreateAsset;