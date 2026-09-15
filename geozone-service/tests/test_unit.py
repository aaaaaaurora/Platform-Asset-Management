import os
import pytest
import json
import uuid
from unittest.mock import patch
from sqlalchemy import text

# Importa l'app, il database e i modelli dal file principale app.py del servizio geozone
from app import app, db, Campus

# ============================================================================
# FIXTURES E SETUP
# ============================================================================

@pytest.fixture
def client():
    """
    Configura l'applicazione Flask in modalità TESTING e predispone il database
    per ogni singolo test, garantendo un ambiente pulito e conforme alla configurazione condivisa.
    """
    app.config['TESTING'] = True
    app.config['JWT_SECRET'] = 'test-secret-key-per-pytest'
    
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@db:5432/geozone_db')
    
    
    with app.test_client() as client:
        with app.app_context():
            # 1. Abilita l'estensione UUID e PostGIS prima di creare le tabelle
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS postgis;'))
            db.session.commit()
            
            # 2. Pulisce e ricrea il database
            db.drop_all()
            db.create_all()
            
            yield client
            
            # 3. Pulizia al termine del test
            db.session.remove()
            db.drop_all()

@pytest.fixture(autouse=True)
def mock_rabbitmq():
    """
    Mock automatico per RabbitMQ. Previene l'invio reale di eventi durante i test,
    evitando crash se il broker non è raggiungibile durante l'esecuzione dei test unitari.
    """
    with patch('app.mq_manager.publish_event') as mock_pub:
        yield mock_pub

@pytest.fixture
def sample_polygon_geojson():
    """Fixture che restituisce un poligono GeoJSON valido per i test di geolocalizzazione."""
    return {
        "type": "Polygon",
        "coordinates": [
            [[10.0, 45.0], [11.0, 45.0], [11.0, 46.0], [10.0, 46.0], [10.0, 45.0]]
        ]
    }

# ============================================================================
# TEST CASES: ENDPOINT DI SISTEMA E SALUTE
# ============================================================================

def test_health_check(client):
    """Verifica che il probe di Kubernetes risponda correttamente."""
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json['status'] == 'healthy'

# ============================================================================
# TEST CASES: CREAZIONE CAMPUS (US 2-5)
# ============================================================================

