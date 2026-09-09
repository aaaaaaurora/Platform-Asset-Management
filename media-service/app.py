import os
import uuid
import datetime
import io
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import text
from minio import Minio
from minio.error import S3Error
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename
from shared_utils.messaging import RabbitMQManager
 
app = Flask(__name__)

# ==========================================
# CONFIGURAZIONE 
# ==========================================
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@db:5432/media_db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Configurazione MinIO (Object Storage)
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'minio')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', 'admin_minio')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', 'password_super_sicura')
MEDIA_BUCKET = os.getenv('MEDIA_BUCKET', 'media-bucket')

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False # Impostare a True in produzione con certificati validi
)

# Configurazione RabbitMQ
RABBITMQ_URL = os.getenv('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq-service:5672/')
mq_manager = RabbitMQManager(rabbitmq_url=RABBITMQ_URL)

# Limiti e configurazioni di validazione
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
MAX_IMAGE_SIZE = 1920 # Dimensione massima per la compressione (pixel)

# ==========================================
# MODELLI DATABASE
# ==========================================
class MediaMetadata(db.Model):
    __tablename__ = 'media_metadata'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_filename = db.Column(db.String(255))
    mime_type = db.Column(db.String(100))
    size_bytes = db.Column(db.BigInteger)
    bucket_name = db.Column(db.String(255))
    object_key = db.Column(db.String(512))
    created_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

# ==========================================
# UTILITIES
# ==========================================
def get_auth_context():
    """Estrae i dati di autorizzazione forniti dal Gateway in modo passivo."""
    return {
        'user_id': request.headers.get('X-User-Id'),
        'role': request.headers.get('X-User-Role'),
        'campus_ids': request.headers.get('X-Campus-Ids', '').split(',') if request.headers.get('X-Campus-Ids') else []
    }

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_and_compress_image(file_stream):
    """Valida, ridimensiona e comprime l'immagine in memoria usando Pillow."""
    try:
        img = Image.open(file_stream)
        
        # Converte in RGB per evitare errori con PNG trasparenti salvati in JPEG 
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
            
        # Ridimensionamento mantenendo l'aspect ratio (ottimizzazione)
        img.thumbnail((MAX_IMAGE_SIZE, MAX_IMAGE_SIZE))
        
        output_io = io.BytesIO()
        # Comprime in JPEG con qualità 80 e ottimizzazione
        img.save(output_io, format='JPEG', quality=80, optimize=True)
        output_io.seek(0)
        
        size_bytes = output_io.getbuffer().nbytes
        return output_io, size_bytes, 'image/jpeg'
    except UnidentifiedImageError:
        return None, 0, None

# ==========================================
# HOOK DI INIZIALIZZAZIONE
# ==========================================
@app.before_request
def initialize_infrastructure():
    if getattr(app, '_infrastructure_initialized', False):
        return

    try:
        # Inizializzazione DB
        db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
        db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'))
        db.session.commit()
        db.create_all()

        # Inizializzazione MinIO Bucket
        if not minio_client.bucket_exists(MEDIA_BUCKET):
            minio_client.make_bucket(MEDIA_BUCKET)
            
    except Exception as e:
        print(f"[MEDIA SERVICE] Errore critico in inizializzazione infrastruttura: {e}")
        db.session.rollback()
    finally:
        app._infrastructure_initialized = True

    # Inizializzazione MinIO Bucket con gestione difensiva
        try:
            if not minio_client.bucket_exists(MEDIA_BUCKET):
                minio_client.make_bucket(MEDIA_BUCKET)
        except Exception as minio_init_err:
            print(f"[MEDIA SERVICE] Avviso: Impossibile connettersi a MinIO all'avvio: {minio_init_err}")
# ==========================================
# ENDPOINT INFRASTRUTTURALE
# ==========================================
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

