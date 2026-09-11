import os
import datetime
from bson import ObjectId
from flask import Flask, request, jsonify
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import dateutil.parser
import threading
import json

# Import della libreria centralizzata per RabbitMQ
from shared_utils.messaging import RabbitMQManager

# ============================================================================
# INIZIALIZZAZIONE E CONFIGURAZIONE
# ============================================================================
app = Flask(__name__)

# Configurazione MongoDB
DATABASE_URL = os.getenv('DATABASE_URL', 'mongodb://test_user:test_pass@db:27017/asset_db?authSource=admin')
try:
    client = MongoClient(DATABASE_URL, serverSelectionTimeoutMS=5000)
    db = client.get_default_database()
    
    # Riferimenti alle collezioni previste 
    categories_col = db.categories
    assets_col = db.assets
    history_col = db.asset_history
    campus_cache_col = db.campus_cache

except ConnectionFailure as e:
    print(f"[ASSET SERVICE] Errore di connessione a MongoDB: {e}")

# Inizializzazione RabbitMQ centralizzato
mq_manager = RabbitMQManager()

# ============================================================================
# FUNZIONI DI UTILITA' E MIDDLEWARE
# ============================================================================
def get_auth_context():
    """
    Estrae le informazioni di sicurezza propagate dall'API Gateway.
    Il Gateway ha già validato il JWT, qui ci limitiamo a consumare i dati.
    """
    campuses_header = request.headers.get('X-Campus-Ids', '')
    campus_ids = [c.strip() for c in campuses_header.split(',')] if campuses_header else []
    
    return {
        'user_id': request.headers.get('X-User-Id'),
        'role': request.headers.get('X-User-Role'),
        'email' : request.headers.get('X-User-Email'), # <-- MODIFICA: Presa dell'email dal Gateway
        'campus_ids': campus_ids,
        'client_type': request.headers.get('X-Client-Type', 'web').lower()
    }


def serialize_mongo_doc(doc):
    """
    Converte ricorsivamente gli ObjectId di MongoDB in stringhe per la risposta JSON.
    """
    if not doc:
        return None
        
    # Converte l'ID principale 
    if '_id' in doc:
        doc['_id'] = str(doc['_id'])
        
    # Converte l'ID annidato all'interno dello snapshot storico (se presente)
    if 'state_snapshot' in doc and '_id' in doc['state_snapshot']:
        doc['state_snapshot']['_id'] = str(doc['state_snapshot']['_id'])
        
    return doc

def error_response(message, status_code):
    return jsonify({"error": message}), status_code

def publish_event(action, extra_data=None):
    """
    Wrapper per pubblicare eventi verso DataInsight Service o altri consumer.
    """
    auth = get_auth_context()
    
    if extra_data is None:
        extra_data = {}
        
    # <-- MODIFICA: Iniettiamo l'email nel payload
    if auth.get('email'):
        extra_data['email'] = auth.get('email')

    mq_manager.publish_event(
        exchange_name='system_events',
        action=action,
        actor_id=auth.get('user_id') or None,
        service_name='asset-service',
        extra_data=extra_data
    )

def get_cached_campus_name(campus_id):
    """Recupera il nome del campus dalla cache locale senza chiamate esterne."""
    doc = campus_cache_col.find_one({"_id": campus_id})
    return doc.get("name") if doc else None

def extract_asset_name(asset_id):
    """Utilizza lo Short-ID (primi 8 caratteri) come identificativo univoco e infallibile."""
    if not asset_id:
        return None
    return f"ID-{str(asset_id)[:8].upper()}"

# ============================================================================
# ENDPOINT DI SISTEMA
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

# ============================================================================
# ENDPOINT: Creazione Categoria 
# ============================================================================
@app.route('/api/categories', methods=['POST'])
def create_category():
    """
    Crea una nuova categoria strutturale per gli asset.
    """
    auth = get_auth_context()
    
    # Solo l'Amministratore può creare nuove categorie
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    data = request.get_json()
    if not data or not data.get('name'):
        return error_response("Il payload deve contenere il campo 'name'", 400)

    category_name = data.get('name').strip()

    # Verifica se esiste già una categoria con questo nome
    if categories_col.find_one({"name": {"$regex": f"^{category_name}$", "$options": "i"}}):
        return error_response("Categoria già esistente", 409)

    # Documento iniziale della Categoria. Gli attributi verranno aggiunti successivamente (US 2-2)
    new_category = {
        "name": category_name,
        "description": data.get('description', ''),
        "icon": data.get('icon', '📍'), 
        "attributes": [], # Inizialmente vuoto, popolato dinamicamente in seguito
        "created_by": auth.get('user_id'),
        "created_at": datetime.datetime.utcnow().isoformat(),
        "updated_at": datetime.datetime.utcnow().isoformat()
    }

    try:
        result = categories_col.insert_one(new_category)
        new_category['_id'] = str(result.inserted_id)
        
        # Pubblicazione evento asincrono per il DataInsight Service
        publish_event("CATEGORY_CREATED", {
            "category_id": new_category['_id'], 
            "category_name": category_name
        })

        return jsonify({
            "message": "Categoria creata con successo",
            "category": new_category
        }), 201

    except Exception as e:
        return error_response(f"Errore durante il salvataggio: {str(e)}", 500)
    
    
# ============================================================================
# ENDPOINT: Consultazione di tutte le categorie
# ============================================================================

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """
    Recupera l'elenco completo di tutte le categorie di asset a sistema.
    Accessibile sia da Amministratori che da Operatori (e Guest se configurato nel Gateway).
    """
    try:
        # Recupera tutte le categorie. MongoDB restituisce un cursore che convertiamo in lista.
        categories = list(categories_col.find())
        
        # Serializza gli ObjectId per renderli compatibili con JSON
        serialized_categories = [serialize_mongo_doc(cat) for cat in categories]
        
        return jsonify(serialized_categories), 200
    except Exception as e:
        return error_response(f"Errore durante il recupero delle categorie: {str(e)}", 500)