def test_create_campus_success(client, sample_polygon_geojson):
    """Verifica la creazione corretta di un campus da parte di un Amministratore delegando i calcoli a PostGIS."""
    headers = {
        'X-User-Role': 'AMMINISTRATORE',
        'X-User-Id': '00000000-0000-0000-0000-000000000000'
    }
    payload = {
        "name": "Campus Centrale",
        "description": "Polo principale dell'ateneo",
        "geometry": sample_polygon_geojson
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json['message'] == "Campus creato con successo."
    assert response.json['campus']['name'] == "Campus Centrale"
    assert 'id' in response.json['campus']

def test_create_campus_unauthorized(client, sample_polygon_geojson):
    """Verifica che un utente non amministratore non possa creare un campus."""
    headers = {
        'X-User-Role': 'OPERATORE',
        'X-User-Id': '11111111-1111-1111-1111-111111111111'
    }
    payload = {
        "name": "Campus Scientifico",
        "geometry": sample_polygon_geojson
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    assert response.status_code == 403
    assert "Accesso negato" in response.json['error']

def test_create_campus_missing_payload(client):
    """Verifica la gestione dell'errore in caso di payload mancante o vuoto."""
    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    response = client.post('/api/geozones/campuses', json={}, headers=headers)
    assert response.status_code == 400
    assert "Payload mancante" in response.json['error']

def test_create_campus_invalid_geometry_type(client):
    """Verifica che il sistema rifiuti geometrie diverse da un Polygon."""
    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    payload = {
        "name": "Campus Lineare",
        "geometry": {"type": "LineString", "coordinates": [[10.0, 45.0], [11.0, 45.0]]}
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    assert response.status_code == 400
    assert "geometrie di tipo 'Polygon'" in response.json['error']

def test_create_campus_invalid_topology(client):
    """Verifica che PostGIS rifiuti poligoni non validi topologicamente (auto-intersezioni a farfalla)."""
    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    payload = {
        "name": "Campus Errato",
        "geometry": {
            "type": "Polygon",
            # Geometria auto-intersecante: forma un '8' o una farfalla, non valida per GIS
            "coordinates": [[[0.0, 0.0], [2.0, 2.0], [0.0, 2.0], [2.0, 0.0], [0.0, 0.0]]]
        }
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    assert response.status_code == 422
    assert "non è un poligono topologicamente valido" in response.json['error']

def test_create_campus_duplicate_name(client, sample_polygon_geojson):
    """Verifica la protezione contro la creazione di campus con lo stesso nome (Case-Insensitive)."""
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Campus Esistente", "desc": "Test", "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    payload = {
        "name": "cAmPuS eSIsTeNtE", # Testiamo anche il case-insensitive inserendo maiuscole alternate
        "geometry": sample_polygon_geojson
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    assert response.status_code == 409
    assert "risulta già censito" in response.json['error']

def test_create_campus_overlapping_area(client, sample_polygon_geojson):
    """Verifica che il sistema blocchi l'inserimento se l'area si sovrappone a un campus esistente."""
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Polo Originale", "desc": "Test", "geojson": json.dumps(sample_polygon_geojson), "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    payload = {
        "name": "Nome Completamente Diverso", # Il nome passa il primo controllo
        "geometry": sample_polygon_geojson    # L'area scatena il secondo blocco
    }

    response = client.post('/api/geozones/campuses', json=payload, headers=headers)
    assert response.status_code == 409
    assert "Area già assegnata" in response.json['error']
    
# ============================================================================
# TEST CASES: CONSULTAZIONE CAMPUS (US 5-1)
# ============================================================================

def test_get_campuses_unauthenticated(client):
    """Verifica che la consultazione fallisca se l'autenticazione è assente."""
    response = client.get('/api/geozones/campuses')
    assert response.status_code == 401
    assert "Autenticazione mancante" in response.json['error']

def test_get_campuses_success(client):
    """Verifica il recupero dell'elenco completo dei campus registrati con conversione GeoJSON."""
    # Inserimento di un campus di prova
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Campus Nord", "desc": "Desc Nord", "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    headers = {'X-User-Role': 'GUEST'}
    response = client.get('/api/geozones/campuses', headers=headers)
    
    assert response.status_code == 200
    assert isinstance(response.json, list)
    assert len(response.json) >= 1
    assert response.json[0]['name'] == "Campus Nord"
    assert response.json[0]['geometry']['type'] == "Polygon"

def test_get_single_campus_success(client):
    """Verifica il recupero dei dettagli di un singolo campus con metriche spaziali (Centroide e BBox)."""
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_GeomFromText('POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))', 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Campus Sud", "desc": "Desc Sud", "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    headers = {'X-User-Role': 'OPERATORE'}
    response = client.get(f'/api/geozones/campuses/{campus_uuid}', headers=headers)
    
    assert response.status_code == 200
    assert response.json['name'] == "Campus Sud"
    assert 'geometry' in response.json
    assert 'centroid' in response.json
    assert 'bounding_box' in response.json

def test_get_single_campus_not_found(client):
    """Verifica la risposta 404 se il campus richiesto non esiste."""
    headers = {'X-User-Role': 'OPERATORE'}
    random_uuid = str(uuid.uuid4())
    response = client.get(f'/api/geozones/campuses/{random_uuid}', headers=headers)
    assert response.status_code == 404
    assert "Campus non trovato" in response.json['error']

# ============================================================================
# TEST CASES: AGGIORNAMENTO CAMPUS (METADATI E GEOMETRIA)
# ============================================================================

def test_update_campus_success(client, sample_polygon_geojson):
    """Verifica l'aggiornamento corretto di un campus esistente da parte di un amministratore."""
    # 1. Inseriamo un campus reale nel database di test
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Vecchio Nome", "desc": "Vecchia descrizione", "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    # 2. Prepariamo la richiesta PUT con i dati aggiornati
    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    payload = {
        "name": "Nuovo Nome Campus",
        "geometry": sample_polygon_geojson
    }

    # 3. Eseguiamo la chiamata all'API
    response = client.put(f'/api/geozones/campuses/{campus_uuid}', json=payload, headers=headers)
    
    # 4. Verifichiamo il successo
    assert response.status_code == 200
    assert response.json['message'] == "Campus aggiornato con successo."
    assert response.json['campus']['name'] == "Nuovo Nome Campus"
    
def test_update_campus_unauthorized(client, sample_polygon_geojson):
    """Verifica che un operatore non possa aggiornare o modificare un campus."""
    headers = {'X-User-Role': 'OPERATORE', 'X-User-Id': '11111111-1111-1111-1111-111111111111'}
    response = client.put(f'/api/geozones/campuses/{str(uuid.uuid4())}', json={"name": "Test"}, headers=headers)
    assert response.status_code == 403
    assert "Accesso negato" in response.json['error']

# ============================================================================
# TEST CASES: ELIMINAZIONE CAMPUS
# ============================================================================

def test_delete_campus_success(client):
    """Verifica l'eliminazione fisica di un campus da parte dell'amministratore."""
    campus_uuid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO campus (id, name, description, geom, admin_id) "
        "VALUES (:id, :name, :desc, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), :admin_id)"
    ), {"id": campus_uuid, "name": "Campus Da Eliminare", "desc": "Elimina", "admin_id": "00000000-0000-0000-0000-000000000000"})
    db.session.commit()

    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    response = client.delete(f'/api/geozones/campuses/{campus_uuid}', headers=headers)
    
    assert response.status_code == 200
    assert "eliminato con successo" in response.json['message']

def test_delete_campus_not_found(client):
    """Verifica la gestione dell'errore 404 se si tenta di eliminare un campus inesistente."""
    headers = {'X-User-Role': 'AMMINISTRATORE', 'X-User-Id': '00000000-0000-0000-0000-000000000000'}
    random_uuid = str(uuid.uuid4())
    response = client.delete(f'/api/geozones/campuses/{random_uuid}', headers=headers)
    assert response.status_code == 404
    assert "Campus non trovato" in response.json['error']

# ============================================================================
# TEST CASES: MOTORE DI CALCOLO SPAZIALE (POINT-IN-POLYGON)
# ============================================================================

@patch('app.db.session.query')
def test_verify_location_inside(mock_db_query, client):
    """Verifica il corretto funzionamento dell'API di validazione Point-In-Polygon quando il punto è interno."""
    # Mock della query spaziale ST_Contains che restituisce True
    mock_db_query.return_value.scalar.return_value = True

    payload = {
        "campusId": str(uuid.uuid4()),
        "latitudine": 45.4642,
        "longitudine": 9.1900
    }

    response = client.post('/api/geozones/verify-location', json=payload)
    assert response.status_code == 200
    assert response.json == {"is_inside": True}

@patch('app.db.session.query')
def test_verify_location_outside(mock_db_query, client):
    """Verifica il corretto funzionamento dell'API di validazione Point-In-Polygon quando il punto è esterno."""
    # Mock della query spaziale ST_Contains che restituisce False
    mock_db_query.return_value.scalar.return_value = False

    payload = {
        "campusId": str(uuid.uuid4()),
        "latitudine": 40.0000,
        "longitudine": 12.0000
    }

    response = client.post('/api/geozones/verify-location', json=payload)
    assert response.status_code == 200
    assert response.json == {"is_inside": False}

def test_verify_location_missing_parameters(client):
    """Verifica la gestione dell'errore se mancano parametri chiave come latitudine o longitudine."""
    payload = {
        "campusId": str(uuid.uuid4()),
        "latitudine": 45.4642
        # Manca longitudine
    }

    response = client.post('/api/geozones/verify-location', json=payload)
    assert response.status_code == 400
    assert "obbligatori" in response.json['error']

def test_verify_location_invalid_coordinates(client):
    """Verifica la gestione dell'errore se vengono passate coordinate non numeriche."""
    payload = {
        "campusId": str(uuid.uuid4()),
        "latitudine": "coordinate_non_valide",
        "longitudine": 9.1900
    }

    response = client.post('/api/geozones/verify-location', json=payload)
    assert response.status_code == 400
    assert "valori numerici validi" in response.json['error']