# ==========================================
# ENDPOINT: US 3-2 (Upload Immagini)
# ==========================================
@app.route('/images/upload', methods=['POST'])
def upload_images():
    """
    Riceve, valida, comprime e salva una o più immagini.
    Salva il binario su MinIO e i metadati su PostgreSQL.
    """
    auth_ctx = get_auth_context()
    user_id = auth_ctx.get('user_id')

    if not user_id:
        return jsonify({"error": "Utente non autenticato dal Gateway"}), 401

    if 'images' not in request.files:
        return jsonify({"error": "Nessun file fornito nella chiave 'images'"}), 400

    files = request.files.getlist('images')
    if not files or all(f.filename == '' for f in files):
        return jsonify({"error": "Lista file vuota"}), 400

    uploaded_results = []
    errors = []

    for file in files:
        if not file or not allowed_file(file.filename):
            errors.append({"filename": file.filename, "error": "Estensione file non consentita"})
            continue
            
        original_filename = secure_filename(file.filename)
        
        # 1. Compressione e Ottimizzazione in RAM
        compressed_stream, size_bytes, mime_type = process_and_compress_image(file.stream)
        if not compressed_stream:
            errors.append({"filename": original_filename, "error": "File immagine corrotto o non supportato"})
            continue

        # Generazione ID univoco
        media_id = uuid.uuid4()
        object_key = f"{datetime.datetime.utcnow().strftime('%Y/%m/%d')}/{media_id}.jpg"

        try:
            # 2. Upload fisico su MinIO (Object Storage)
            minio_client.put_object(
                bucket_name=MEDIA_BUCKET,
                object_name=object_key,
                data=compressed_stream,
                length=size_bytes,
                content_type=mime_type
            )

            # 3. Salvataggio Logico su PostgreSQL (Metadata)
            metadata = MediaMetadata(
                id=media_id,
                original_filename=original_filename,
                mime_type=mime_type,
                size_bytes=size_bytes,
                bucket_name=MEDIA_BUCKET,
                object_key=object_key
            )
            db.session.add(metadata)
            db.session.commit()

            # 4. Generazione Evento Asincrono (Resiliente)
            try:
                mq_manager.publish_event(
                    exchange_name='system_events',
                    action='MEDIA_UPLOADED',
                    actor_id=user_id,
                    service_name='media-service',
                    extra_data={
                        "media_id": str(media_id),
                        "size_bytes": size_bytes,
                        "mime_type": mime_type
                    }
                )
            except Exception as mq_err:
                print(f"[MEDIA SERVICE] Avviso: Impossibile notificare l'upload a RabbitMQ: {mq_err}")

            uploaded_results.append({
                "media_id": str(media_id),
                "original_filename": original_filename,
                "url": f"/images/{media_id}" # URL logico per le API successive
            })

        except S3Error as minio_err:
            db.session.rollback()
            errors.append({"filename": original_filename, "error": f"Errore storage: {str(minio_err)}"})
        except Exception as db_err:

            # Tentativo di compensazione: rimuovere il file orfano da MinIO se il DB fallisce
            try:
                minio_client.remove_object(MEDIA_BUCKET, object_key)
            except S3Error:
                pass
            errors.append({"filename": original_filename, "error": f"Errore database: {str(db_err)}"})

    status_code = 207 if errors and uploaded_results else (400 if errors else 201)
    
    return jsonify({
        "uploaded": uploaded_results,
        "errors": errors
    }), status_code

import io
from flask import send_file

