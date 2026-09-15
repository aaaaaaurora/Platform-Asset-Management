import os
import uuid
import datetime
import enum
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import text
import json
import threading

# Assumo la presenza del modulo condiviso come negli altri servizi
from shared_utils.messaging import RabbitMQManager 

app = Flask(__name__)

# Configurazione 
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@db:5432/warning_db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Servizi esterni
RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq-service:5672/')
mq_manager = RabbitMQManager(rabbitmq_url=RABBITMQ_URL)

# ==========================================
# ENUM & MODELS
# ==========================================
class WarningStatus(enum.Enum):
    aperta = 'aperta'
    chiusa = 'chiusa'
    annullata = 'annullata'

class MaintenanceType(enum.Enum):
    preventiva = 'preventiva'
    correttiva = 'correttiva'

class Warning(db.Model):
    __tablename__ = 'warning'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = db.Column(db.String(24), nullable=False)
    category_id = db.Column(db.String(24), nullable=False) # AGGIUNTO
    campus_id = db.Column(UUID(as_uuid=True), nullable=False)
    reporter_id = db.Column(UUID(as_uuid=True), nullable=False)
    description = db.Column(db.Text, nullable=False)
    status = db.Column(db.Enum(WarningStatus), default=WarningStatus.aperta)
    created_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class MaintenanceIntervention(db.Model):
    __tablename__ = 'maintenance_intervention'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = db.Column(db.String(24), nullable=False)
    campus_id = db.Column(UUID(as_uuid=True), nullable=False)
    operator_id = db.Column(db.String(36), nullable=False) # Permettiamo sia UUID operatore che identificativi come 'system'
    warning_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warning.id'), nullable=True)
    intervention_type = db.Column(db.Enum(MaintenanceType), nullable=False)
    technical_note = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow)
    
class LocalAssetCache(db.Model):
    __tablename__ = 'local_asset_cache'
    asset_id = db.Column(db.String(24), primary_key=True)
    category_id = db.Column(db.String(24), nullable=False) # AGGIUNTO
    campus_id = db.Column(UUID(as_uuid=True), nullable=False)
    
    campus_name = db.Column(db.String(100), nullable=True)
    asset_name = db.Column(db.String(255), nullable=True)

# ==========================================
# UTILITIES
# ==========================================
def get_auth_context():
    """Estrae i dati di autorizzazione forniti dal Gateway."""
    return {
        'user_id': request.headers.get('X-User-Id'),
        'role': request.headers.get('X-User-Role'),
        'email': request.headers.get('X-User-Email'), 
        'campus_ids': request.headers.get('X-Campus-Ids', '').split(',') if request.headers.get('X-Campus-Ids') else []
    }

def publish_audit(action, entity_id, actor_id, campus_id, payload_details):
    """Sfrutta il Manager centralizzato per emettere log asincroni."""
    auth_ctx = get_auth_context()
    
    event_data = {
        "azione": action,
        "entity_id": str(entity_id),
        "autore_id": str(actor_id),
        "campus_id": str(campus_id)
    }
    
    # Unisce i dettagli direttamente alla radice del dizionario 
    if payload_details:
        event_data.update(payload_details)
    
    # <-- Usa la mail se è una chiamata API. Usa 'System' se è chiamato dal consumer background.
    if auth_ctx.get('email'):
        event_data['email'] = auth_ctx.get('email')
    elif str(actor_id) == 'system':
        event_data['email'] = 'Sistema Automatico'
        
    mq_manager.publish_event('system_events', action, str(actor_id), 'warning-service', event_data)
    
