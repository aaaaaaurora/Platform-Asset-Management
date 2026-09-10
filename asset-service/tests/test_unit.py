import pytest
import mongomock
from unittest.mock import patch
from bson import ObjectId
import json
import app as asset_service  

# ============================================================================
# FIXTURES E SETUP
# ============================================================================

@pytest.fixture
def client():
    """Configura il test client di Flask."""
    asset_service.app.config['TESTING'] = True
    with asset_service.app.test_client() as client:
        yield client

@pytest.fixture(autouse=True)
def mock_mongo(monkeypatch):
    """Sostituisce il client MongoDB reale con Mongomock per test isolati in RAM."""
    mock_db = mongomock.MongoClient().db
    monkeypatch.setattr(asset_service, 'categories_col', mock_db.categories)
    monkeypatch.setattr(asset_service, 'assets_col', mock_db.assets)
    monkeypatch.setattr(asset_service, 'history_col', mock_db.asset_history)
    return mock_db

@pytest.fixture(autouse=True)
def mock_rabbitmq(monkeypatch):
    """Mocca la pubblicazione degli eventi per evitare connessioni reali a RabbitMQ."""
    with patch.object(asset_service.mq_manager, 'publish_event') as mock_pub:
        yield mock_pub

# Header fittizi simulati dall'API Gateway
ADMIN_HEADERS = {
    'X-User-Id': 'admin-123',
    'X-User-Role': 'AMMINISTRATORE',
    'X-Campus-Ids': 'campus-A,campus-B'
}

OPERATOR_HEADERS = {
    'X-User-Id': 'op-456',
    'X-User-Role': 'OPERATORE',
    'X-Campus-Ids': 'campus-A',
    'X-Client-Type': 'mobile'  # <-- FIX: Aggiunto header mobile obbligatorio per l'operatore
}

# ============================================================================
# TEST: CATEGORIE (US 2-1)
# ============================================================================

def test_health_check(client):
    res = client.get('/health')
    assert res.status_code == 200
    assert res.json['status'] == 'healthy'

def test_create_category_admin(client, mock_rabbitmq):
    payload = {"name": "Veicoli", "description": "Categoria mezzi", "icon": "🚜"}
    res = client.post('/api/categories', json=payload, headers=ADMIN_HEADERS)
    assert res.status_code == 201
    assert res.json['category']['name'] == "Veicoli"
    assert res.json['category']['icon'] == "🚜"
    mock_rabbitmq.assert_called_once()

def test_create_category_operator_forbidden(client):
    payload = {"name": "PC"}
    res = client.post('/api/categories', json=payload, headers=OPERATOR_HEADERS)
    assert res.status_code == 403

def test_create_category_duplicate(client):
    client.post('/api/categories', json={"name": "Veicoli"}, headers=ADMIN_HEADERS)
    res = client.post('/api/categories', json={"name": "VEICOLI"}, headers=ADMIN_HEADERS)
    assert res.status_code == 409

def test_get_categories(client):
    client.post('/api/categories', json={"name": "Cat1"}, headers=ADMIN_HEADERS)
    client.post('/api/categories', json={"name": "Cat2"}, headers=ADMIN_HEADERS)
    res = client.get('/api/categories', headers=OPERATOR_HEADERS)
    assert res.status_code == 200
    assert len(res.json) == 2

# ============================================================================
# TEST: ATTRIBUTI DINAMICI E DEPRECAZIONE (US 2-2, US 2-3, US 2-4)
# ============================================================================

@pytest.fixture
def base_category(client):
    res = client.post('/api/categories', json={"name": "Informatica", "icon": "💻"}, headers=ADMIN_HEADERS)
    return res.json['category']['_id']

def test_add_attribute_success(client, base_category):
    payload = {
        "name": "marca",
        "type": "string",
        "required": True,
        "filterable": True
    }
    res = client.post(f'/api/categories/{base_category}/attributes', json=payload, headers=ADMIN_HEADERS)
    assert res.status_code == 201
    attrs = res.json['attributes']
    assert len(attrs) == 1
    assert attrs[0]['name'] == 'marca'
    assert attrs[0]['type'] == 'string'
    assert attrs[0]['status'] == 'active'