# ==========================================
# ENDPOINT: US 3-2 (Anteprima e Visualizzazione)
# ==========================================
@app.route('/images/<media_id_str>', methods=['GET'])
def get_image(media_id_str):
    """
    Recupera l'immagine da MinIO e la restituisce direttamente al client come stream binario,
    evitando problemi di DNS e reindirizzamenti esterni.
    """
    try:
        media_uuid = uuid.UUID(media_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID immagine non valido"}), 400

    # 1. Recupero metadati dal database PostgreSQL
    metadata = db.session.get(MediaMetadata, media_uuid)
    if not metadata:
        return jsonify({"error": "Immagine non trovata nel database"}), 404

    try:
        # 2. Preleva l'oggetto direttamente da MinIO (il container parla con il container)
        response = minio_client.get_object(metadata.bucket_name, metadata.object_key)
        
        # 3. Legge i byte in memoria
        file_stream = io.BytesIO(response.read())
        
        # 4. Restituisce il file al client tramite Flask
        return send_file(
            file_stream, 
            mimetype='image/jpeg', # Modifica con metadata.mime_type se lo hai salvato nel DB
            as_attachment=False
        )

    except Exception as err:
        return jsonify({"error": f"Errore nel recupero dell'immagine dallo storage: {str(err)}"}), 500
    finally:
        # Rilascia la connessione a MinIO in modo pulito
        if 'response' in locals():
            response.close()
            response.release_conn()
# ==========================================
# ENDPOINT: US 3-3 
# ==========================================
@app.route('/images/<media_id_str>/analyze', methods=['POST'])
def analyze_image(media_id_str):
    """
    Scarica l'immagine da MinIO, la invia a Google Cloud Vision API,
    elabora i risultati trasformandoli in suggerimenti strutturati per i metadati.
    """
    auth_ctx = get_auth_context()
    user_id = auth_ctx.get('user_id')

    if not user_id:
        return jsonify({"error": "Utente non autenticato dal Gateway"}), 401

    try:
        media_uuid = uuid.UUID(media_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID immagine non valido"}), 400

    # 1. Recupero metadati dal database PostgreSQL
    metadata = db.session.get(MediaMetadata, media_uuid)
    if not metadata:
        return jsonify({"error": "Immagine non trovata nel database"}), 404

    # Pubblica evento di richiesta analisi (Resiliente)
    try:
        mq_manager.publish_event(
            exchange_name='system_events',
            action='MEDIA_ANALYSIS_REQUESTED',
            actor_id=user_id,
            service_name='media-service',
            extra_data={"media_id": str(media_uuid)}
        )
    except Exception as mq_err:
        print(f"Avviso RabbitMQ (Analysis Requested): {mq_err}")

    try:
        # 2. Recupero del file binario direttamente da MinIO in memoria
        response_obj = minio_client.get_object(metadata.bucket_name, metadata.object_key)
        image_bytes = response_obj.read()
        response_obj.close()
        response_obj.release_conn()

        # 3. Invocazione di Google Cloud Vision API
        from google.cloud import vision
        vision_client = vision.ImageAnnotatorClient()
        
        image = vision.Image(content=image_bytes)
        
        # Eseguiamo simultaneamente Label Detection (etichette) e Object Localization (oggetti)
        response = vision_client.annotate_image({
            'image': image,
            'features': [
                {'type_': vision.Feature.Type.LABEL_DETECTION, 'max_results': 10},
                {'type_': vision.Feature.Type.OBJECT_LOCALIZATION, 'max_results': 5}
            ]
        })

        if response.error.message:
            raise Exception(f"Errore restituito da Google Vision: {response.error.message}")

        # 4. Elaborazione e trasformazione dei risultati in suggerimenti strutturati
        labels = [label.description for label in response.label_annotations]
        objects = [obj.name for obj in response.localized_object_annotations]
        
        # Unione e deduplicazione dei tag rilevati
        suggested_tags = list(set(labels + objects))

        # Creazione del payload di suggerimenti strutturati
        suggestions = {
            "suggested_title": labels[0] if labels else "Asset multimediale",
            "suggested_description": f"Immagine rilevata contenente elementi correlati a: {', '.join(labels[:5])}",
            "tags": suggested_tags,
            "confidence_score": response.label_annotations[0].score if response.label_annotations else 0.0
        }

        # Pubblicazione evento di successo analisi (Resiliente)
        try:
            mq_manager.publish_event(
                exchange_name='system_events',
                action='MEDIA_ANALYSIS_COMPLETED',
                actor_id=user_id,
                service_name='media-service',
                extra_data={"media_id": str(media_uuid), "tags_count": len(suggested_tags)}
            )
        except Exception as mq_err:
            print(f"Avviso RabbitMQ (Analysis Completed): {mq_err}")

        return jsonify({
            "media_id": str(media_uuid),
            "status": "success",
            "suggestions": suggestions
        }), 200

    except Exception as e:
        # Circuit Breaker / Modalità Degradata (Fallback)
        try:
            mq_manager.publish_event(
                exchange_name='system_events',
                action='MEDIA_ANALYSIS_FAILED',
                actor_id=user_id,
                service_name='media-service',
                extra_data={"media_id": str(media_uuid), "error": str(e)}
            )
        except Exception as mq_err:
            print(f"Avviso RabbitMQ (Analysis Failed): {mq_err}")

        return jsonify({
            "media_id": str(media_uuid),
            "status": "degraded",
            "warning": "Impossibile completare l'analisi AI automatica. Inserimento manuale richiesto.",
            "suggestions": {
                "suggested_title": "",
                "suggested_description": "",
                "tags": [],
                "confidence_score": 0.0
            }
        }), 200 

# ==========================================
# ENDPOINT: Cancellazione Media (Fisica e Logica)
# ==========================================
@app.route('/images/<media_id_str>', methods=['DELETE'])
def delete_image(media_id_str):
    """
    Elimina un'immagine rimuovendo prima l'oggetto fisico da MinIO
    e successivamente i metadati da PostgreSQL, garantendo la consistenza.
    """
    auth_ctx = get_auth_context()
    user_id = auth_ctx.get('user_id')

    if not user_id:
        return jsonify({"error": "Utente non autenticato dal Gateway"}), 401

    try:
        media_uuid = uuid.UUID(media_id_str)
    except ValueError:
        return jsonify({"error": "Formato ID immagine non valido"}), 400

    # 1. Recupero metadati dal database PostgreSQL
    metadata = db.session.get(MediaMetadata, media_uuid)
    if not metadata:
        return jsonify({"error": "Immagine non trovata nel database"}), 404

    bucket_name = metadata.bucket_name
    object_key = metadata.object_key

    try:
        # 2. Rimozione dell'oggetto fisico da MinIO (Object Storage)
        minio_client.remove_object(bucket_name, object_key)

        # 3. Rimozione dei metadati da PostgreSQL
        db.session.delete(metadata)
        db.session.commit()

        # 4. Pubblicazione evento asincrono di cancellazione (Resiliente)
        try:
            mq_manager.publish_event(
                exchange_name='system_events',
                action='MEDIA_DELETED',
                actor_id=user_id,
                service_name='media-service',
                extra_data={"media_id": str(media_uuid)}
            )
        except Exception as mq_err:
            print(f"[MEDIA SERVICE] Avviso: Impossibile notificare l'eliminazione a RabbitMQ: {mq_err}")

        return jsonify({
            "media_id": str(media_uuid),
            "status": "deleted"
        }), 200

    except S3Error as minio_err:
        db.session.rollback()
        return jsonify({"error": f"Errore durante la rimozione del file dallo storage: {str(minio_err)}"}), 500
    except Exception as db_err:
        db.session.rollback()
        return jsonify({"error": f"Errore interno del server durante la cancellazione: {str(db_err)}"}), 500