# ==========================================
# CONSUMER ASINCRONO PER CACHE ASSET E WARNINGS
# ==========================================
def process_asset_events(ch, method, properties, body):
    """Callback per elaborare gli eventi dell'Asset Service e aggiornare la cache locale."""
    with app.app_context():
        try:
            payload = json.loads(body.decode('utf-8'))
            action = payload.get("azione")
            
            # Intercettiamo solo gli eventi legati agli asset
            if action in ["ASSET_CREATED", "ASSET_UPDATED"]:
                asset_id = payload.get("asset_id")
                campus_id = payload.get("campus_id")
                category_id = payload.get("category_id")
                
                campus_name = payload.get("campus_name")
                asset_name = payload.get("asset_name")
                
                if asset_id and campus_id and category_id:
                    campus_uuid = uuid.UUID(campus_id)
                    asset = db.session.get(LocalAssetCache, asset_id)
                    
                    if not asset:
                        asset = LocalAssetCache(
                            asset_id=asset_id, 
                            category_id=category_id,
                            campus_id=campus_uuid,
                            campus_name=campus_name,
                            asset_name=asset_name
                        )
                        db.session.add(asset)
                    else:
                        asset.category_id = category_id
                        asset.campus_id = campus_uuid
                        asset.campus_name = campus_name
                        asset.asset_name = asset_name
                        
                    db.session.commit()
                    
            elif action == "ASSET_DELETED":
                asset_id = payload.get("asset_id")
                if asset_id:
                    # 1. Recuperiamo le informazioni sull'asset prima di eliminarlo dalla cache locale
                    asset = db.session.get(LocalAssetCache, asset_id)
                    campus_name = asset.campus_name if asset else None
                    category_id = asset.category_id if asset else None
                    asset_name = asset.asset_name if asset else None

                    # 2. Recuperiamo i ticket pendenti collegati a questo asset
                    pending_warnings = db.session.query(Warning.id, Warning.campus_id).filter_by(asset_id=asset_id, status=WarningStatus.aperta).all()
                    
                    if pending_warnings:
                        # Aggiornamento diretto SQL per marcare le segnalazioni come annullate
                        update_sql = text("UPDATE warning SET status = 'annullata', updated_at = NOW() WHERE asset_id = :asset_id AND status = 'aperta'")
                        db.session.execute(update_sql, {'asset_id': asset_id})
                        
                        for w_id, w_campus_id in pending_warnings:
                            # Aggiungiamo un intervento di sistema per tracciabilità
                            auto_maintenance = MaintenanceIntervention(
                                asset_id=asset_id,
                                campus_id=w_campus_id,
                                operator_id='system', 
                                warning_id=w_id,
                                intervention_type=MaintenanceType.correttiva,
                                technical_note="Segnalazione annullata automaticamente: l'asset associato è stato eliminato."
                            )
                            db.session.add(auto_maintenance)
                            db.session.flush()

                            # 3. PUBBLICAZIONE DIRETTA 
                            event_data = {
                                "azione": "CANCEL_WARNING",
                                "entity_id": str(w_id),
                                "autore_id": "system",
                                "campus_id": str(w_campus_id),
                                "asset_id": asset_id,
                                "status_precedente": "aperta",
                                "status_nuovo": "annullata",
                                "maintenance_id": str(auto_maintenance.id),
                                "campus_name": campus_name, 
                                "category_id": str(category_id),
                                "asset_name": asset_name,
                                "email": "System Auto"
                            }
                            mq_manager.publish_event('system_events', 'CANCEL_WARNING', 'system', 'warning-service', event_data)

                    # 4. Eliminiamo l'asset dalla cache locale
                    if asset:
                        db.session.delete(asset)
                    
                    db.session.commit()
            
            elif action == "CAMPUS_DELETED":
                campus_id = payload.get("campus_id")
                if campus_id:
                    campus_uuid = uuid.UUID(campus_id)
                    
                    update_sql = text("UPDATE warning SET status = 'annullata', updated_at = NOW() WHERE campus_id = :campus_id AND status = 'aperta'")
                    db.session.execute(update_sql, {'campus_id': campus_uuid})
                    
                    db.session.query(LocalAssetCache).filter_by(campus_id=campus_uuid).delete()
                    db.session.commit()
                    
            # Ack manuale 
            if ch.is_open and not getattr(ch, 'auto_ack', True):
                ch.basic_ack(delivery_tag=method.delivery_tag)
                
        except Exception as e:
            print(f"[WARNING SERVICE] Errore elaborazione evento asincrono: {str(e)}")
            db.session.rollback()

def start_consumer_thread():
    """Avvia il consumer asincrono in background utilizzando il RabbitMQManager."""
    thread = threading.Thread(
        target=mq_manager.start_consumer, 
        kwargs={
            'exchange_name': 'system_events',
            'callback_function': process_asset_events,
            'queue_name': 'warning_service_queue',
            'durable_queue': True
        },
        daemon=True
    )
    thread.start()