# ============================================================================
# ENDPOINT: Consultazione dettagli di una singola categoria
# ============================================================================
@app.route('/api/categories/<category_id>', methods=['GET'])
def get_category(category_id):
    """
    Recupera i dettagli di una singola categoria (inclusi i suoi attributi dinamici futuri).
    """
    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    try:
        category = categories_col.find_one({"_id": ObjectId(category_id)})
        
        if not category:
            return error_response("Categoria non trovata", 404)
            
        return jsonify(serialize_mongo_doc(category)), 200
    except Exception as e:
        return error_response(f"Errore durante la ricerca della categoria: {str(e)}", 500)


# ============================================================================
# ENDPOINT: Modifica di una categoria esistente
# ============================================================================
@app.route('/api/categories/<category_id>', methods=['PUT'])
def update_category(category_id):
    """
    Modifica le informazioni base della categoria (nome, descrizione).
    Non si occupa degli attributi dinamici.
    """
    auth = get_auth_context()
    
    # Controllo ruoli di sicurezza
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    update_fields = {}
    
    # 1. Validazione e aggiornamento Nome
    if 'name' in data and data['name'].strip():
        new_name = data['name'].strip()
        # Assicuriamoci che il nuovo nome non vada in conflitto con un'altra categoria esistente
        existing = categories_col.find_one({
            "name": {"$regex": f"^{new_name}$", "$options": "i"}, 
            "_id": {"$ne": ObjectId(category_id)}
        })
        if existing:
            return error_response("Il nome inserito è già in uso da un'altra categoria", 409)
        update_fields['name'] = new_name

    # 2. Aggiornamento Descrizione
    if 'description' in data:
        update_fields['description'] = data['description']

    # 3. Aggiornamento Icona
    if 'icon' in data:
        update_fields['icon'] = data['icon']

    if not update_fields:
        return error_response("Nessun campo valido fornito per l'aggiornamento", 400)

    update_fields['updated_at'] = datetime.datetime.utcnow().isoformat()

    try:
        # Aggiornamento atomico in MongoDB
        result = categories_col.update_one(
            {"_id": ObjectId(category_id)},
            {"$set": update_fields}
        )

        if result.matched_count == 0:
            return error_response("Categoria non trovata", 404)

        # Recupera e restituisce il documento aggiornato
        updated_category = categories_col.find_one({"_id": ObjectId(category_id)})

        # Tracciabilità asincrona
        publish_event("CATEGORY_UPDATED", {
            "category_id": category_id, 
            "category_name": updated_category.get('name'),
            "updated_fields": list(update_fields.keys())
        })

        return jsonify(serialize_mongo_doc(updated_category)), 200

    except Exception as e:
        return error_response(f"Errore durante l'aggiornamento: {str(e)}", 500)
    

# ============================================================================
# ENDPOINT: Gestione attributi dinamici di una categoria 
# ============================================================================
# Tipi di dato supportati dal sistema per gli attributi dinamici
ALLOWED_ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'date', 'enum']

@app.route('/api/categories/<category_id>/attributes', methods=['POST'])
def add_category_attribute(category_id):
    """
    Aggiunge un nuovo attributo dinamico alla configurazione di una categoria esistente.
    """
    auth = get_auth_context()
    
    # Controllo ruoli di sicurezza
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    # 1. Validazione campi obbligatori dell'attributo
    attr_name = data.get('name', '').strip()
    attr_type = data.get('type', '').strip().lower()

    if not attr_name or not attr_type:
        return error_response("I campi 'name' e 'type' sono obbligatori", 400)

    if attr_type not in ALLOWED_ATTRIBUTE_TYPES:
        return error_response(
            f"Tipo attributo non valido. Tipi consentiti: {', '.join(ALLOWED_ATTRIBUTE_TYPES)}", 
            400
        )

    # 2. Validazione specifica per il tipo 'enum' (Menu a tendina)
    options = data.get('options', [])
    if attr_type == 'enum':
        if not isinstance(options, list) or len(options) == 0:
            return error_response(
                "Per il tipo 'enum' (menu a tendina) è obbligatorio fornire una lista non vuota in 'options'", 
                400
            )
    else:
        # Se non è un enum, scartiamo eventuali opzioni inviate per errore dal frontend
        options = [] 

    # 3. Costruzione dell'oggetto attributo
    # Viene aggiunto il campo 'status' per gestire la futura US 2-4 (Deprecazione)
    new_attribute = {
        "name": attr_name,
        "type": attr_type,
        "required": bool(data.get('required', False)),
        "filterable": bool(data.get('filterable', False)),
        "editable": bool(data.get('editable', True)),
        "visible": bool(data.get('visible', True)),
        "options": options,
        "status": "active"  # Valori previsti: 'active' | 'deprecated'
    }

    try:
        # 4. Verifica esistenza categoria e prevenzione duplicati logici
        category = categories_col.find_one({"_id": ObjectId(category_id)})
        if not category:
            return error_response("Categoria non trovata", 404)

        existing_attrs = category.get('attributes', [])
        for attr in existing_attrs:
            if attr['name'].lower() == attr_name.lower():
                return error_response(f"L'attributo '{attr_name}' esiste già in questa categoria", 409)

        # 5. Inserimento atomico in MongoDB tramite operatore $push
        result = categories_col.update_one(
            {"_id": ObjectId(category_id)},
            {
                "$push": {"attributes": new_attribute},
                "$set": {"updated_at": datetime.datetime.utcnow().isoformat()}
            }
        )

        if result.modified_count == 0:
            return error_response("Nessuna modifica effettuata", 400)

        # 6. Tracciabilità asincrona (DataInsight Service / Log Service)
        publish_event("ATTRIBUTE_ADDED", {
            "category_id": category_id,
            "category_name": category.get('name'),
            "attribute_name": attr_name,
            "attribute_type": attr_type
        })

        # 7. Ritorna il documento completo e aggiornato
        updated_category = categories_col.find_one({"_id": ObjectId(category_id)})
        return jsonify(serialize_mongo_doc(updated_category)), 201

    except Exception as e:
        return error_response(f"Errore durante l'aggiunta dell'attributo: {str(e)}", 500)


