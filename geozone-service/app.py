import os
import json
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from sqlalchemy.sql import func
from sqlalchemy.exc import IntegrityError
import datetime
from sqlalchemy.dialects.postgresql import UUID

# Import della libreria centralizzata per RabbitMQ
from shared_utils.messaging import RabbitMQManager

# ============================================================================
# INIZIALIZZAZIONE E CONFIGURAZIONE
# ============================================================================
app = Flask(__name__)

# Configurazione PostgreSQL + PostGIS
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/geozone_db')
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq-service:5672/')

db = SQLAlchemy(app)
mq_manager = RabbitMQManager(rabbitmq_url=RABBITMQ_URL)

# ============================================================================
# MODELLI ORM (GeoAlchemy2)
# ============================================================================
class Campus(db.Model):
    __tablename__ = 'campus'

    # ID generato nativamente da PostgreSQL (gen_random_uuid)
    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.Text, nullable=True)
    
    # Colonna che registra quale Amministratore ha creato il campus
    admin_id = db.Column(UUID(as_uuid=True), nullable=False)
    
    # Colonna spaziale nativa. L'indice GiST viene creato in automatico da GeoAlchemy2
    geom = db.Column(Geometry('POLYGON', srid=4326, spatial_index=True), nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

# ============================================================================
# FUNZIONI DI UTILITA' E MIDDLEWARE
# ============================================================================
def get_auth_context():
    """Estrae le informazioni di sicurezza propagate dall'API Gateway."""
    campuses_header = request.headers.get('X-Campus-Ids', '')
    campus_ids = [c.strip() for c in campuses_header.split(',')] if campuses_header else []
    
    return {
        'user_id': request.headers.get('X-User-Id'),
        'role': request.headers.get('X-User-Role'),
        'email': request.headers.get('X-User-Email'), 
        'campus_ids': campus_ids
    }

def publish_event(action, extra_data=None):
    """Wrapper per pubblicare eventi verso RabbitMQ."""
    auth = get_auth_context()
    
    if extra_data is None:
        extra_data = {}
        
    # Iniettiamo l'email nel payload di tutti gli eventi generati da questo servizio
    if auth.get('email'):
        extra_data['email'] = auth.get('email')

    mq_manager.publish_event(
        exchange_name='system_events',
        action=action,
        actor_id=auth.get('user_id') or None,
        service_name='geozone-service',
        extra_data=extra_data if extra_data else None
    )

def error_response(message, status_code):
    return jsonify({"error": message}), status_code

# ============================================================================
# ENDPOINT DI SISTEMA 
# ============================================================================
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

# ============================================================================
# ENDPOINT: Creazione Campus Universitario
# ============================================================================
@app.route('/api/geozones/campuses', methods=['POST'])
def create_campus():
    """
    Crea e registra un nuovo perimetro universitario nel database spaziale.
    Utilizza PostGIS per validare la correttezza geometrica e prevenire sovrapposizioni territoriali.
    """
    auth = get_auth_context()
    
    # Controllo di sicurezza basato sul ruolo fornito dal Gateway
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    geometry = data.get('geometry') # Atteso formato GeoJSON (dict)

    if not name or not geometry:
        return error_response("I campi 'name' e 'geometry' sono obbligatori.", 400)

    if geometry.get('type') != 'Polygon':
        return error_response("Il sistema supporta unicamente geometrie di tipo 'Polygon'.", 400)

    # 1. Controllo Testuale: Verifica se il nome esiste già (Case-Insensitive)
    existing_campus = db.session.query(Campus).filter(func.lower(Campus.name) == func.lower(name)).first()
    if existing_campus:
        return error_response(f"Campus già presente: Il nome '{existing_campus.name}' risulta già censito.", 409)

    try:
        # Preparazione della geometria per PostGIS
        geojson_str = json.dumps(geometry)
        new_geom = func.ST_SetSRID(func.ST_GeomFromGeoJSON(geojson_str), 4326)

        # 2. Validazione Geometrica: Verifica che il poligono sia topologicamente valido
        is_valid = db.session.query(func.ST_IsValid(new_geom)).scalar()
        if not is_valid:
            return error_response("La geometria fornita non è un poligono topologicamente valido.", 422)

        # 3. Controllo Spaziale: Verifica che l'area non si sovrapponga a campus esistenti
        overlapping_campus = db.session.query(Campus).filter(
            func.ST_Intersects(Campus.geom, new_geom)
        ).first()
        
        if overlapping_campus:
            return error_response(
                f"Area già assegnata: Il perimetro selezionato punta a un'area già coperta dal campus '{overlapping_campus.name}'.", 
                409
            )

        # 4. Creazione e Salvataggio del modello
        new_campus = Campus(
            name=name,
            description=description,
            geom=new_geom,
            admin_id=auth.get('user_id') # Salva l'ID dell'Amministratore che lo sta creando
        )

        db.session.add(new_campus)
        db.session.commit()

        # 4. Estrazione dell'ID generato dal DB
        campus_id = new_campus.id

        # 5. Pubblicazione evento RabbitMQ 
        try:
            publish_event("CAMPUS_CREATED", {
                "campus_id": str(campus_id),
                "campus_name": name
            })
        except Exception as e:
            print(f"ATTENZIONE: Impossibile comunicare con RabbitMQ - {str(e)}")

        return jsonify({
            "message": "Campus creato con successo.",
            "campus": {
                "id": campus_id,
                "name": name,
                "description": description
            }
        }), 201

    except IntegrityError:
        db.session.rollback()
        return error_response(f"Un campus con il nome '{name}' esiste già a sistema.", 409)
    except Exception as e:
        db.session.rollback()
        return error_response(f"Errore interno durante l'elaborazione geospaziale: {str(e)}", 500)
    
# ============================================================================
# ENDPOINT: Consultazione elenco campus universitari 
# ============================================================================
@app.route('/api/geozones/campuses', methods=['GET'])
def get_campuses():
    """
    Recupera l'elenco di tutti i campus registrati.
    Sfrutta PostGIS per la conversione nativa delle geometrie in formato GeoJSON,
    fornendo i dati pronti per il rendering cartografico sul Frontend.
    """
    # Questo endpoint è accessibile a tutti gli utenti autenticati (Guest, Operatore, Admin)
    # in quanto la mappa dei campus è un dato di dominio pubblico per il sistema.
    auth = get_auth_context()
    if not auth.get('role'):
        return error_response("Accesso negato. Autenticazione mancante.", 401)

    try:
        # Interrogazione ottimizzata: estraiamo le colonne base e deleghiamo 
        # a PostGIS la trasformazione della geometria in GeoJSON (ST_AsGeoJSON).
        query = db.session.query(
            Campus.id,
            Campus.name,
            Campus.description,
            func.ST_AsGeoJSON(Campus.geom).label('geometry_geojson'),
            Campus.created_at,
            Campus.updated_at
        )

        # L'Amministratore vede direttamente e solo i campus che ha creato
        if auth.get('role') == 'AMMINISTRATORE':
            query = query.filter(Campus.admin_id == auth.get('user_id'))
        
        # L'Operatore vede esclusivamente quelli per cui è autorizzato dal token
        elif auth.get('role') == 'OPERATORE':
            campus_ids = auth.get('campus_ids', [])
            if campus_ids:
                query = query.filter(func.cast(Campus.id, db.String).in_(campus_ids))
            else:
                # Se l'operatore non ha campus, restituisce lista vuota
                query = query.filter(False)

        campuses = query.all()

        results = []
        for c in campuses:
            results.append({
                "id": str(c.id),
                "name": c.name,
                "description": c.description,
                "geometry": json.loads(c.geometry_geojson) if c.geometry_geojson else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None
            })
            
        return jsonify(results), 200

    except Exception as e:
        return error_response(f"Errore durante il recupero dei dati geospaziali: {str(e)}", 500)
    
    
# ============================================================================
# ENDPOINT: Consultazione dettagliata di un singolo Campus 
# ============================================================================
@app.route('/api/geozones/campuses/<campus_id>', methods=['GET'])
def get_campus(campus_id):
    """
    Recupera i dettagli di un singolo campus e ne calcola al volo le metriche spaziali.
    Utilizza PostGIS (ST_Centroid e ST_Envelope) per fornire al Frontend i punti 
    esatti necessari per centrare la telecamera e impostare lo zoom iniziale.
    """
    auth = get_auth_context()
    if not auth.get('role'):
        return error_response("Accesso negato. Autenticazione mancante.", 401)

    try:
        # Interrogazione avanzata: deleghiamo a PostGIS sia il calcolo delle metriche 
        # (Centroide ed Envelope) sia la loro immediata conversione in stringhe GeoJSON.
        campus = db.session.query(
            Campus.id,
            Campus.name,
            Campus.description,
            func.ST_AsGeoJSON(Campus.geom).label('geometry'),
            func.ST_AsGeoJSON(func.ST_Centroid(Campus.geom)).label('centroid'),
            func.ST_AsGeoJSON(func.ST_Envelope(Campus.geom)).label('bounding_box'),
            Campus.created_at,
            Campus.updated_at
        ).filter(Campus.id == campus_id).first()

        if not campus:
            return error_response("Campus non trovato.", 404)

        # Costruiamo la risposta deserializzando le stringhe GeoJSON generate dal DB
        return jsonify({
            "id": str(campus.id),
            "name": campus.name,
            "description": campus.description,
            "geometry": json.loads(campus.geometry) if campus.geometry else None,
            "centroid": json.loads(campus.centroid) if campus.centroid else None,
            "bounding_box": json.loads(campus.bounding_box) if campus.bounding_box else None,
            "created_at": campus.created_at.isoformat() if campus.created_at else None,
            "updated_at": campus.updated_at.isoformat() if campus.updated_at else None
        }), 200

    except Exception as e:
        # Cattura anche eventuali eccezioni dovute a un campus_id con formato UUID non valido
        return error_response(f"Errore durante l'interrogazione del campus: {str(e)}", 500)
    
    
# ============================================================================
# ENDPOINT: Aggiornamento di un Campus (metadati e/o geometria)
# ============================================================================
@app.route('/api/geozones/campuses/<campus_id>', methods=['PUT'])
def update_campus(campus_id):
    """
    Modifica i metadati e/o ridisegna il perimetro di un campus esistente.
    Riapplica la validazione topologica nativa se la geometria viene alterata
    ed emette eventi RabbitMQ granulari.
    """
    auth = get_auth_context()
    
    # Solo l'Amministratore può modificare l'anagrafica e i confini territoriali
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    try:
        # Recupero del campus esistente
        campus = db.session.query(Campus).filter(Campus.id == campus_id).first()
        if not campus:
            return error_response("Campus non trovato.", 404)

        events_to_publish = []
        metadata_updated = False

        # 1. Aggiornamento Nome (con controllo univocità preventivo)
        if 'name' in data:
            new_name = data['name'].strip()
            if new_name != campus.name:
                # Verifica conflitti con altri campus
                existing = db.session.query(Campus).filter(Campus.name == new_name).first()
                if existing:
                    return error_response(f"Un campus con il nome '{new_name}' esiste già.", 409)
                campus.name = new_name
                metadata_updated = True

        # 2. Aggiornamento Descrizione
        if 'description' in data:
            new_desc = data['description'].strip()
            if new_desc != campus.description:
                campus.description = new_desc
                metadata_updated = True

        if metadata_updated:
            events_to_publish.append("CAMPUS_UPDATED")

        # 3. Aggiornamento Geometria Spaziale
        if 'geometry' in data and data['geometry']:
            geometry = data['geometry']
            
            if geometry.get('type') != 'Polygon':
                return error_response("Il sistema supporta unicamente geometrie di tipo 'Polygon'.", 400)
            
            geojson_str = json.dumps(geometry)

            # Validazione geometrica nativa PostGIS sul nuovo poligono
            is_valid = db.session.query(
                func.ST_IsValid(func.ST_GeomFromGeoJSON(geojson_str))
            ).scalar()

            if not is_valid:
                return error_response("La nuova geometria non è un poligono topologicamente valido.", 422)

            # Sostituzione della geometria imponendo lo SRID 4326 (WGS 84)
            campus.geom = func.ST_SetSRID(func.ST_GeomFromGeoJSON(geojson_str), 4326)
            events_to_publish.append("CAMPUS_GEOMETRY_UPDATED")

        # Se non è stato aggiornato nulla, restituiamo un errore per bad request
        if not events_to_publish:
            return error_response("Nessun campo valido fornito per l'aggiornamento.", 400)

        # 4. Commit nel database. Il trigger ON UPDATE/onupdate aggiornerà 'updated_at  
        db.session.commit()

        # 5. Pubblicazione asincrona degli eventi
        for event_type in events_to_publish:
            publish_event(event_type, {
                "campus_id": campus_id,
                "campus_name": campus.name
            })

        # 6. Ritorna il campus aggiornato estraendo la nuova geometria 
        updated_campus = db.session.query(
            Campus.id,
            Campus.name,
            Campus.description,
            func.ST_AsGeoJSON(Campus.geom).label('geometry'),
            Campus.created_at,
            Campus.updated_at
        ).filter(Campus.id == campus_id).first()

        return jsonify({
            "message": "Campus aggiornato con successo.",
            "campus": {
                "id": str(updated_campus.id),
                "name": updated_campus.name,
                "description": updated_campus.description,
                "geometry": json.loads(updated_campus.geometry) if updated_campus.geometry else None,
                "updated_at": updated_campus.updated_at.isoformat() if updated_campus.updated_at else None
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        return error_response(f"Errore durante l'aggiornamento del campus: {str(e)}", 500)
    
    
# ============================================================================
# ENDPOINT: Eliminazione Campus
# ============================================================================
@app.route('/api/geozones/campuses/<campus_id>', methods=['DELETE'])
def delete_campus(campus_id):
    """
    Elimina fisicamente un campus dal database spaziale.
    Essendo un'architettura a microservizi basata su soft-linking, l'eliminazione
    avviene localmente e viene pubblicato un evento RabbitMQ affinché gli altri 
    servizi (Auth, Asset) possano allineare i propri dati.
    """
    auth = get_auth_context()
    
    # Controllo di sicurezza rigoroso: solo l'Amministratore può eliminare 
    if auth.get('role') != 'AMMINISTRATORE':
        return error_response("Accesso negato. Richiesto ruolo AMMINISTRATORE.", 403)

    try:
        # Recupero del campus da eliminare
        campus = db.session.query(Campus).filter(Campus.id == campus_id).first()
        if not campus:
            return error_response("Campus non trovato.", 404)

        # Salviamo il nome prima di eliminare l'oggetto per poterlo inserire nell'evento
        campus_name = campus.name

        # Eliminazione fisica dal database relazionale
        db.session.delete(campus)
        db.session.commit()

        # Pubblicazione asincrona dell'evento di eliminazione
        publish_event("CAMPUS_DELETED", {
            "campus_id": campus_id,
            "campus_name": campus_name
        })

        return jsonify({"message": f"Campus '{campus_name}' eliminato con successo."}), 200

    except Exception as e:
        db.session.rollback()
        return error_response(f"Errore durante l'eliminazione del campus: {str(e)}", 500)
    
# =================================================================================
# ENDPOINT INTERNO: Verifica se una coordinata GPS ricade all'interno di un campus
# =================================================================================
@app.route('/api/geozones/verify-location', methods=['POST'])
def verify_location():
    """
    API interna dedicata agli altri microservizi.
    Verifica matematicamente se una determinata coordinata GPS ricade
    all'interno dei confini di un campus specifico, demandando l'intero
    calcolo vettoriale all'indice GiST di PostGIS.
    """
    # Trattandosi di un'API chiamata da altri microservizi (Server-to-Server),
    # il controllo di sicurezza si affida all'API Gateway che instrada il traffico interno.
    
    data = request.get_json()
    if not data:
        return error_response("Payload mancante", 400)

    campus_id = data.get('campusId')
    lat = data.get('latitudine')
    lng = data.get('longitudine')

    # Validazione formale dell'input
    if not campus_id or lat is None or lng is None:
        return error_response("Parametri mancanti: campusId, latitudine, e longitudine sono obbligatori.", 400)

    try:
        # Cast esplicito per sicurezza
        lat = float(lat)
        lng = float(lng)

        # ATTENZIONE GIS: Nelle geometrie cartesiane e in PostGIS, l'ordine delle
        # coordinate è (X, Y), che corrisponde a (Longitudine, Latitudine).
        # Creiamo il punto in memoria sul DB e gli assegniamo lo standard GPS (4326).
        target_point = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)

        # Eseguiamo una query booleana ultra-rapida tramite ST_Contains.
        # Restituisce True se esiste un record che soddisfa ID e perimetro spaziale.
        is_inside = db.session.query(
            db.session.query(Campus).filter(
                Campus.id == campus_id,
                func.ST_Contains(Campus.geom, target_point)
            ).exists()
        ).scalar()

        # Restituiamo il booleano netto come richiesto dai documenti
        return jsonify({"is_inside": is_inside}), 200

    except ValueError:
        return error_response("Le coordinate GPS devono essere valori numerici validi.", 400)
    except Exception as e:
        return error_response(f"Errore interno del motore spaziale: {str(e)}", 500)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)