def test_add_attribute_invalid_enum(client, base_category):
    payload = {"name": "stato", "type": "enum", "options": []} # Opzioni vuote
    res = client.post(f'/api/categories/{base_category}/attributes', json=payload, headers=ADMIN_HEADERS)
    assert res.status_code == 400

def test_deprecate_attribute(client, base_category):
    client.post(f'/api/categories/{base_category}/attributes', json={"name": "peso", "type": "number"}, headers=ADMIN_HEADERS)
    
    # Deprecazione (US 2-4)
    res = client.put(f'/api/categories/{base_category}/attributes/peso', json={"status": "unavailable"}, headers=ADMIN_HEADERS)
    assert res.status_code == 200
    assert res.json['attributes'][0]['status'] == 'unavailable'

# ============================================================================
# TEST: CENSIMENTO E VALIDAZIONE ASSET (US 3-4)
# ============================================================================

@pytest.fixture
def configured_category(client, base_category):
    client.post(f'/api/categories/{base_category}/attributes', json={"name": "targa", "type": "string", "required": True}, headers=ADMIN_HEADERS)
    client.post(f'/api/categories/{base_category}/attributes', json={"name": "anno", "type": "number"}, headers=ADMIN_HEADERS)
    return base_category

def test_create_asset_success(client, configured_category):
    payload = {
        "category_id": configured_category,
        "campus_id": "campus-A",
        "geometry": {"type": "Point", "coordinates": [12.0, 42.0]},
        "metadata": {"targa": "AB123CD", "anno": 2021}
    }
    res = client.post('/api/assets', json=payload, headers=OPERATOR_HEADERS)
    assert res.status_code == 201
    assert res.json['asset']['campus_id'] == "campus-A"

def test_create_asset_territorial_violation(client, configured_category):
    payload = {
        "category_id": configured_category,
        "campus_id": "campus-X", # Operatore non ha accesso a campus-X
        "geometry": {"type": "Point", "coordinates": [12.0, 42.0]},
        "metadata": {"targa": "AB123CD"}
    }
    res = client.post('/api/assets', json=payload, headers=OPERATOR_HEADERS)
    assert res.status_code == 403

def test_create_asset_validation_missing_required(client, configured_category):
    payload = {
        "category_id": configured_category,
        "campus_id": "campus-A",
        "geometry": {"type": "Point", "coordinates": [12.0, 42.0]},
        "metadata": {"anno": 2021} # Manca 'targa' che è required
    }
    res = client.post('/api/assets', json=payload, headers=OPERATOR_HEADERS)
    assert res.status_code == 422
    assert "targa" in str(res.json['details'])

def test_create_asset_validation_wrong_type(client, configured_category):
    payload = {
        "category_id": configured_category,
        "campus_id": "campus-A",
        "geometry": {"type": "Point", "coordinates": [12.0, 42.0]},
        "metadata": {"targa": "AB123CD", "anno": "Duemilaventuno"} # Tipo errato
    }
    res = client.post('/api/assets', json=payload, headers=OPERATOR_HEADERS)
    assert res.status_code == 422
    assert "anno" in str(res.json['details'])

# ============================================================================
# TEST: CONSULTAZIONE, RICERCA E AGGIORNAMENTO (US 4-1, 4-2, 5-2)
# ============================================================================

@pytest.fixture
def existing_asset(client, configured_category):
    payload = {
        "category_id": configured_category,
        "campus_id": "campus-A",
        "geometry": {"type": "Point", "coordinates": [12.0, 42.0]},
        "metadata": {"targa": "AB123CD", "anno": 2020}
    }
    # FIX: Sostituito ADMIN_HEADERS con OPERATOR_HEADERS perché l'admin non può più censire asset
    res = client.post('/api/assets', json=payload, headers=OPERATOR_HEADERS)
    return res.json['asset']['_id'], configured_category