# ============================================================================
# ENDPOINT: Eliminazione Categoria
# ============================================================================
@app.route('/api/categories/<category_id>', methods=['DELETE'])
def delete_category(category_id):
    """
    Elimina fisicamente una categoria. 
    L'operazione è permessa solo agli Amministratori.
    """
    auth = get_auth_context()
    
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    try:
        # Recupera il nome della categoria prima di eliminarla
        category = categories_col.find_one({"_id": ObjectId(category_id)})
        if not category:
            return error_response("Categoria non trovata", 404)
        cat_name = category.get('name', 'Categoria Sconosciuta')

        # Verifica se la categoria è usata da qualche asset
        assets_using_cat = assets_col.count_documents({"category_id": category_id})
        if assets_using_cat > 0:
            return error_response("Impossibile eliminare: ci sono asset associati a questa categoria. Elimina prima gli asset.", 409)

        result = categories_col.delete_one({"_id": ObjectId(category_id)})
        
        if result.deleted_count == 0:
            return error_response("Categoria non trovata", 404)

        # Tracciabilità
        publish_event("CATEGORY_DELETED", {
            "category_id": category_id,
            "category_name": cat_name
        })

        return jsonify({"message": "Categoria eliminata con successo"}), 200

    except Exception as e:
        return error_response(f"Errore durante l'eliminazione: {str(e)}", 500)

# ============================================================================
# ENDPOINT: Modifica di un attributo dinamico di una categoria
# ============================================================================

@app.route('/api/categories/<category_id>/attributes/<attribute_name>', methods=['PUT'])
def update_category_attribute(category_id, attribute_name):
    """
    Modifica un attributo esistente (rinomina, cambio tipo) o ne imposta lo stato (es. unavailable).
    Gestisce la conversione automatica o blocca in caso di incompatibilità.
    """
    auth = get_auth_context()
    
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    # 1. Recupero la categoria e cerco l'attributo specifico
    category = categories_col.find_one({"_id": ObjectId(category_id)})
    if not category:
        return error_response("Categoria non trovata", 404)

    current_attr = next((attr for attr in category.get('attributes', []) if attr['name'] == attribute_name), None)
    if not current_attr:
        return error_response("Attributo non trovato nella categoria specificata", 404)

    # 2. Estrazione e validazione dei nuovi valori
    new_name = data.get('name', current_attr['name']).strip()
    new_type = data.get('type', current_attr['type']).strip().lower()
    new_status = data.get('status', current_attr.get('status', 'active')).strip().lower()

    if new_type not in ALLOWED_ATTRIBUTE_TYPES:
        return error_response(f"Tipo non valido. Consentiti: {', '.join(ALLOWED_ATTRIBUTE_TYPES)}", 400)

    if new_status not in ['active', 'unavailable']:
        return error_response("Stato non valido. Valori consentiti: 'active', 'unavailable'", 400)

    # 3. Controllo collisioni di nome durante la rinomina
    if new_name != attribute_name:
        if any(attr['name'].lower() == new_name.lower() for attr in category.get('attributes', [])):
            return error_response(f"Un attributo con il nome '{new_name}' esiste già", 409)

    # 4. Gestione cambio tipo (US 2-3) e incompatibilità
    if new_type != current_attr['type']:
        # Verifica se esistono già asset fisici che hanno popolato questo metadato
        assets_using_attr = assets_col.count_documents({
            "category_id": category_id,
            f"metadata.{attribute_name}": {"$exists": True}
        })
        
        # Se ci sono asset, una modifica massiva del tipo potrebbe corrompere i dati storici
        if assets_using_attr > 0:
            return error_response(
                "Operazione bloccata per incompatibilità: esistono asset storici che utilizzano questo attributo. "
                "Strategia consigliata: dichiarare l'attributo come 'unavailable' e crearne uno nuovo.", 
                409
            )

    # 5. Costruzione dell'attributo aggiornato
    updated_attr = {
        "name": new_name,
        "type": new_type,
        "required": bool(data.get('required', current_attr.get('required'))),
        "filterable": bool(data.get('filterable', current_attr.get('filterable'))),
        "editable": bool(data.get('editable', current_attr.get('editable'))),
        "visible": bool(data.get('visible', current_attr.get('visible'))),
        "options": data.get('options', current_attr.get('options')),
        "status": new_status
    }

    try:
        # 6. Rinomina chiave nei dati storici degli asset (US 2-3)
        if new_name != attribute_name:
            # Usa $rename per aggiornare in modo efficiente le chiavi nei documenti MongoDB
            assets_col.update_many(
                {"category_id": category_id, f"metadata.{attribute_name}": {"$exists": True}},
                {"$rename": {f"metadata.{attribute_name}": f"metadata.{new_name}"}}
            )

        # 7. Aggiornamento dell'attributo nell'array tramite l'operatore posizionale '$'
        categories_col.update_one(
            {"_id": ObjectId(category_id), "attributes.name": attribute_name},
            {"$set": {
                "attributes.$": updated_attr,
                "updated_at": datetime.datetime.utcnow().isoformat()
            }}
        )

        # 8. Eventi RabbitMQ
        publish_event("ATTRIBUTE_UPDATED", {
            "category_id": category_id,
            "category_name": category.get('name'),
            "old_name": attribute_name,
            "new_name": new_name,
            "new_type": new_type
        })

        if new_status == "unavailable" and current_attr.get('status') != "unavailable":
            publish_event("ATTRIBUTE_DEPRECATED", {
                "category_id": category_id,
                "category_name": category.get('name'),
                "attribute_name": new_name
            })

        # Restituisce il documento aggiornato
        updated_category = categories_col.find_one({"_id": ObjectId(category_id)})
        return jsonify(serialize_mongo_doc(updated_category)), 200

    except Exception as e:
        return error_response(f"Errore durante l'aggiornamento dell'attributo: {str(e)}", 500)
    

