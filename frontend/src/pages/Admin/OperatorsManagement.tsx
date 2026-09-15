import { useState, useEffect } from "react";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import OperatorsTable from "../../components/admin/OperatorsTable";
import OperatorModal from "../../components/admin/OperatorModal";

export interface Operator {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  campus_ids: string[];
  category_id: string | null;
}

export interface Category {
  id: string;
  _id?: string; 
  name: string;
}

export interface Campus {
  id: string;
  name: string;
  // Non ci serve tipizzare la geometria o i metadati qui, 
  // ci bastano ID e nome per la selezione nel modale
}

export interface OperatorFormData {
  email: string;
  category_id: string;
  campus_ids: string[];
}

export default function OperatorsManagement() {
  const { token } = useAuth();

  const [operators, setOperators] = useState<Operator[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentOperatorId, setCurrentOperatorId] = useState<string | null>(null);
  const [modalError, setModalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emptyForm: OperatorFormData = { email: "", category_id: "", campus_ids: [] };
  const [formData, setFormData] = useState<OperatorFormData>(emptyForm);
  const [successMessage, setSuccessMessage] = useState("");

  const fetchData = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const baseUrl = import.meta.env.VITE_API_URL || '';

      const [opsRes, catRes, campusRes] = await Promise.all([
        fetch(`${baseUrl}/auth/admin/operators`, { headers }),        
        fetch(`${baseUrl}/asset/api/categories`, { headers }).catch(() => ({ ok: false, json: () => [] })),        
        fetch(`${baseUrl}/geozone/api/geozones/campuses`, { headers }).catch(() => ({ ok: false, json: () => [] }))
      ]);

      if (opsRes.ok) setOperators(await opsRes.json());
      
      // Gestione Categorie
      if (catRes.ok) {
        const rawCategories = await catRes.json();
        // Mappiamo i dati: copiamo il valore di "_id" (MongoDB) dentro "id" (Postgres style)
        // così l'intera tabella e il modale lo leggeranno senza problemi.
        const normalizedCategories = rawCategories.map((c: any) => ({
          ...c,
          id: c._id || c.id
        }));
        setCategories(normalizedCategories);
      } else {
        setCategories([]); 
      }
      
      // Gestione Campus: il tuo backend restituisce un array di oggetti [{"id": "...", "name": "...", "geometry": ...}]
      if (campusRes.ok) {
        setCampuses(await campusRes.json());
      } else {
        setCampuses([]); 
      }

    } catch (error) {
      console.error("Errore nel caricamento dei dati:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleOpenCreate = () => {
    setIsEditing(false);
    setCurrentOperatorId(null);
    setFormData(emptyForm);
    setModalError("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (op: Operator) => {
    setIsEditing(true);
    setCurrentOperatorId(op.id);
    setFormData({
      email: op.email,
      category_id: op.category_id || "",
      campus_ids: op.campus_ids || [],
    });
    setModalError("");
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (submittedData: OperatorFormData) => {
    setModalError("");
    setIsSubmitting(true);
    setSuccessMessage("");

    try {
      const url = isEditing 
        ? `${import.meta.env.VITE_API_URL || ''}/auth/admin/operators/${currentOperatorId}`
        : `${import.meta.env.VITE_API_URL || ''}/auth/admin/operators`;
        
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(isEditing 
          ? { category_id: submittedData.category_id, campus_ids: submittedData.campus_ids }
          : submittedData
        ),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Errore sconosciuto durante il salvataggio.");
      }

      await fetchData();
      setIsModalOpen(false);
      
      setSuccessMessage(isEditing ? "Permessi aggiornati con successo!" : "Profilo Operatore creato. Ora può accedere tramite Google.");
      setTimeout(() => setSuccessMessage(""), 5000); 

    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageMeta
        title="Gestione Operatori | Asset Management Unisa"
        description="Amministrazione profili tecnici e assegnazione campus/categorie."
      />

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
            Gestione Operatori
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configura le autorizzazioni e i perimetri geografici del personale tecnico.
          </p>
        </div>
        
        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-7 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all"
        >
          <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Nuovo Operatore
        </button>
      </div>

      {successMessage && (
        <div className="mb-6 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-emerald-800 shadow-sm">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      <OperatorsTable 
        operators={operators} 
        categories={categories} 
        campuses={campuses}
        isLoading={isLoading} 
        onEditClick={handleOpenEdit} 
      />

      <OperatorModal
        isOpen={isModalOpen}
        isEditing={isEditing}
        initialData={formData}
        categories={categories}
        campuses={campuses}
        error={modalError}
        isSubmitting={isSubmitting}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
    </>
  );
}