def test_get_asset_operator(client, existing_asset):
    asset_id, _ = existing_asset
    res = client.get(f'/api/assets/{asset_id}', headers=OPERATOR_HEADERS)
    assert res.status_code == 200
    assert res.json['metadata']['targa'] == "AB123CD"

def test_search_assets_with_dynamic_filters(client, existing_asset):
    # L'asset esistente ha attr_anno=2020 e attr_targa=AB123CD
    res = client.get('/api/assets?attr_anno=2020', headers=OPERATOR_HEADERS)
    assert res.status_code == 200
    assert len(res.json['assets']) == 1
    
    res_empty = client.get('/api/assets?attr_anno=2024', headers=OPERATOR_HEADERS)
    assert len(res_empty.json['assets']) == 0

def test_update_asset_and_preserve_deprecated_field(client, existing_asset):
    asset_id, cat_id = existing_asset
    
    # 1. Depreco il campo 'anno' nella categoria (L'admin PUO' farlo)
    client.put(f'/api/categories/{cat_id}/attributes/anno', json={"status": "unavailable"}, headers=ADMIN_HEADERS)
    
    # 2. Aggiorno l'asset inviando solo la targa (l'operatore non vede più 'anno')
    update_payload = {
        "metadata": {"targa": "NEW-TARGA"}
    }
    res = client.put(f'/api/assets/{asset_id}', json=update_payload, headers=OPERATOR_HEADERS)
    
    # 3. Verifico che la nuova targa sia stata salvata ma che l'anno non sia andato perso
    assert res.status_code == 200
    assert res.json['asset']['metadata']['targa'] == "NEW-TARGA"
    assert res.json['asset']['metadata']['anno'] == 2020 # Conservato per storico

# ============================================================================
# TEST: ELIMINAZIONE E HISTORY (AUDIT TRAIL)
# ============================================================================

def test_delete_asset_creates_history(client, existing_asset):
    asset_id, _ = existing_asset
    
    # Verifica che ci sia un solo record in history (quello della creazione)
    hist_before = client.get(f'/api/assets/{asset_id}/history', headers=ADMIN_HEADERS)
    assert len(hist_before.json['history']) == 1

    # Elimina l'asset (L'admin PUO' eliminare)
    res = client.delete(f'/api/assets/{asset_id}', headers=ADMIN_HEADERS)
    assert res.status_code == 200

    # L'asset non deve più esistere nella collection principale
    get_res = client.get(f'/api/assets/{asset_id}', headers=ADMIN_HEADERS)
    assert get_res.status_code == 404

    # Lo storico deve contenere il nuovo snapshot di tipo DELETE
    hist_after = client.get(f'/api/assets/{asset_id}/history', headers=ADMIN_HEADERS)
    history_list = hist_after.json['history']
    assert len(history_list) == 2
    assert history_list[1]['action'] == 'DELETE'
    assert history_list[1]['state_snapshot']['metadata']['targa'] == 'AB123CD'
    
    # ============================================================================
# TEST: ESPORTAZIONE CSV ASSET 
# ============================================================================

def test_export_assets_csv_admin(client, existing_asset):
    """Verifica che l'admin possa scaricare il CSV con le colonne dinamiche popolate."""
    # existig_asset restituisce (asset_id, category_id) dal fixture[cite: 12]
    res = client.get('/api/assets/export', headers=ADMIN_HEADERS)
    
    assert res.status_code == 200
    assert "text/csv" in res.headers["Content-Type"]
    assert "attachment" in res.headers["Content-Disposition"]
    
    csv_content = res.data.decode('utf-8')
    # Controlli Strutturali
    assert "ID Seriale" in csv_content
    assert "Latitudine" in csv_content
    # Controlli sui Metadati Dinamici generati dall'asset fittizio
    assert "Targa" in csv_content 
    assert "AB123CD" in csv_content

def test_export_assets_csv_operator_forbidden(client):
    """Verifica il blocco di sicurezza in caso di richiesta da operatore."""
    res = client.get('/api/assets/export', headers=OPERATOR_HEADERS)
    assert res.status_code == 403