# ============================================================================
# UTILITY DI VALIDAZIONE METADATI DINAMICI
# ============================================================================

def validate_asset_metadata(payload_metadata, category_attributes):
    """
    Valida il dizionario dei metadati inviato dal client contro la struttura 
    della categoria, ignorando le differenze tra maiuscole e minuscole (case-insensitive).
    """
    validated_data = {}
    errors = []

    # Mappa degli attributi attivi indicizzata per nome in MINUSCOLO per facilitare il match
    active_attrs_lower = {
        attr['name'].lower(): attr 
        for attr in category_attributes 
        if attr.get('status') != 'unavailable'
    }

    # Trasformiamo in minuscolo anche le chiavi arrivate dal payload per un rapido controllo di presenza
    payload_keys_lower = {k.lower(): k for k in payload_metadata.keys()}

    # 1. Verifica campi obbligatori
    for attr in category_attributes:
        if attr.get('status') == 'unavailable':
            continue
            
        attr_name_original = attr['name']
        
        if attr.get('required') and attr_name_original.lower() not in payload_keys_lower:
            errors.append(f"Il campo obbligatorio '{attr_name_original}' è mancante.")

    # 2. Verifica tipi di dato e vincoli per i campi forniti
    for payload_key, value in payload_metadata.items():
        payload_key_lower = payload_key.lower()

        if payload_key_lower not in active_attrs_lower:
            errors.append(f"L'attributo '{payload_key}' non è valido o è stato deprecato per questa categoria.")
            continue

        # Estraiamo la regola e il nome con il CASING ESATTO previsto dal database
        rules = active_attrs_lower[payload_key_lower]
        real_db_key = rules['name']
        expected_type = rules['type']

        if value is None or value == "":
            if rules.get('required'):
                errors.append(f"Il campo '{real_db_key}' non può essere vuoto.")
            continue # Se non è obbligatorio e viene inviato vuoto, lo accettiamo come nullo

        # Validazione Tipo
        try:
            if expected_type == 'string':
                if not isinstance(value, str):
                    errors.append(f"Il campo '{real_db_key}' deve essere una stringa.")
                else:
                    validated_data[real_db_key] = str(value)

            elif expected_type == 'number':
                if not isinstance(value, (int, float)):
                    errors.append(f"Il campo '{real_db_key}' deve essere un numero.")
                else:
                    validated_data[real_db_key] = float(value)

            elif expected_type == 'boolean':
                if not isinstance(value, bool):
                    errors.append(f"Il campo '{real_db_key}' deve essere un booleano (true/false).")
                else:
                    validated_data[real_db_key] = bool(value)

            elif expected_type == 'date':
                # Verifica che sia una data ISO 8601 valida
                dateutil.parser.isoparse(str(value))
                validated_data[real_db_key] = str(value)

            elif expected_type == 'enum':
                # L'enum rimane case-sensitive per i valori, ma la chiave è tollerante
                if value not in rules.get('options', []):
                    errors.append(f"Il valore '{value}' non è tra le opzioni valide per '{real_db_key}'.")
                else:
                    validated_data[real_db_key] = str(value)

        except ValueError:
            errors.append(f"Formato non valido per il campo '{real_db_key}' (Atteso: {expected_type}).")

    return validated_data, errors

# ============================================================================
# ENDPOINT: Censimento definitivo di un nuovo Asset
# ============================================================================

