import os
import json
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

# Impostiamo l'ambiente di test prima di importare l'app
os.environ['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/log_db')

from app import app, db, AuditLog, AuditLogRepository


@pytest.fixture
def client():
    """
    Configura l'applicazione Flask in modalità TESTING,
    pulisce e ricrea il database per ogni singolo test.
    """
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/log_db')
    
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
            yield client
            db.session.remove()
            db.drop_all()


@pytest.fixture
def sample_log(client):
    """Fixture per popolare un record di log di test nel database."""
    with app.app_context():
        log = AuditLog(
            service_name="asset-service",
            action="ASSET_CREATED",
            payload={
                "campus_id": "campus-uuid-123",
                "category_id": "category-uuid-456",
                "status": "operativo",
                "custom_attr": "valore_test"
            }
        )
        db.session.add(log)
        db.session.commit()
        # Ricarichiamo l'oggetto per averlo disponibile con ID e timestamp valorizzati
        db.session.refresh(log)
        return log


# ============================================================================
# 1. TEST HEALTH CHECK
# ============================================================================

def test_health_check(client):
    """Verifica che la rotta di health check risponda correttamente."""
    response = client.get('/health')
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"


# ============================================================================
# 2. TEST CONSUMER RABBITMQ & REPOSITORY (APPEND-ONLY)
# ============================================================================

def test_audit_log_repository_insert(client):
    """Verifica il corretto inserimento tramite repository (Append-Only)."""
    with app.app_context():
        log_entry = AuditLog(
            service_name="ticket-service",
            action="CREATE_WARNING",
            payload={"priority": "high"}
        )
        saved = AuditLogRepository.insert(log_entry)
        assert saved.id is not None
        assert saved.service_name == "ticket-service"


@patch('app.RabbitMQManager')
def test_process_log_event_callback(mock_mq_manager, client):
    """Simula la ricezione di un evento RabbitMQ e verifica la persistenza su DB."""
    from app import process_log_event
    
    mock_channel = MagicMock()
    mock_method = MagicMock()
    mock_method.delivery_tag = 1
    
    event_data = {
        "service_name": "auth-service",
        "azione": "USER_CREATED",
        "autore_id": "123e4567-e89b-12d3-a456-426614174000",
        "correlation_id": "123e4567-e89b-12d3-a456-426614174001",
        "entity_id": "123e4567-e89b-12d3-a456-426614174002",
        "campus_id": "campus-uuid-123"
    }
    body = json.dumps(event_data).encode('utf-8')
    
    process_log_event(mock_channel, mock_method, None, body)
    
    mock_channel.basic_ack.assert_called_once_with(delivery_tag=1)
    
    from app import app, AuditLogRepository
    with app.app_context():
        logs = AuditLogRepository.get_all_logs({})
        assert len(logs) == 1
        assert logs[0].action == "USER_CREATED"
        
# ============================================================================
# 3. TEST CONSULTAZIONE STORICO (US 7-1 / UC-AMM-05)
# ============================================================================

def test_get_logs_unauthorized(client, sample_log):
    """Verifica che un utente non amministratore riceva 403 Forbidden."""
    response = client.get('/api/logs', headers={
        "X-User-Role": "OPERATORE",
        "X-User-Id": "user-123",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 403


def test_get_logs_success(client, sample_log):
    """Verifica la consultazione dello storico con successo per l'Amministratore."""
    response = client.get('/api/logs?limit=10&page=1', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-User-Id": "admin-123",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    data = response.get_json()
    assert data["total_items"] == 1
    assert len(data["logs"]) == 1
    assert data["logs"][0]["action"] == "ASSET_CREATED"


def test_get_logs_with_filters(client, sample_log):
    """Verifica i filtri per service_name e campus_id (JSONB)."""
    # Filtro corretto
    response = client.get('/api/logs?service_name=asset-service&campus_id=campus-uuid-123', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    assert response.get_json()["total_items"] == 1

    # Filtro con campus inesistente o non autorizzato
    response_empty = client.get('/api/logs?campus_id=campus-inesistente', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response_empty.status_code == 200
    assert response_empty.get_json()["total_items"] == 0


# ============================================================================
# 4. TEST DETTAGLIO SINGOLO LOG (US 7-1)
# ============================================================================

def test_get_log_detail_success(client, sample_log):
    """Verifica il recupero del dettaglio di un singolo log tramite UUID."""
    response = client.get(f'/api/logs/{sample_log.id}', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    data = response.get_json()
    assert data["id"] == str(sample_log.id)
    assert data["payload"]["status"] == "operativo"


def test_get_log_detail_not_found(client):
    """Verifica che un UUID inesistente restituisca 404 Not Found."""
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    response = client.get(f'/api/logs/{fake_uuid}', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 404


# ============================================================================
# 5. TEST ESPORTAZIONE CSV (US 7-2 / UC-AMM-06)
# ============================================================================

def test_export_logs_csv(client, sample_log):
    """Verifica l'esportazione dinamica in formato CSV."""
    response = client.get('/api/logs/export', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert "attachment" in response.headers["Content-Disposition"]
    
    csv_content = response.data.decode('utf-8')
    
    assert "Servizio" in csv_content
    assert "Azione" in csv_content
    assert "Utente" in csv_content
    assert len(csv_content.splitlines()) > 1


# ============================================================================
# 6. TEST DASHBOARD METRICHE E GRAFICI (US 7-3 / UC-AMM-07)
# ============================================================================

def test_dashboard_metrics(client, sample_log):
    """Verifica il calcolo netto delle metriche KPI e distribuzioni."""
    response = client.get('/api/dashboard/metrics', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    data = response.get_json()
    
    assert "totals" in data
    assert data["totals"]["assets"] == 1
    assert "distributions" in data
    assert "by_campus" in data["distributions"]
    assert data["distributions"]["by_campus"]["campus-uuid-123"] == 1


def test_dashboard_charts(client, sample_log):
    """Verifica la generazione dei dati per i grafici (Time-Series)."""
    response = client.get('/api/dashboard/charts', headers={
        "X-User-Role": "AMMINISTRATORE",
        "X-Campus-Ids": "campus-uuid-123"
    })
    assert response.status_code == 200
    data = response.get_json()
    
    assert "time_series" in data
    assert isinstance(data["time_series"], list)