# ==========================================
# ENDPOINT INFRASTRUTTURALE: Health Check
# ==========================================
@app.route('/health', methods=['GET'])
def health_check():
    """
    Endpoint per i Liveness e Readiness Probe di Kubernetes.
    Restituisce un segnale di Heartbeat.
    """
    return jsonify({"status": "healthy"}), 200

# ==========================================
# ENDPOINT: US 6-1
# ==========================================
@app.route('/warnings', methods=['POST'])
def create_warning():
    """Creazione di una segnalazione pubblica su un asset esistente."""
    auth_ctx = get_auth_context()
    reporter_id = auth_ctx.get('user_id')
    
    if not reporter_id:
        return jsonify({"error": "Utente non autenticato o intestazioni Gateway mancanti"}), 401

    data = request.get_json()
    if not data:
        return jsonify({"error": "Payload mancante"}), 400

    asset_id_str = data.get('asset_id')
    description = data.get('descrizione')

    # Validazione input
    if not description or str(description).strip() == "":
        return jsonify({"error": "La descrizione della segnalazione è obbligatoria"}), 400
        
    if not asset_id_str:
        return jsonify({"error": "L'ID dell'asset è obbligatorio"}), 400

    # Verifica locale dell'Asset (Event-Carried State Transfer)
    local_asset = db.session.get(LocalAssetCache, asset_id_str)
    if not local_asset:
        return jsonify({"error": "Asset indicato non esiste a sistema (cache miss)"}), 404
        
    campus_id_str = str(local_asset.campus_id)

    try:
        campus_uuid = uuid.UUID(campus_id_str)
        reporter_uuid = uuid.UUID(reporter_id)
    except ValueError:
        return jsonify({"error": "Formato ID non valido"}), 400

    # Creazione record
    new_warning = Warning(
        asset_id=asset_id_str,
        category_id=local_asset.category_id, # AGGIUNTO
        campus_id=campus_uuid,
        reporter_id=reporter_uuid,
        description=description.strip()
    )

    try:
        db.session.add(new_warning)
        db.session.flush() # Ottiene l'ID generato da Postgres prima del commit
        warning_id = str(new_warning.id)
        db.session.commit()

        # Inoltro Evento Asincrono con i nomi estratti dalla cache
        publish_audit(
            action="CREATE_WARNING",
            entity_id=warning_id,
            actor_id=reporter_id,
            campus_id=campus_id_str,
            payload_details={
                "asset_id": str(asset_id_str), 
                "status": "aperta",
                "campus_name": local_asset.campus_name, 
                "category_id": str(local_asset.category_id),
                "asset_name": local_asset.asset_name   
            }
        )

        return jsonify({
            "warning_id": warning_id,
            "status": "aperta"
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Errore interno del server: {str(e)}"}), 500
  
# ==========================================
# ENDPOINT: US 6-2
# ==========================================
@app.route('/warnings', methods=['GET'])
def get_warnings():
    """
    Recupera l'elenco delle segnalazioni. 
    Applica implicitamente il filtro territoriale in base al ruolo dell'utente.
    """
    auth_ctx = get_auth_context()
    user_role = auth_ctx.get('role')
    authorized_campus_ids = auth_ctx.get('campus_ids', [])

    # Filtri opzionali da query string
    req_campus_id = request.args.get('campus_id')
    req_status = request.args.get('status')
    req_category_id = request.args.get('category_id') # <-- AGGIUNTO

    # Inizializziamo la query di base
    query = Warning.query

    # 1. Filtro territoriale implicito di Sicurezza (RBAC)
    if user_role == 'OPERATORE':
        if not authorized_campus_ids:
            # Operatore configurato come "Zero-Campus": restituisce array vuoto
            return jsonify([]), 200
        
        # Converte le stringhe in UUID per la query su Postgres
        try:
            campus_uuids = [uuid.UUID(c) for c in authorized_campus_ids]
            query = query.filter(Warning.campus_id.in_(campus_uuids))
        except ValueError:
            return jsonify({"error": "Formato ID Campus autorizzati non valido"}), 400

    # 2. Filtro esplicito per Campus richiesto dal client
    if req_campus_id:
        try:
            req_campus_uuid = uuid.UUID(req_campus_id)
            # Se l'operatore richiede un campus, verifichiamo che sia tra quelli a lui assegnati
            if user_role == 'OPERATORE' and req_campus_id not in authorized_campus_ids:
                return jsonify([]), 200
            
            query = query.filter(Warning.campus_id == req_campus_uuid)
        except ValueError:
            return jsonify({"error": "Formato ID Campus richiesto non valido"}), 400

    # 3. Filtro per stato (es. ?status=aperta)
    if req_status:
        try:
            # Mappa la stringa ricevuta sull'Enum
            status_enum = WarningStatus[req_status.lower()]
            query = query.filter(Warning.status == status_enum)
        except KeyError:
            return jsonify({"error": "Stato segnalazione non valido"}), 400

    # 4. Filtro per categoria (AGGIUNTO)
    if req_category_id:
        query = query.filter(Warning.category_id == req_category_id)

    # Ordina per data di creazione decrescente (le più recenti prima)
    query = query.order_by(Warning.created_at.desc())

    # Esecuzione query
    warnings = query.all()

    # Formattazione della risposta JSON
    result = [{
        "id": str(w.id),
        "asset_id": str(w.asset_id),
        "category_id": str(w.category_id),
        "descrizione": w.description,
        "status": w.status.value,
        "campus_id": str(w.campus_id),
        "created_at": w.created_at.isoformat()
    } for w in warnings]

    return jsonify(result), 200

# ==========================================
# ENDPOINT: US 6-3 (Risoluzione Segnalazione)
# ==========================================
@app.route('/warnings/<warning_id_str>/resolve', methods=['PATCH'])
def resolve_warning(warning_id_str):
    """
    Registra la nota tecnica dell'intervento e chiude formalmente la segnalazione.
    Genera un record immutabile di manutenzione correlato.
    """
    auth_ctx = get_auth_context()
    user_role = auth_ctx.get('role')
    user_id = auth_ctx.get('user_id')
    authorized_campus_ids = auth_ctx.get('campus_ids', [])

    # Solo gli operatori possono chiudere le segnalazioni
    if not user_id or user_role != 'OPERATORE':
        return jsonify({"error": "Operazione riservata agli Operatori"}), 403

    try:
        warning_uuid = uuid.UUID(warning_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID segnalazione non valido"}), 400

    # 1. Recupero della segnalazione
    warning = db.session.get(Warning, warning_uuid)
    if not warning:
        return jsonify({"error": "Segnalazione non trovata"}), 404

    # 2. Controllo Isolamento Territoriale (RBAC)
    if str(warning.campus_id) not in authorized_campus_ids:
        return jsonify({"error": "Non sei autorizzato a operare sugli asset di questo campus"}), 403

    # 3. Controllo Stato Logico
    if warning.status == WarningStatus.chiusa or warning.status == WarningStatus.annullata:
        return jsonify({"error": "La segnalazione è già stata chiusa o annullata"}), 400

    # 4. Estrazione Payload
    data = request.get_json()
    if not data:
        return jsonify({"error": "Payload mancante"}), 400

    technical_note = data.get('nota_intervento')

    # 5. Validazione Input (Eccezione EMPTY_REPORT definita nello SDA)
    if not technical_note or str(technical_note).strip() == "":
        return jsonify({"error": "EMPTY_REPORT: La nota tecnica dell'intervento è obbligatoria"}), 400

    local_asset = db.session.get(LocalAssetCache, warning.asset_id)

    try:
        # Transazione Atomica: Aggiornamento Segnalazione + Creazione Intervento
        
        # A. Chiusura del ticket pubblico
        warning.status = WarningStatus.chiusa
        # NB: il trigger Postgres "set_warning_updated_at" aggiornerà in automatico la colonna updated_at
        
        # B. Registrazione permanente della manutenzione 
        new_maintenance = MaintenanceIntervention(
            asset_id=warning.asset_id,
            campus_id=warning.campus_id,
            operator_id=user_id,
            warning_id=warning.id,
            intervention_type=MaintenanceType.correttiva, # Correttiva in quanto evasa da una segnalazione
            technical_note=technical_note.strip()
        )
        
        db.session.add(new_maintenance)
        db.session.commit()

        # C. Pubblicazione evento RabbitMQ con nomi inclusi
        publish_audit(
            action="RESOLVE_WARNING",
            entity_id=warning_id_str,
            actor_id=user_id,
            campus_id=str(warning.campus_id),
            payload_details={
                "asset_id": str(warning.asset_id),
                "status_precedente": "aperta",
                "status_nuovo": "chiusa",
                "maintenance_id": str(new_maintenance.id),
                "campus_name": local_asset.campus_name if local_asset else None, 
                "category_id": str(warning.category_id),
                "asset_name": local_asset.asset_name if local_asset else None    
            }
        )

        return jsonify({
            "warning_id": warning_id_str,
            "status": "chiusa"
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Errore interno del server: {str(e)}"}), 500
    
# ==========================================
# ENDPOINT: US 4-3 & US 6-3 (Manutenzione Diretta)
# ==========================================
@app.route('/maintenances', methods=['POST'])
def create_maintenance():
    """
    Registra un'attività di manutenzione preventiva o correttiva su un asset,
    senza richiedere la preesistenza di una segnalazione pubblica.
    """
    auth_ctx = get_auth_context()
    user_role = auth_ctx.get('role')
    user_id = auth_ctx.get('user_id')
    authorized_campus_ids = auth_ctx.get('campus_ids', [])

    # Sicurezza: solo gli Operatori possono registrare manutenzioni
    if not user_id or user_role != 'OPERATORE':
        return jsonify({"error": "Operazione riservata agli Operatori"}), 403

    data = request.get_json()
    if not data:
        return jsonify({"error": "Payload mancante"}), 400

    asset_id_str = data.get('asset_id')
    technical_note = data.get('nota_intervento')
    m_type_str = data.get('tipo_intervento', 'preventiva').lower()

    # Validazione campi obbligatori
    if not asset_id_str:
        return jsonify({"error": "L'ID dell'asset è obbligatorio"}), 400
    if not technical_note or str(technical_note).strip() == "":
        return jsonify({"error": "La nota tecnica dell'intervento è obbligatoria"}), 400

    # Validazione Enum tipo intervento
    try:
        m_type_enum = MaintenanceType[m_type_str]
    except KeyError:
        return jsonify({"error": "Tipo intervento non valido. Usa 'preventiva' o 'correttiva'"}), 400

    # 1. Verifica locale dell'Asset (Event-Carried State Transfer)
    local_asset = db.session.get(LocalAssetCache, asset_id_str)
    if not local_asset:
        return jsonify({"error": "Asset indicato non esiste a sistema (cache miss)"}), 404
        
    campus_id_str = str(local_asset.campus_id)
    
    # 2. Controllo di Autorizzazione (RBAC) Territoriale
    if campus_id_str not in authorized_campus_ids:
        return jsonify({"error": "Non sei autorizzato a operare sugli asset di questo campus"}), 403

    try:
        campus_uuid = uuid.UUID(campus_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID non valido"}), 400

    # 3. Creazione record (Senza collegamento a warning)
    new_maintenance = MaintenanceIntervention(
        asset_id=asset_id_str, 
        campus_id=campus_uuid,
        operator_id=user_id,
        warning_id=None, # Manutenzione diretta
        intervention_type=m_type_enum,
        technical_note=technical_note.strip()
    )

    try:
        db.session.add(new_maintenance)
        db.session.flush() # Forza la generazione dell'ID in Postgres
        maintenance_id = str(new_maintenance.id)
        db.session.commit()

        # 4. Pubblicazione evento RabbitMQ con nomi inclusi
        publish_audit(
            action="LOG_MAINTENANCE",
            entity_id=maintenance_id,
            actor_id=user_id,
            campus_id=campus_id_str,
            payload_details={
                "asset_id": asset_id_str,
                "tipo_intervento": m_type_enum.value,
                "campus_name": local_asset.campus_name, 
                "category_id": str(local_asset.category_id),
                "asset_name": local_asset.asset_name    
            }
        )

        return jsonify({
            "maintenance_id": maintenance_id,
            "status": "registrata"
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Errore interno del server: {str(e)}"}), 500
    
# ============================================================================
# ENTRY POINT
# ============================================================================
start_consumer_thread()

if __name__ == '__main__':
    # Avvia il processo in background per ascoltare gli eventi RabbitMQ 
    start_consumer_thread()
    
    app.run(host='0.0.0.0', port=5000)