@app.route('/api/assets', methods=['POST'])
def create_asset():
    """
    Censimento definitivo di un nuovo Asset.
    Riceve i metadati (inclusi quelli suggeriti dall'AI e confermati dall'operatore)
    e li salva validandoli rispetto alla categoria.
    """
    auth = get_auth_context()
    user_id = auth.get('user_id')
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])
    client_type = auth.get('client_type') 
    
    # Estrazione degli header di rete per l'identificazione del dispositivo
    request_origin = request.headers.get('Origin', '')
    user_agent = request.headers.get('User-Agent', '').lower()

    # 1. L'Amministratore NON può creare asset
    if user_role == 'AMMINISTRATORE':
        return error_response("Gli amministratori non possono censire fisicamente gli asset.", 403)

    # 2. Solo gli Operatori possono procedere
    if user_role != 'OPERATORE':
        return error_response("Non hai i permessi per censire un asset.", 403)

    # 3. Controllo Intelligente del Dispositivo (Mobile / Android / Capacitor)
    is_mobile_header = client_type == 'mobile'
    is_mobile_os = any(os in user_agent for os in ['android', 'iphone', 'ipad', 'capacitor', 'mobile'])
    valid_capacitor_origins = ['http://localhost', 'https://localhost', 'capacitor://localhost']
    is_native_origin = request_origin in valid_capacitor_origins

    # Se non soddisfa nessuna delle condizioni mobile/native, viene respinto (es. Desktop Web)
    if not (is_mobile_header or is_mobile_os or is_native_origin):
        publish_event("UNAUTHORIZED_DESKTOP_CREATION_ATTEMPT", {"user_agent": user_agent})
        return error_response("Il censimento degli asset è consentito solo tramite l'App Mobile.", 403)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    category_id = data.get('category_id')
    campus_id = data.get('campus_id')
    geometry = data.get('geometry') # Formato atteso: GeoJSON {"type": "Point", "coordinates": [lng, lat]}
    raw_metadata = data.get('metadata', {})
    media_ids = data.get('media_ids', []) # <--- Estrazione degli ID delle immagini
    media_id = data.get('media_id')       # <--- Fallback

    if not category_id or not campus_id or not geometry:
        return error_response("Parametri mancanti: 'category_id', 'campus_id' e 'geometry' sono obbligatori", 400)

    if not ObjectId.is_valid(category_id):
        return error_response("ID categoria non valido", 400)

    # Controllo giurisdizione: un operatore può censire solo nei campus a lui assegnati
    if user_role == 'OPERATORE' and campus_id not in user_campuses:
        return error_response("Non sei autorizzato a operare sul campus specificato", 403)

    # 1. Recupero la categoria per le regole di validazione
    category = categories_col.find_one({"_id": ObjectId(category_id)})
    if not category:
        return error_response("Categoria non trovata", 404)

    # 2. Validazione rigorosa dei metadati
    validated_metadata, validation_errors = validate_asset_metadata(raw_metadata, category.get('attributes', []))
    
    if validation_errors:
        return jsonify({"error": "Errore di validazione metadati", "details": validation_errors}), 422

    # 3. Costruzione del documento Asset
    timestamp = datetime.datetime.utcnow().isoformat()
    new_asset = {
        "category_id": category_id,
        "campus_id": campus_id, # Soft Link al GeoZone Service
        "geometry": geometry,   # GeoJSON nativo per indicizzazione spaziale
        "metadata": validated_metadata,
        "media_ids": media_ids, # <--- Inserimento nell'oggetto database
        "media_id": media_id,   # <--- Inserimento nell'oggetto database
        "created_by": user_id,
        "updated_by": user_id,
        "created_at": timestamp,
        "updated_at": timestamp
    }

    try:
        # 4. Inserimento dell'Asset nello stato corrente
        result = assets_col.insert_one(new_asset)
        asset_id = str(result.inserted_id)
        new_asset['_id'] = asset_id

        # 5. Immutabilità: Creazione dello snapshot nella History
        snapshot = {
            "asset_id": asset_id,
            "action": "CREATE",
            "actor_id": user_id,
            "timestamp": timestamp,
            "state_snapshot": new_asset
        }
        history_col.insert_one(snapshot)

        # INIEZIONE NOMI PER LA TABELLA DEI LOG (Local Cache & Extraction)
        campus_name = get_cached_campus_name(campus_id)
        asset_name = extract_asset_name(asset_id)

        # 6. Tracciabilità asincrona (RabbitMQ)
        publish_event("ASSET_CREATED", {
            "asset_id": asset_id,
            "asset_name": asset_name, 
            "category_id": category_id,
            "category_name": category.get('name', 'Sconosciuta'),
            "campus_id": campus_id,
            "campus_name": campus_name
        })

        return jsonify({
            "message": "Asset censito con successo",
            "asset": new_asset
        }), 201

    except Exception as e:
        return error_response(f"Errore durante il censimento: {str(e)}", 500)
    
 
# ============================================================================
# ENDPOINT: Consultazione di un Asset esistente
# ============================================================================
 
@app.route('/api/assets/<asset_id>', methods=['GET'])
def get_asset(asset_id):
    """
    Restituisce la scheda completa di un asset.
    """
    auth = get_auth_context()
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])

    if not ObjectId.is_valid(asset_id):
        return error_response("ID asset non valido", 400)

    try:
        asset = assets_col.find_one({"_id": ObjectId(asset_id)})
        
        if not asset:
            return error_response("Asset non trovato", 404)

        # Controllo autorizzazione territoriale (US 5-3)
        if user_role == 'OPERATORE' and asset.get('campus_id') not in user_campuses:
            return error_response("Accesso negato: l'asset non appartiene alla tua giurisdizione", 403)

        return jsonify(serialize_mongo_doc(asset)), 200

    except Exception as e:
        return error_response(f"Errore durante il recupero dell'asset: {str(e)}", 500)
    
    
# ============================================================================
# ENDPOINT: Aggiornamento di un Asset esistente (metadati e coordinate)
# ============================================================================

@app.route('/api/assets/<asset_id>', methods=['PUT'])
def update_asset(asset_id):
    """
    Aggiorna i metadati e/o le coordinate di un asset, preservando i campi deprecati
    e generando un nuovo snapshot nello storico.
    """
    auth = get_auth_context()
    user_id = auth.get('user_id')
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])

    if user_role not in ['OPERATORE', 'AMMINISTRATORE']:
        return error_response("Non hai i permessi per modificare un asset", 403)

    if not ObjectId.is_valid(asset_id):
        return error_response("ID asset non valido", 400)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    try:
        # 1. Recupero lo stato attuale dell'asset
        current_asset = assets_col.find_one({"_id": ObjectId(asset_id)})
        if not current_asset:
            return error_response("Asset non trovato", 404)

        # Controllo autorizzazione territoriale per la modifica
        if user_role == 'OPERATORE' and current_asset.get('campus_id') not in user_campuses:
            return error_response("Accesso negato: non puoi modificare asset fuori dalla tua giurisdizione", 403)

        # 2. Recupero la categoria per la validazione strutturale
        category_id = current_asset.get('category_id')
        category = categories_col.find_one({"_id": ObjectId(category_id)})
        if not category:
            return error_response("Errore di integrità: categoria dell'asset non trovata", 500)

        # 3. Validazione dei nuovi metadati
        raw_metadata = data.get('metadata', {})
        validated_metadata, validation_errors = validate_asset_metadata(raw_metadata, category.get('attributes', []))
        
        if validation_errors:
            return jsonify({"error": "Errore di validazione metadati", "details": validation_errors}), 422

        # 4. Fusione dei dati: recuperiamo i valori degli attributi deprecati (Unavailable) 
        # dal vecchio asset e li iniettiamo nel nuovo dizionario per non perderli (US 4-1 / US 2-4)
        deprecated_keys = [attr['name'] for attr in category.get('attributes', []) if attr.get('status') == 'unavailable']
        preserved_metadata = {k: v for k, v in current_asset.get('metadata', {}).items() if k in deprecated_keys}
        
        # Merge: i metadati validati (nuovi) sovrascrivono quelli correnti, i deprecati vengono mantenuti
        final_metadata = {**preserved_metadata, **validated_metadata}

        # 5. Costruzione del documento di aggiornamento
        timestamp = datetime.datetime.utcnow().isoformat()
        update_fields = {
            "metadata": final_metadata,
            "updated_by": user_id,
            "updated_at": timestamp
        }

        if 'geometry' in data:
            update_fields['geometry'] = data['geometry']
            
        if 'media_ids' in data:
            update_fields['media_ids'] = data['media_ids']

        # 6. Salvataggio del nuovo stato corrente (sovrascrittura su 'assets')
        assets_col.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": update_fields}
        )

        # Ricarico l'asset aggiornato per lo snapshot
        updated_asset = assets_col.find_one({"_id": ObjectId(asset_id)})

        # 7. Tracciabilità assoluta: Snapshot su 'asset_history'
        snapshot = {
            "asset_id": asset_id,
            "action": "UPDATE",
            "actor_id": user_id,
            "timestamp": timestamp,
            "state_snapshot": updated_asset
        }
        history_col.insert_one(snapshot)

        # INIEZIONE NOMI PER LA TABELLA DEI LOG 
        campus_name = get_cached_campus_name(updated_asset.get('campus_id'))
        asset_name = extract_asset_name(asset_id)

        # 8. Eventi RabbitMQ
        publish_event("ASSET_UPDATED", {
            "asset_id": asset_id,
            "asset_name": asset_name,  
            "category_id": category_id,
            "category_name": category.get('name', 'Sconosciuta'),
            "campus_id": updated_asset.get('campus_id'),
            "campus_name": campus_name,  
            "updated_keys": list(raw_metadata.keys())
        })

        return jsonify({
            "message": "Asset aggiornato con successo",
            "asset": serialize_mongo_doc(updated_asset)
        }), 200

    except Exception as e:
        return error_response(f"Errore durante l'aggiornamento dell'asset: {str(e)}", 500)

