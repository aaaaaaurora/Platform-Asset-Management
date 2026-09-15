import os
import uuid
import pytest
from unittest.mock import patch
from sqlalchemy import text

# ============================================================================
# SETUP AMBIENTE
# ============================================================================
os.environ['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/warning_db')

from app import app, db, Warning, WarningStatus, MaintenanceIntervention, MaintenanceType, LocalAssetCache

# ============================================================================
# FIXTURE CONDIVISE
# ============================================================================
@pytest.fixture
def client():
    """Configura Flask in modalità TESTING e crea un DB pulito per ogni test."""
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/warning_db')
    
    with app.test_client() as client:
        with app.app_context():
            # Inizializza l'estensione pgcrypto per gen_random_uuid() se manca
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'))
            db.session.commit()
            
            # Ricrea le tabelle pulite
            db.drop_all()
            db.create_all()
            
            yield client
            
            # Pulizia post-test
            db.session.remove()
            db.drop_all()

@pytest.fixture(autouse=True)
def mock_rabbitmq():
    """Mock automatico per prevenire chiamate reali a RabbitMQ durante i test."""
    with patch('app.mq_manager.publish_event') as mock_pub:
        yield mock_pub

# ============================================================================
# TEST CASES
# ============================================================================

def test_health_check(client):
    """Verifica il Liveness Probe di Kubernetes."""
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json['status'] == 'healthy'

def test_create_warning_success(client):
    """Verifica la creazione corretta di una segnalazione pubblica (US 6-1)."""
    campus_id = uuid.uuid4()
    asset_id_str = "123456789012345678901234" 
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    # 1. Popola la cache locale simulando un evento ricevuto via RabbitMQ in precedenza
    cache_entry = LocalAssetCache(asset_id=asset_id_str, category_id=category_id_str, campus_id=campus_id)
    db.session.add(cache_entry)
    db.session.commit()

    headers = {'X-User-Id': str(uuid.uuid4())}
    payload = {
        "asset_id": asset_id_str,
        "descrizione": "L'asset risulta danneggiato."
    }
    
    response = client.post('/warnings', json=payload, headers=headers)
    
    assert response.status_code == 201
    assert 'warning_id' in response.json
    assert response.json['status'] == 'aperta'
    
    # Verifica che il record sia stato creato nel database e includa la categoria
    warning = Warning.query.first()
    assert warning is not None
    assert warning.category_id == category_id_str
    assert warning.description == "L'asset risulta danneggiato."

def test_create_warning_invalid_asset(client):
    """Verifica che la creazione fallisca se l'Asset Service non è in cache (404 cache miss)."""
    headers = {'X-User-Id': str(uuid.uuid4())}
    payload = {
        "asset_id": "123456789012345678901234",
        "descrizione": "Test asset inesistente"
    }
    
    # Non inseriamo l'asset in LocalAssetCache, forzando un cache miss
    response = client.post('/warnings', json=payload, headers=headers)
    
    assert response.status_code == 404
    assert "non esiste" in response.json['error']

def test_get_warnings_operator(client):
    """Verifica che l'Operatore veda solo le segnalazioni del suo campus (US 6-2)."""
    campus_1 = uuid.uuid4()
    campus_2 = uuid.uuid4()
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    # Crea due segnalazioni in due campus diversi
    w1 = Warning(asset_id="111111111111111111111111", category_id=category_id_str, campus_id=campus_1, reporter_id=uuid.uuid4(), description="Guasto C1")
    w2 = Warning(asset_id="222222222222222222222222", category_id=category_id_str, campus_id=campus_2, reporter_id=uuid.uuid4(), description="Guasto C2")
    db.session.add_all([w1, w2])
    db.session.commit()
    
    # Simula la richiesta di un Operatore assegnato SOLO al campus 1
    headers = {
        'X-User-Role': 'OPERATORE',
        'X-Campus-Ids': str(campus_1)
    }
    
    response = client.get('/warnings', headers=headers)
    
    assert response.status_code == 200
    assert len(response.json) == 1
    assert response.json[0]['descrizione'] == "Guasto C1"
    # Verifica che venga restituita la category_id
    assert response.json[0]['category_id'] == category_id_str

