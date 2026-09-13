import os
import datetime
import json
import jwt
import pyotp
import enum
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID
import threading
from google.auth.transport import requests
import logging
import requests
from shared_utils.messaging import RabbitMQManager
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import requests

# ============================================================================
# INIZIALIZZAZIONE E CONFIGURAZIONE
# ============================================================================
app = Flask(__name__)

# Lettura delle variabili d'ambiente fornite dal manifest Kubernetes/Docker
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@db:5432/auth_db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET'] = os.getenv('JWT_SECRET', 'super-secret-key-fallback')

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq-service:5672/')
TOTP_ISSUER_NAME = os.getenv('TOTP_ISSUER_NAME', 'Campus_Management')
# Aggiunta Client ID di Google
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '644506126338-fvtr7mf0jpa9dusa58g8ilt0e9d2ftsr.apps.googleusercontent.com')

db = SQLAlchemy(app)

# Inizializzazione del Manager centralizzato di RabbitMQ
mq_manager = RabbitMQManager(rabbitmq_url=RABBITMQ_URL)

# ============================================================================
# MODELLI DATABASE RELAZIONALE (PostgreSQL)
# ============================================================================

class RoleType(enum.Enum):
    GUEST = 'GUEST'
    OPERATORE = 'OPERATORE'
    AMMINISTRATORE = 'AMMINISTRATORE'

class Role(db.Model):
    __tablename__ = 'role'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=db.text('uuid_generate_v4()'))
    name = db.Column(db.Enum(RoleType), unique=True, nullable=False) 
    description = db.Column(db.String(255))

class AppUser(db.Model):
    __tablename__ = 'app_user'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=db.text('uuid_generate_v4()'))
    email = db.Column(db.String(255), unique=True, nullable=False)
    google_id = db.Column(db.String(255), unique=True)
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('role.id'), nullable=False)
    totp_secret = db.Column(db.String(64))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), onupdate=datetime.datetime.utcnow)

class UserCampus(db.Model):
    __tablename__ = 'user_campus'
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('app_user.id'), primary_key=True)
    campus_id = db.Column(UUID(as_uuid=True), primary_key=True) # Soft link al GeoZone Service

class UserCategory(db.Model):
    __tablename__ = 'user_category'
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('app_user.id'), primary_key=True)
    category_id = db.Column(db.String(24), primary_key=True) # Soft link all'Asset Service

# ============================================================================
# FUNZIONI DI UTILITA'
# ============================================================================