# ============================================================================
# ENDPOINT: Ricerca, filtraggio e visualizzazione massiva degli Asset
# ============================================================================

@app.route('/api/assets', methods=['GET'])
def get_assets():
    """
    Motore di ricerca massivo per gli asset. 
    Supporta visualizzazione cartografica (GeoJSON incluso nelle risposte), 
    visualizzazione ad elenco, filtri di sicurezza per ruolo, 
    filtro per categoria e filtri dinamici sugli attributi.
    """
    auth = get_auth_context()
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])

    # Inizializzazione della query vuota per MongoDB
    mongo_query = {}

    # 1. Filtro di Sicurezza Territoriale (Applicato ora anche agli Amministratori)
    if user_role in ['OPERATORE', 'AMMINISTRATORE']:
        if not user_campuses:
            return jsonify({"assets": [], "pagination": {}}), 200 
            
        requested_campus_param = request.args.get('campus_id')
        if requested_campus_param:
            # Suddividiamo la stringa separata da virgole in una lista
            requested_campuses = [c.strip() for c in requested_campus_param.split(',')]
            valid_campuses = [c for c in requested_campuses if c in user_campuses]
            if not valid_campuses:
                return jsonify({"assets": [], "pagination": {}}), 200
            mongo_query['campus_id'] = {'$in': valid_campuses}
        else:
            # Forza la query a restituire solo gli asset dei propri campus
            mongo_query['campus_id'] = {'$in': user_campuses}

    # 2. Filtro per Categoria Strutturale
    requested_category_param = request.args.get('category_id')
    if requested_category_param:
        # Suddividiamo la stringa separata da virgole in una lista
        requested_categories = [c.strip() for c in requested_category_param.split(',')]
        for cat_id in requested_categories:
            if not ObjectId.is_valid(cat_id):
                return error_response(f"ID Categoria non valido: {cat_id}", 400)
        mongo_query['category_id'] = {'$in': requested_categories}
        
    # 3. Filtri Dinamici sugli Attributi (US 5-2)
    def parse_filter_value(v):
        """Tenta il cast del valore stringa al tipo nativo corretto."""
        v = v.strip()
        if v.lower() == 'true': return True
        if v.lower() == 'false': return False
        try:
            return float(v) # MongoDB incrocia automaticamente int e float
        except ValueError:
            return v # Se fallisce, è una normale stringa

    for key, value in request.args.items():
        if key.startswith('attr_'):
            attr_name = key[5:] 
            
            if ',' in value:
                parsed_values = [parse_filter_value(v) for v in value.split(',')]
                mongo_query[f'metadata.{attr_name}'] = {'$in': parsed_values}
            else:
                mongo_query[f'metadata.{attr_name}'] = parse_filter_value(value)
                
    # 4. Configurazione Paginazione
    try:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 50)) # Mostra 50 risultati di default
        if page < 1: page = 1
        if limit < 1 or limit > 500: limit = 50 # Previeni payload massivi
    except ValueError:
        page = 1
        limit = 50
        
    skip = (page - 1) * limit

    try:
        # 5. Esecuzione query paginata su MongoDB
        cursor = assets_col.find(mongo_query).skip(skip).limit(limit)
        assets_list = list(cursor)
        
        # Recupero del numero totale di documenti che matchano i filtri
        total_count = assets_col.count_documents(mongo_query)
        
        serialized_assets = [serialize_mongo_doc(asset) for asset in assets_list]
        
        # 6. Costruzione della Risposta
        # Ogni elemento in 'assets' include il campo 'geometry' in formato GeoJSON,
        # fornendo al frontend (US 5-1) tutto ciò che serve per piazzare i marker sulla mappa
        # e per costruire la tabella in Visualizzazione Elenco.
        return jsonify({
            "assets": serialized_assets,
            "pagination": {
                "page": page,
                "limit": limit,
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit
            }
        }), 200
        
    except Exception as e:
        return error_response(f"Errore durante la ricerca degli asset: {str(e)}", 500)
    