def test_resolve_warning_success(client):
    """Verifica la chiusura di una segnalazione e la registrazione della manutenzione (US 6-3)."""
    campus_id = uuid.uuid4()
    operator_id = uuid.uuid4()
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    # 1. Prepara una segnalazione aperta
    warning = Warning(
        asset_id="123456789012345678901234", 
        category_id=category_id_str,
        campus_id=campus_id,
        reporter_id=uuid.uuid4(),
        description="Palo della luce fulminato"
    )
    db.session.add(warning)
    db.session.commit()
    
    # 2. Richiesta di risoluzione da parte di un Operatore autorizzato
    headers = {
        'X-User-Id': str(operator_id),
        'X-User-Role': 'OPERATORE',
        'X-Campus-Ids': str(campus_id)
    }
    payload = {"nota_intervento": "Sostituita lampadina LED."}
    
    response = client.patch(f'/warnings/{warning.id}/resolve', json=payload, headers=headers)
    
    assert response.status_code == 200
    assert response.json['status'] == 'chiusa'
    
    # 3. Verifica l'aggiornamento a DB e la tabella manutenzioni
    updated_warning = db.session.get(Warning, warning.id)
    assert updated_warning.status == WarningStatus.chiusa
    
    maintenance = MaintenanceIntervention.query.filter_by(warning_id=warning.id).first()
    assert maintenance is not None
    assert maintenance.technical_note == "Sostituita lampadina LED."
    assert maintenance.intervention_type == MaintenanceType.correttiva

def test_resolve_warning_wrong_campus(client):
    """Verifica il blocco di sicurezza se l'Operatore tenta di chiudere un ticket fuori giurisdizione."""
    campus_autorizzato = uuid.uuid4()
    campus_non_autorizzato = uuid.uuid4()
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    warning = Warning(
        asset_id="123456789012345678901234", 
        category_id=category_id_str,
        campus_id=campus_non_autorizzato,
        reporter_id=uuid.uuid4(),
        description="Ticket blindato"
    )
    db.session.add(warning)
    db.session.commit()
    
    headers = {
        'X-User-Id': str(uuid.uuid4()),
        'X-User-Role': 'OPERATORE',
        'X-Campus-Ids': str(campus_autorizzato)
    }
    payload = {"nota_intervento": "Tentativo di hack"}
    
    response = client.patch(f'/warnings/{warning.id}/resolve', json=payload, headers=headers)
    assert response.status_code == 403
    assert "Non sei autorizzato" in response.json['error']

def test_create_maintenance_success(client):
    """Verifica la creazione di un intervento di manutenzione diretta (US 4-3)."""
    campus_id = uuid.uuid4()
    asset_id_str = "123456789012345678901234"
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    # Popola la cache locale
    cache_entry = LocalAssetCache(asset_id=asset_id_str, category_id=category_id_str, campus_id=campus_id)
    db.session.add(cache_entry)
    db.session.commit()
    
    headers = {
        'X-User-Id': str(uuid.uuid4()),
        'X-User-Role': 'OPERATORE',
        'X-Campus-Ids': str(campus_id)
    }
    payload = {
        "asset_id": asset_id_str,
        "nota_intervento": "Ispezione ordinaria. Tutto ok.",
        "tipo_intervento": "preventiva"
    }
    
    response = client.post('/maintenances', json=payload, headers=headers)
    
    assert response.status_code == 201
    
    maintenance = MaintenanceIntervention.query.first()
    assert maintenance is not None
    assert maintenance.intervention_type == MaintenanceType.preventiva
    assert maintenance.warning_id is None # Nessuna segnalazione collegata

def test_create_maintenance_invalid_type(client):
    """Verifica che il sistema respinga tipologie di intervento non previste dall'Enum."""
    campus_id = uuid.uuid4()
    asset_id_str = "123456789012345678901234"
    category_id_str = "aaaaaaaaaaaaaaaaaaaaaaaa"
    
    # Popola la cache locale
    cache_entry = LocalAssetCache(asset_id=asset_id_str, category_id=category_id_str, campus_id=campus_id)
    db.session.add(cache_entry)
    db.session.commit()

    headers = {
        'X-User-Id': str(uuid.uuid4()),
        'X-User-Role': 'OPERATORE',
        'X-Campus-Ids': str(campus_id)
    }
    payload = {
        "asset_id": asset_id_str,
        "nota_intervento": "Test tipologia errata",
        "tipo_intervento": "non_esiste" # Errato
    }
    
    response = client.post('/maintenances', json=payload, headers=headers)
    assert response.status_code == 400
    assert "Tipo intervento non valido" in response.json['error']