import os
import uuid
import pytest
from unittest.mock import patch, MagicMock
io = __import__('io')

# ============================================================================
# SETUP AMBIENTE
# ============================================================================
os.environ['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/media_db')

from app import app, db, MediaMetadata

# ============================================================================
# FIXTURE CONDIVISE
# ============================================================================
@pytest.fixture
def client():
    """Configura Flask in modalità TESTING e crea un DB pulito per ogni test."""
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/media_db')
    
    with app.test_client() as client:
        with app.app_context():
            from sqlalchemy import text
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'))
            db.session.commit()
            
            db.drop_all()
            db.create_all()
            
            yield client
            
            db.session.remove()
            db.drop_all()

@pytest.fixture(autouse=True)
def mock_rabbitmq():
    """Mock automatico per prevenire chiamate reali a RabbitMQ durante i test."""
    with patch('app.mq_manager.publish_event') as mock_pub:
        yield mock_pub

@pytest.fixture
def mock_minio():
    """Mock per isolare le chiamate a MinIO (Object Storage)."""
    with patch('app.minio_client') as mock_client:
        # Mock dei metodi comuni di MinIO
        mock_client.bucket_exists.return_value = True
        mock_client.put_object.return_value = None
        mock_client.remove_object.return_value = None
        mock_client.get_presigned_url.return_value = "http://localhost:9000/mock-presigned-url"
        
        # Mock per la lettura dell'oggetto (usato in analyze_image)
        mock_response = MagicMock()
        mock_response.read.return_value = b"fake-image-bytes"
        mock_client.get_object.return_value = mock_response
        
        yield mock_client

@pytest.fixture
def mock_google_vision():
    """Mock per isolare l'SDK di Google Cloud Vision API."""
    with patch('google.cloud.vision.ImageAnnotatorClient') as mock_vision_class:
        mock_vision_instance = mock_vision_class.return_value
        
        # Configura una risposta finta da parte di Google Vision
        fake_response = MagicMock()
        fake_response.error.message = ""
        
        # Label annotations mock
        fake_label = MagicMock()
        fake_label.description = "Pipe"
        fake_label.score = 0.95
        fake_response.label_annotations = [fake_label]
        
        # Object localization mock
        fake_object = MagicMock()
        fake_object.name = "Water Pipe"
        fake_response.localized_object_annotations = [fake_object]
        
        mock_vision_instance.annotate_image.return_value = fake_response
        yield mock_vision_instance


# ============================================================================
# TEST CASES
# ============================================================================

def test_health_check(client):
    """Verifica il corretto funzionamento dell'endpoint health check."""
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json['status'] == 'healthy'

def test_upload_image_success(client, mock_minio):
    """Verifica il caricamento e la compressione corretta di un'immagine (US 3-2)."""
    headers = {'X-User-Id': str(uuid.uuid4())}
    
    # Crea un file immagine finto (usando bytes di un'immagine minima o stream)
    # Creiamo un'immagine valida tramite PIL per superare il controllo di Pillow
    from PIL import Image
    img_io = io.BytesIO()
    img = Image.new('RGB', (100, 100), color='red')
    img.save(img_io, 'JPEG')
    img_io.seek(0)
    
    data = {
        'images': (img_io, 'test_pipe.jpg')
    }
    
    response = client.post('/images/upload', data=data, content_type='multipart/form-data', headers=headers)
    
    assert response.status_code == 201
    assert len(response.json['uploaded']) == 1
    assert 'media_id' in response.json['uploaded'][0]
    
    # Verifica che il record sia stato salvato su PostgreSQL
    media_record = MediaMetadata.query.first()
    assert media_record is not None
    assert media_record.original_filename == 'test_pipe.jpg'
    assert media_record.mime_type == 'image/jpeg'

def test_upload_image_invalid_extension(client):
    """Verifica che il sistema rifiuti file con estensioni non consentite."""
    headers = {'X-User-Id': str(uuid.uuid4())}
    data = {
        'images': (io.BytesIO(b"fake-content"), 'document.pdf')
    }
    
    response = client.post('/images/upload', data=data, content_type='multipart/form-data', headers=headers)
    
    assert response.status_code == 400
    assert len(response.json['errors']) == 1
    assert "Estensione file non consentita" in response.json['errors'][0]['error']

def test_get_image_success(client, mock_minio):
    """Verifica la restituzione diretta dello stream binario dell'immagine (US 3-2)."""
    # Inserisce un record fittizio nel DB
    media_id = uuid.uuid4()
    metadata = MediaMetadata(
        id=media_id,
        original_filename="test.jpg",
        mime_type="image/jpeg",
        size_bytes=1024,
        bucket_name="media-bucket",
        object_key="2026/07/28/test.jpg"
    )
    db.session.add(metadata)
    db.session.commit()
    
    response = client.get(f'/images/{media_id}')
    
    # Il nuovo endpoint restituisce direttamente il file con status 200 OK
    assert response.status_code == 200
    
    # Verifica che il Content-Type sia corretto
    assert response.mimetype == "image/jpeg"
    
    # Verifica che il payload contenga effettivamente i byte dell'immagine mockata
    assert response.data == b"fake-image-bytes"

def test_get_image_not_found(client):
    """Verifica la risposta 404 se l'immagine non esiste a database."""
    random_id = uuid.uuid4()
    response = client.get(f'/images/{random_id}')
    
    assert response.status_code == 404
    assert "Immagine non trovata" in response.json['error']

def test_analyze_image_success(client, mock_minio, mock_google_vision):
    """Verifica l'analisi intelligente dell'immagine tramite Google Vision (US 3-3)."""
    media_id = uuid.uuid4()
    metadata = MediaMetadata(
        id=media_id,
        original_filename="pipe.jpg",
        mime_type="image/jpeg",
        size_bytes=2048,
        bucket_name="media-bucket",
        object_key="2026/07/28/pipe.jpg"
    )
    db.session.add(metadata)
    db.session.commit()
    
    headers = {'X-User-Id': str(uuid.uuid4())}
    response = client.post(f'/images/{media_id}/analyze', headers=headers)
    
    assert response.status_code == 200
    assert response.json['status'] == 'success'
    assert "suggestions" in response.json
    assert "Pipe" in response.json['suggestions']['tags']
    assert "Water Pipe" in response.json['suggestions']['tags']

def test_delete_image_success(client, mock_minio):
    """Verifica la cancellazione fisica da MinIO e logica da PostgreSQL."""
    media_id = uuid.uuid4()
    metadata = MediaMetadata(
        id=media_id,
        original_filename="to_delete.jpg",
        mime_type="image/jpeg",
        size_bytes=512,
        bucket_name="media-bucket",
        object_key="2026/07/28/to_delete.jpg"
    )
    db.session.add(metadata)
    db.session.commit()
    
    headers = {'X-User-Id': str(uuid.uuid4())}
    response = client.delete(f'/images/{media_id}', headers=headers)
    
    assert response.status_code == 200
    assert response.json['status'] == 'deleted'
    
    # Verifica che il record sia stato rimosso dal database
    deleted_record = db.session.get(MediaMetadata, media_id)
    assert deleted_record is None