# ============================================================================
# ENDPOINT: Esportazione CSV degli Assets 
# ============================================================================
@app.route('/api/assets/export', methods=['GET'])
def export_assets():
    """
    Esporta in formato CSV gli asset filtrati, estraendo dinamicamente 
    tutti gli attributi valorizzati. L'uso è riservato agli Amministratori.
    """
    auth = get_auth_context()
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Solo gli Amministratori possono esportare gli asset.", 403)

    user_campuses = auth.get('campus_ids', [])
    mongo_query = {}

    # 1. Filtro Territoriale 
    requested_campus_param = request.args.get('campus_id')
    if requested_campus_param:
        requested_campuses = [c.strip() for c in requested_campus_param.split(',')]
        valid_campuses = [c for c in requested_campuses if c in user_campuses]
        if not valid_campuses:
            from flask import Response
            return Response("\ufeffNessun dato corrispondente ai filtri.", mimetype="text/csv")
        mongo_query['campus_id'] = {'$in': valid_campuses}
    else:
        mongo_query['campus_id'] = {'$in': user_campuses}

    # 2. Filtro Categoria
    requested_category_param = request.args.get('category_id')
    if requested_category_param:
        requested_categories = [c.strip() for c in requested_category_param.split(',')]
        mongo_query['category_id'] = {'$in': requested_categories}
        
    # 3. Filtri Dinamici
    def parse_filter_value(v):
        v = v.strip()
        if v.lower() == 'true': return True
        if v.lower() == 'false': return False
        try: return float(v)
        except ValueError: return v

    for key, value in request.args.items():
        if key.startswith('attr_'):
            attr_name = key[5:]
            if ',' in value:
                parsed_values = [parse_filter_value(v) for v in value.split(',')]
                mongo_query[f'metadata.{attr_name}'] = {'$in': parsed_values}
            else:
                mongo_query[f'metadata.{attr_name}'] = parse_filter_value(value)

    try:
        assets_list = list(assets_col.find(mongo_query))
        
        # Recupero nomi categorie in cache per la colonna descrittiva
        cat_cache = {str(c['_id']): c.get('name', 'Sconosciuta') for c in categories_col.find()}
        
        # Estrazione dinamica delle chiavi dei metadati da tutti gli asset
        meta_keys = set()
        for asset in assets_list:
            meta_keys.update(asset.get('metadata', {}).keys())
        sorted_meta = sorted(list(meta_keys))

        import io
        import csv
        from flask import Response
        
        output = io.StringIO()
        output.write('\ufeff') # BOM per costringere Excel a leggere l'UTF-8
        
        # Generazione Header dinamico
        headers = ['ID Seriale', 'Categoria', 'Campus', 'Latitudine', 'Longitudine', 'Data Creazione'] + [k.replace('_', ' ').title() for k in sorted_meta]
        writer = csv.writer(output, delimiter=';')
        writer.writerow(headers)

        # Popolamento Righe
        for asset in assets_list:
            cat_name = cat_cache.get(str(asset.get('category_id')), 'Sconosciuta')
            camp_name = get_cached_campus_name(asset.get('campus_id')) or asset.get('campus_id')
            coords = asset.get('geometry', {}).get('coordinates', ['', ''])
            lng = coords[0] if len(coords) > 0 else ''
            lat = coords[1] if len(coords) > 1 else ''
            
            # Troncamento orario, mostriamo solo la data
            created_at = asset.get('created_at', '')[:10]
            
            row = [str(asset.get('_id')), cat_name, camp_name, str(lat), str(lng), created_at]
            
            # Popolamento valori attributi dinamici
            meta = asset.get('metadata', {})
            for k in sorted_meta:
                val = meta.get(k, '')
                if isinstance(val, list):
                    val = ", ".join(map(str, val))
                elif isinstance(val, bool):
                    val = "Sì" if val else "No"
                row.append(str(val))
                
            writer.writerow(row)

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=assets_export.csv"}
        )

    except Exception as e:
        return error_response(f"Errore durante l'esportazione CSV: {str(e)}", 500)

# ===================================================================================
# ENDPOINT: Eliminazione di un Asset esistente (soft delete con tracciamento storico)
# ===================================================================================

@app.route('/api/assets/<asset_id>', methods=['DELETE'])
def delete_asset(asset_id):
    """
    Elimina fisicamente un asset dalla collezione corrente, ma ne conserva traccia
    nella collezione storica generando un evento di tipo DELETE.
    """
    auth = get_auth_context()
    user_id = auth.get('user_id')
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])

    if user_role not in ['OPERATORE', 'AMMINISTRATORE']:
        return error_response("Non hai i permessi per eliminare un asset", 403)

    if not ObjectId.is_valid(asset_id):
        return error_response("ID asset non valido", 400)

    try:
        # 1. Recupero l'asset prima di eliminarlo
        asset_to_delete = assets_col.find_one({"_id": ObjectId(asset_id)})
        
        if not asset_to_delete:
            return error_response("Asset non trovato", 404)

        # Controllo autorizzazione territoriale
        if user_role == 'OPERATORE' and asset_to_delete.get('campus_id') not in user_campuses:
            return error_response("Accesso negato: non puoi eliminare asset fuori dalla tua giurisdizione", 403)

        category_id = asset_to_delete.get('category_id')
        campus_id = asset_to_delete.get('campus_id')

        # 2. Registrazione dell'eliminazione nello storico (Audit Trail)
        timestamp = datetime.datetime.utcnow().isoformat()
        snapshot = {
            "asset_id": asset_id,
            "action": "DELETE",
            "actor_id": user_id,
            "timestamp": timestamp,
            "state_snapshot": asset_to_delete # Salviamo l'ultimo stato noto prima della cancellazione
        }
        history_col.insert_one(snapshot)

        # 3. Eliminazione fisica dalla collezione corrente
        assets_col.delete_one({"_id": ObjectId(asset_id)})

        # INIEZIONE NOMI PER LA TABELLA DEI LOG
        campus_name = get_cached_campus_name(campus_id)
        asset_name = extract_asset_name(asset_id)
        category = categories_col.find_one({"_id": ObjectId(category_id)})
        category_name = category.get('name', 'Sconosciuta') if category else 'Sconosciuta'

        # 4. Tracciabilità asincrona (RabbitMQ)
        publish_event("ASSET_DELETED", {
            "asset_id": asset_id,
            "asset_name": asset_name,
            "category_id": category_id,
            "category_name": category_name,
            "campus_id": campus_id,
            "campus_name": campus_name
        })

        return jsonify({"message": "Asset eliminato con successo"}), 200

    except Exception as e:
        return error_response(f"Errore durante l'eliminazione dell'asset: {str(e)}", 500)