def verify_google_token(token):
    """ 
    Validazione unificata: gestisce sia l'id_token (App Mobile/Capacitor) 
    sia l'access_token (Web App/React).
    """
    if not token or token == "invalid":
        return None
        
    # Un id_token (JWT) è sempre composto da 3 parti separate da punti.
    is_jwt = len(token.split('.')) == 3
 
    if is_jwt:
        # 1. FLUSSO MOBILE: Validazione id_token 
        try:
            idinfo = id_token.verify_oauth2_token(
                token, 
                google_requests.Request(), 
                app.config.get('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID),
                clock_skew_in_seconds=10 
            )
            # Verifica opzionale dell'audience (Client ID Android)
            if idinfo['aud'] not in [GOOGLE_CLIENT_ID, 'INSERISCI_QUI_IL_TUO_CLIENT_ID_ANDROID']:
                print("Audience non riconosciuta.", flush=True)
                return None
            return idinfo
        except ValueError as e:
            print(f"Errore validazione id_token mobile: {e}", flush=True)
            return None
    else:
        # 2. FLUSSO WEB: Validazione access_token
        try:
            google_api_url = f"https://www.googleapis.com/oauth2/v3/userinfo?access_token={token}"
            response = requests.get(google_api_url)
            
            if response.status_code != 200:
                print(f"ERRORE GOOGLE API (WEB): {response.text}", flush=True)
                return None
                
            return response.json()
        except Exception as e:
            print(f"ERRORE CRITICO VERIFICA TOKEN WEB: {e}", flush=True)
            return None

def publish_audit_event(action, actor_id, extra_data=None):
    """
    Pubblica un evento asincrono sul Message Broker (RabbitMQ).
    Arricchisce automaticamente l'evento con l'email prelevandola dal DB.
    """
    if extra_data is None:
        extra_data = {}
        
    if actor_id:
        try:
            # Recuperiamo l'utente dal database in modo efficiente
            user = db.session.get(AppUser, actor_id)
            if user and user.email:
                extra_data['email'] = user.email
        except Exception as e:
            print(f"Errore recupero email per audit log: {e}", flush=True)

    mq_manager.publish_event(
        exchange_name='system_events',
        action=action,
        actor_id=str(actor_id) if actor_id else None,
        service_name='auth-service',
        extra_data=extra_data if extra_data else None
    )

def error_response(message, status_code):
    """
    Standardizza le risposte di errore in formato JSON.
    """
    return jsonify({"error": message}), status_code


# ============================================================================
# ENDPOINT per il Liveness e Readiness Probe di Kubernetes
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint per i Liveness e Readiness Probe di Kubernetes."""
    return jsonify({"status": "healthy"}), 200


# ============================================================================
# ENDPOINT RESTful
# ============================================================================

@app.route('/auth/google', methods=['POST'])
def auth_google():
    """
    Gestisce l'autenticazione primaria tramite Google OAuth e l'Auto-Provisioning.
    """
    data = request.get_json()
    if not data or 'google_id_token' not in data:
        return error_response("Token mancante nel payload", 400)

    google_id_token = data.get('google_id_token')

    # Validazione del token presso il provider di identità
    google_user_info = verify_google_token(google_id_token)
    if not google_user_info:
        return error_response("LOGIN_CANCELLED", 400)

    email = google_user_info.get('email')
    
    # Ricerca dell'utente nel database tramite email
    user = AppUser.query.filter_by(email=email).first()

    if not user:
        # NON salviamo nel DB! Generiamo il segreto e impacchettiamo tutto nel token temporaneo.
        totp_secret = pyotp.random_base32()
        
        temp_payload = {
            "is_new_user": True,
            "email": email,
            "google_id": google_user_info.get('sub'),
            "first_name": google_user_info.get('given_name'),
            "last_name": google_user_info.get('family_name'),
            "totp_secret": totp_secret,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=10) # 10 minuti per dare tempo di scansionare il QR
        }
        temp_token = jwt.encode(temp_payload, app.config['JWT_SECRET'], algorithm="HS256")
        
        # Generiamo il link per il QR Code
        totp = pyotp.TOTP(totp_secret)
        totp_uri = totp.provisioning_uri(name=email, issuer_name="Asset Management Unisa")

        return jsonify({
            "temp_token": temp_token,
            "totp_uri": totp_uri, # Passiamo il link al frontend
            "user": {
                "email": email,
                "name": f"{google_user_info.get('given_name')} {google_user_info.get('family_name')}"
            }
        }), 200

    else:
        # --- UTENTE ESISTENTE (Es. Operatore pre-registrato dall'Admin) ---
        is_first_login = False
        
        # Se non ha il google_id, è il suo primissimo accesso!
        if not user.google_id:
            is_first_login = True
            user.google_id = google_user_info.get('sub')
            
            # Salviamo Nome e Cognome estratti da Google
            user.first_name = google_user_info.get('given_name', '')
            user.last_name = google_user_info.get('family_name', '')
            db.session.commit()
    
        if not user.is_active:
            publish_audit_event("DISABLED_ACCOUNT_LOGIN_ATTEMPT", user.id)
            return error_response("Account disabilitato", 403)

        # Generazione Token Temporaneo standard
        temp_payload = {
            "user_id": str(user.id),
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=5)
        }
        temp_token = jwt.encode(temp_payload, app.config['JWT_SECRET'], algorithm="HS256")

        publish_audit_event("GOOGLE_LOGIN_SUCCESS", user.id)

        # Costruiamo la risposta base
        response_data = {
            "temp_token": temp_token,
            "user": {
                "email": user.email,
                "name": f"{user.first_name or ''} {user.last_name or ''}".strip()
            }
        }

        # Se è il primissimo accesso, inviamo il totp_uri per stampare il QR Code sul frontend
        if is_first_login and user.totp_secret:
            totp = pyotp.TOTP(user.totp_secret)
            response_data["totp_uri"] = totp.provisioning_uri(name=user.email, issuer_name="Asset Management Unisa")

        return jsonify(response_data), 200


# ============================================================================
# ENDPOINT: Verifica 2FA e Generazione JWT Definitivo 
# ============================================================================

@app.route('/auth/2fa/verify', methods=['POST'])
def verify_2fa():
    """
    Valida il codice TOTP (Microsoft Authenticator) e 
    genera il JWT definitivo aggregando i permessi dell'utente.
    """
    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)
        
    temp_token = data.get('temp_token')
    totp_code = data.get('totp_code')

    if not temp_token or not totp_code:
        return error_response("Parametri mancanti: temp_token e totp_code sono obbligatori", 400)

    # Validazione del Token Temporaneo
    try:
        decoded_temp = jwt.decode(temp_token, app.config['JWT_SECRET'], algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return error_response("EXPIRED_CODE", 401)
    except jwt.InvalidTokenError:
        return error_response("INVALID_CODE", 401)

    # Capiamo se stiamo validando un utente nuovo o uno esistente
    is_new_user = decoded_temp.get('is_new_user', False)

    if is_new_user:
        
        totp_secret = decoded_temp.get('totp_secret')
        totp = pyotp.TOTP(totp_secret)
        
        # Validazione del codice prima di toccare il DB
        if not totp.verify(totp_code, valid_window=0):
            return error_response("INVALID_CODE", 401)
            
        # 1. Il codice è corretto! Ora possiamo creare l'utente nel Database
        guest_role = Role.query.filter_by(name=RoleType.GUEST).first()
        if not guest_role:
            return error_response("Configurazione di sistema mancante: Ruolo di base non trovato", 500)
            
        user = AppUser(
            email=decoded_temp.get('email'),
            google_id=decoded_temp.get('google_id'),
            first_name=decoded_temp.get('first_name'),
            last_name=decoded_temp.get('last_name'),
            role_id=guest_role.id,
            totp_secret=totp_secret
        )
        db.session.add(user)
        db.session.commit()
        
        publish_audit_event("AUTO_PROVISIONING_GUEST", user.id)

    else:
        # --- FLUSSO UTENTE ESISTENTE ---
        user_id = decoded_temp.get('user_id')
        user = db.session.get(AppUser, user_id)
        
        if not user:
            return error_response("Utente non trovato", 404)
            
        if not user.is_active:
            publish_audit_event("DISABLED_ACCOUNT_2FA_ATTEMPT", user.id)
            return error_response("Account disabilitato", 403)

        # Validazione del Codice TOTP
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(totp_code):
            publish_audit_event("2FA_FAILED", user.id)
            return error_response("INVALID_CODE", 401)

    # --- CODICE IN COMUNE: Denormalizzazione e Costruzione Payload JWT ---
    role = db.session.get(Role, user.role_id)
    
    campus_links = UserCampus.query.filter_by(user_id=user.id).all()
    campus_ids = [str(link.campus_id) for link in campus_links]
    
    category_link = UserCategory.query.filter_by(user_id=user.id).first()
    category_id = str(category_link.category_id) if category_link else None

    jwt_payload = {
        "sub": str(user.id),
        "role": role.name.value,  # Estrae la stringa dall'Enum
        "campus_ids": campus_ids,
        "category_id": category_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=8),
        "first_name": user.first_name,
        "email": user.email       
    }

    final_token = jwt.encode(jwt_payload, app.config['JWT_SECRET'], algorithm="HS256")
    publish_audit_event("2FA_SUCCESS_LOGIN", user.id)

    return jsonify({
        "token": final_token,
        "role": role.name.value,
        "campus_ids": campus_ids,
        "category_id": category_id
    }), 200
 
# ===============================================================================
# ENDPOINT per la creazione di un nuovo profilo Operatore (Amministratore)
# ===============================================================================  
@app.route('/admin/operators', methods=['POST'])
def create_operator():
    """
    Endpoint riservato agli Amministratori per la creazione di un nuovo profilo Operatore.
    Si assume che l'API Gateway abbia già validato il token JWT e i permessi di Amministratore.
    """
    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)
        
    email = data.get('email')
    category_id = data.get('category_id')
    campus_ids = data.get('campus_ids', []) 

    if not email:
        return error_response("L'indirizzo email è obbligatorio", 400)

    # Eccezione UC-AMM-08: E-mail già presente
    existing_user = AppUser.query.filter_by(email=email).first()
    if existing_user:
        return error_response("Utente già presente a sistema", 409)

    # Recupero del ruolo Operatore dal dizionario statico
    operator_role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    if not operator_role:
        return error_response("Errore di configurazione: Ruolo 'OPERATORE' non trovato", 500)

    # Generazione del segreto TOTP per Microsoft Authenticator
    totp_secret = pyotp.random_base32()
    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=email, 
        issuer_name=TOTP_ISSUER_NAME
    )

    # Creazione anagrafica utente (il google_id sarà popolato al primo login)
    new_operator = AppUser(
        email=email,
        role_id=operator_role.id,
        totp_secret=totp_secret
    )
    
    db.session.add(new_operator)
    # Esegue la query senza chiudere la transazione per ottenere l'UUID generato da PostgreSQL
    db.session.flush() 

    # Assegnazione Categoria Operativa (Soft Link)
    if category_id:
        user_category = UserCategory(user_id=new_operator.id, category_id=category_id)
        db.session.add(user_category)

    # Assegnazione Giurisdizione Territoriale (Soft Links multipli)
    # Se campus_ids è vuoto, l'anagrafica viene creata come "Zero-Campus Operator"
    for c_id in campus_ids:
        user_campus = UserCampus(user_id=new_operator.id, campus_id=c_id)
        db.session.add(user_campus)

    try:
        db.session.commit()
        
        # Recupera l'ID dell'admin dagli header passati dal Gateway
        admin_id = request.headers.get('X-User-Id')
        
        # Inietta l'email dell'operatore creato nel log affinché compaia nella colonna "Entità"
        publish_audit_event(
            "CREATE_OPERATOR_PROFILE", 
            admin_id,
            extra_data={"entity_name": email} 
        )
        
        return jsonify({
            "status": "created",
            "user_id": str(new_operator.id),
            "totp_provisioning_uri": totp_uri
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return error_response(f"Errore durante il salvataggio: {str(e)}", 500)
    
# ===============================================================================
# ENDPOINT per l'aggiornamento di un profilo Operatore esistente (Amministratore)
# ===============================================================================
@app.route('/admin/operators/<uuid:user_id>', methods=['PUT'])
def update_operator(user_id):
    """
    Endpoint riservato agli Amministratori per l'aggiornamento di un profilo Operatore.
    Soddisfa le US 1-5, US 1-6 e l'UC-AMM-08 (Aggiornamento profilo esistente).
    """
    # 1. Verifica esistenza e validità dell'utente
    user = db.session.get(AppUser, user_id)
    if not user:
        return error_response("Utente non trovato", 404)

    # Assicuriamo che l'utente da modificare sia effettivamente un Operatore
    operator_role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    if user.role_id != operator_role.id:
        return error_response("L'utente specificato non è un Operatore", 400)

    # 2. Estrazione payload
    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    category_id = data.get('category_id')
    campus_ids = data.get('campus_ids')

    try:
        # 3. Aggiornamento Categoria (US 1-5)
        if category_id is not None:
            # Rimuove il vecchio soft link
            UserCategory.query.filter_by(user_id=user.id).delete()
            # Se la stringa non è vuota, crea il nuovo link
            if category_id != "":
                new_category = UserCategory(user_id=user.id, category_id=category_id)
                db.session.add(new_category)

        # 4. Aggiornamento Campus (US 1-6)
        if campus_ids is not None:
            # Rimuove i vecchi soft link territoriali
            UserCampus.query.filter_by(user_id=user.id).delete()
            # Inserisce i nuovi link (può essere una lista vuota per lo Zero-Campus)
            for c_id in campus_ids:
                new_campus = UserCampus(user_id=user.id, campus_id=c_id)
                db.session.add(new_campus)

        # 5. Consolidamento transazione
        db.session.commit()
        
        # 6. Tracciabilità 
        admin_id = request.headers.get('X-User-Id')
        
        # Inietta l'email dell'operatore aggiornato nel log affinché compaia nella colonna "Entità"
        publish_audit_event(
            "UPDATE_OPERATOR_PROFILE", 
            admin_id,
            extra_data={"entity_name": user.email}
        )

        return jsonify({"status": "updated"}), 200

    except Exception as e:
        db.session.rollback()
        return error_response(f"Errore durante l'aggiornamento: {str(e)}", 500)
    

# ===============================================================================
# ENDPOINT per il recupero dell'elenco Operatori (Amministratore)
# ===============================================================================
@app.route('/admin/operators', methods=['GET'])
def get_operators():
    """
    Soddisfa la sequenza alternativa di UC-AMM-08: Permette all'Amministratore 
    di recuperare la lista degli operatori per poterli visualizzare, selezionare e modificare.
    Si assume che l'API Gateway abbia già validato il token JWT e i permessi di Amministratore.
    """
    operator_role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    if not operator_role:
        return jsonify([]), 200

    # Recupera tutti gli utenti con ruolo Operatore
    operators = AppUser.query.filter_by(role_id=operator_role.id).all()
    
    result = []
    for op in operators:
        # Recupera le associazioni correnti per ogni operatore
        campus_links = UserCampus.query.filter_by(user_id=op.id).all()
        category_link = UserCategory.query.filter_by(user_id=op.id).first()
        
        result.append({
            "id": str(op.id),
            "email": op.email,
            "first_name": op.first_name,
            "last_name": op.last_name,
            "is_active": op.is_active,
            "campus_ids": [str(c.campus_id) for c in campus_links],
            "category_id": str(category_link.category_id) if category_link else None
        })
        
    return jsonify(result), 200

from flask import request, jsonify
import uuid

# ==========================================
# ENDPOINT: Profilo Utente Loggato
# ==========================================
@app.route('/me', methods=['GET'])
def get_current_user():
    """
    Restituisce i dati anagrafici dell'utente attualmente autenticato.
    Legge gli header iniettati in modo sicuro dall'API Gateway.
    """
    # Leggiamo gli header direttamente dalla request
    user_id_str = request.headers.get('X-User-Id')
    user_role = request.headers.get('X-User-Role')

    if not user_id_str:
        return jsonify({"error": "Utente non autenticato o header mancanti dal Gateway"}), 401

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID utente non valido"}), 400

    # Interroga la tabella app_user (assicurati che il modello si chiami AppUser o User a seconda della tua implementazione)
    user = db.session.get(AppUser, user_uuid)
    
    if not user:
        return jsonify({"error": "Utente non trovato nel database"}), 404

    return jsonify({
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user_role
    }), 200

# ============================================================================
# CONSUMER ASINCRONO INTEGRATO CON LA CLASSE CENTRALIZZATA
# ============================================================================

def start_consumer_thread():
    """
    Avvia il consumer asincrono in background utilizzando il RabbitMQManager centralizzato.
    """
    def callback(ch, method, properties, body):
        try:
            payload = json.loads(body)
            action = payload.get("azione")
            
            # Reagiamo solo all'evento di creazione di un nuovo campus
            if action == "CAMPUS_CREATED":
                admin_id = payload.get("autore_id")
                campus_id = payload.get("campus_id")
                
                if admin_id and campus_id:
                    with app.app_context():
                        exists = UserCampus.query.filter_by(user_id=admin_id, campus_id=campus_id).first()
                        if not exists:
                            new_link = UserCampus(user_id=admin_id, campus_id=campus_id)
                            db.session.add(new_link)
                            db.session.commit()
                            print(f"[AUTH SERVICE] Campus {campus_id} associato con successo all'Admin {admin_id}")

            elif action == "CAMPUS_DELETED":
                campus_id = payload.get("campus_id")
                if campus_id:
                    with app.app_context():
                        # Elimina tutte le associazioni degli utenti a questo campus
                        UserCampus.query.filter_by(campus_id=campus_id).delete()
                        db.session.commit()
                        print(f"[AUTH SERVICE] Campus {campus_id} eliminato. Rimossi i link agli operatori.")
                            
        except Exception as e:
            print(f"[AUTH SERVICE] Errore durante il processing dell'evento: {str(e)}")

    # Sfrutta il metodo centralizzato dichiarando una coda nominale per la scalabilità
    thread = threading.Thread(
        target=mq_manager.start_consumer, 
        kwargs={
            'exchange_name': 'system_events',
            'callback_function': callback,
            'queue_name': 'auth_service_queue',
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
    # Avvia il processo in background per ascoltare gli eventi RabbitMQ 
    start_consumer_thread()
    app.run(host='0.0.0.0', port=5000)