# ===================================================================================
# ENDPOINT: Consultazione dello storico completo di un Asset 
# ===================================================================================
@app.route('/api/assets/<asset_id>/history', methods=['GET'])
def get_asset_history(asset_id):
    """
    Restituisce l'intero ciclo di vita di un asset, dal censimento originale 
    alle modifiche successive, fino all'eventuale eliminazione.
    """
    auth = get_auth_context()
    user_role = auth.get('role')
    user_campuses = auth.get('campus_ids', [])

    if not ObjectId.is_valid(asset_id):
        return error_response("ID asset non valido", 400)

    try:
        # Recupero lo stato attuale dell'asset per controllare i permessi territoriali
        current_asset = assets_col.find_one({"_id": ObjectId(asset_id)})
        
        # Se l'asset è stato cancellato (non è in assets_col), cerchiamo l'ultimo snapshot in history_col
        # per verificare a quale campus apparteneva e far scattare i dovuti controlli di sicurezza.
        if not current_asset:
            last_snapshot = history_col.find_one(
                {"asset_id": asset_id}, 
                sort=[("timestamp", -1)]
            )
            if not last_snapshot:
                return error_response("Nessuno storico trovato per questo asset", 404)
            current_asset = last_snapshot.get('state_snapshot', {})

        if user_role == 'OPERATORE' and current_asset.get('campus_id') not in user_campuses:
            return error_response("Accesso negato allo storico di questo asset", 403)

        # Estrazione di tutti gli snapshot ordinati cronologicamente (dal più vecchio al più recente)
        history_cursor = history_col.find({"asset_id": asset_id}).sort("timestamp", 1)
        history_list = list(history_cursor)
        
        serialized_history = [serialize_mongo_doc(record) for record in history_list]

        return jsonify({"asset_id": asset_id, "history": serialized_history}), 200

    except Exception as e:
        return error_response(f"Errore durante il recupero dello storico: {str(e)}", 500)
    
   
# ============================================================================
# CONSUMER ASINCRONO PER PULIZIA DATI ORFANI
# ============================================================================
def process_system_events(ch, method, properties, body):
    """Ascolta eventi di sistema come l'eliminazione di un Campus per pulire gli Asset."""
    try:
        payload = json.loads(body.decode('utf-8'))
        action = payload.get("azione")
        
        # <-- NUOVO: GESTIONE EVENT-DRIVEN CACHE DEI CAMPUS
        if action in ["CAMPUS_CREATED", "CAMPUS_UPDATED"]:
            campus_id = payload.get("campus_id")
            campus_name = payload.get("campus_name")
            if campus_id and campus_name:
                campus_cache_col.update_one(
                    {"_id": campus_id},
                    {"$set": {"name": campus_name}},
                    upsert=True
                )
        
        elif action == "CAMPUS_DELETED":
            campus_id = payload.get("campus_id")
            if campus_id:
                # 1. Rimuovi dalla cache locale
                campus_cache_col.delete_one({"_id": campus_id})
                
                campus_name = payload.get("campus_name", "Campus Sconosciuto")

                # Troviamo tutti gli asset del campus eliminato
                assets_to_delete = list(assets_col.find({"campus_id": campus_id}))
                
                for asset in assets_to_delete:
                    asset_id = str(asset['_id'])
                    category_id = asset.get('category_id')
                    metadata = asset.get('metadata', {})
                    
                    # 1. Tracciamento storico (Soft Delete Logico)
                    history_col.insert_one({
                        "asset_id": asset_id,
                        "action": "DELETE (CASCADE CAMPUS)",
                        "actor_id": "system",
                        "timestamp": datetime.datetime.utcnow().isoformat(),
                        "state_snapshot": asset
                    })
                    
                    # 2. Eliminazione fisica
                    assets_col.delete_one({"_id": ObjectId(asset_id)})
                    
                    # 3. Notifica agli altri servizi usando direttamente mq_manager 
                    # (perché siamo in un thread senza contesto di richiesta HTTP)
                    asset_name = extract_asset_name(asset_id)
                    category = categories_col.find_one({"_id": ObjectId(category_id)}) if category_id else None
                    category_name = category.get('name', 'Sconosciuta') if category else 'Sconosciuta'
                    
                    mq_manager.publish_event(
                        exchange_name='system_events',
                        action='ASSET_DELETED',
                        actor_id='system',
                        service_name='asset-service',
                        extra_data={
                            "asset_id": asset_id,
                            "asset_name": asset_name,
                            "category_id": category_id,
                            "category_name": category_name,
                            "campus_id": campus_id,
                            "campus_name": campus_name,
                            "email": "System Auto"
                        }
                    )
                    
        # Ack manuale se auto_ack=False 
        if ch.is_open and not getattr(ch, 'auto_ack', True):
            ch.basic_ack(delivery_tag=method.delivery_tag)
            
    except Exception as e:
        print(f"[ASSET SERVICE] Errore elaborazione evento asincrono: {str(e)}")

def start_consumer_thread():
    """Avvia il consumer asincrono in background."""
    thread = threading.Thread(
        target=mq_manager.start_consumer, 
        kwargs={
            'exchange_name': 'system_events',
            'callback_function': process_system_events,
            'queue_name': 'asset_service_queue',
            'durable_queue': True
        },
        daemon=True
    )
    thread.start()

# ============================================================================
# ENTRY POINT
# ============================================================================
start_consumer_thread()

if __name__ == '__main__':
    start_consumer_thread()
    app.run(host='0.0.0.0', port=5000)