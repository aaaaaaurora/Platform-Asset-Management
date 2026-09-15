import os
import pytest
import json
import jwt
import pyotp
import datetime
import uuid
from unittest.mock import patch
from sqlalchemy import text

os.environ['DATABASE_URL'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/auth_db')

# Importa l'app e i modelli dal tuo file principale 
from app import app, db, AppUser, Role, RoleType, UserCampus, UserCategory

# ============================================================================
# FIXTURES E SETUP
# ============================================================================

@pytest.fixture
def client():
    """
    Configura l'applicazione Flask in modalità TESTING e predispone il database
    per ogni singolo test, garantendo un ambiente pulito.
    """
    app.config['TESTING'] = True
    app.config['JWT_SECRET'] = 'test-secret-key-per-pytest'
    
    # Legge l'URL dinamico da Jenkins, altrimenti usa il default locale per i tuoi test su PC
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/auth_db')
    
    with app.test_client() as client:
        with app.app_context():
            # 1. Abilita l'estensione UUID su Postgres prima di fare qualsiasi cosa
            db.session.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
            db.session.commit()
            
            # 2. Pulisce e ricrea il database
            db.drop_all()
            db.create_all()
            
            # 3. Seed dei ruoli necessari
            db.session.add_all([
                Role(name=RoleType.GUEST, description='Utente base'),
                Role(name=RoleType.OPERATORE, description='Tecnico sul campo'),
                Role(name=RoleType.AMMINISTRATORE, description='Admin sistema')
            ])
            db.session.commit()
            
            yield client
            
            # 4. Pulizia al termine del test
            db.session.remove()
            db.drop_all()

@pytest.fixture(autouse=True)
def mock_rabbitmq():
    """
    Mock automatico per RabbitMQ. Previene l'invio reale di eventi durante i test,
    evitando crash se il broker non è raggiungibile durante i test unitari.
    """
    with patch('app.mq_manager.publish_event') as mock_pub:
        yield mock_pub

@pytest.fixture
def mock_google_verify():
    """
    Mock per la validazione del token di Google. Restituisce un payload utente valido.
    """
    with patch('app.id_token.verify_oauth2_token') as mock_verify:
        mock_verify.return_value = {
            "sub": "1234567890",
            "email": "mario.rossi@studenti.unisa.it",
            "given_name": "Mario",
            "family_name": "Rossi"
        }
        yield mock_verify

# ============================================================================
# TEST CASES
# ============================================================================

def test_health_check(client):
    """Verifica che il probe di Kubernetes risponda correttamente."""
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json['status'] == 'healthy'

@patch('app.verify_google_token')
def test_auth_google_success(mock_verify, client):
    """
    Verifica il login con Google (FASE 1: generazione temp_token senza toccare il DB)
    """
    mock_verify.return_value = {
        "sub": "1234567890_test_user",
        "email": "mario.rossi@studenti.unisa.it",
        "given_name": "Mario",
        "family_name": "Rossi"
    }

    payload = {"google_id_token": "dummy_google_token"}
    response = client.post('/auth/google', json=payload)
    
    assert response.status_code == 200
    assert 'temp_token' in response.json
    assert 'totp_uri' in response.json  # Verifica che venga restituito l'URI per il QR code
    assert response.json['user']['email'] == "mario.rossi@studenti.unisa.it"
    
    # LA MODIFICA CHIAVE: Verifica che l'utente NON sia ancora stato creato nel DB
    user = AppUser.query.filter_by(email="mario.rossi@studenti.unisa.it").first()
    assert user is None


def test_auth_google_missing_token(client):
    """Verifica la gestione dell'errore se manca il token nel payload."""
    response = client.post('/auth/google', json={})
    assert response.status_code == 400
    assert "Token mancante" in response.json['error']


@patch('app.pyotp.TOTP.verify')
def test_verify_2fa_existing_user_success(mock_totp_verify, client):
    """
    Verifica il login per un UTENTE ESISTENTE tramite 2FA.
    """
    # Preparazione utente mock nel DB
    role = Role.query.filter_by(name=RoleType.GUEST).first()
    user = AppUser(email="esistente@studenti.unisa.it", role_id=role.id, totp_secret="TESTSECRET")
    db.session.add(user)
    db.session.commit()
    
    # Generazione manuale del temp_token
    temp_payload = {"user_id": str(user.id), "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=5)}
    temp_token = jwt.encode(temp_payload, app.config['JWT_SECRET'], algorithm="HS256")
    
    mock_totp_verify.return_value = True
    
    response = client.post('/auth/2fa/verify', json={
        "temp_token": temp_token,
        "totp_code": "123456"
    })
    
    assert response.status_code == 200
    assert 'token' in response.json


@patch('app.pyotp.TOTP.verify')
def test_verify_2fa_new_user_success(mock_totp_verify, client):
    """
    Verifica l'Auto-Provisioning (creazione nel DB) di un NUOVO UTENTE 
    dopo aver validato il TOTP con successo.
    """
    # Simuliamo il token temporaneo che /auth/google avrebbe passato al frontend per un nuovo utente
    temp_payload = {
        "is_new_user": True,
        "email": "nuovo.utente@studenti.unisa.it",
        "google_id": "google_123",
        "first_name": "Nuovo",
        "last_name": "Utente",
        "totp_secret": "NEWSECRET",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=5)
    }
    temp_token = jwt.encode(temp_payload, app.config['JWT_SECRET'], algorithm="HS256")
    
    # Forziamo il mock del TOTP a restituire True (l'utente ha inserito il codice giusto)
    mock_totp_verify.return_value = True
    
    response = client.post('/auth/2fa/verify', json={
        "temp_token": temp_token,
        "totp_code": "123456"
    })
    
    assert response.status_code == 200
    assert 'token' in response.json
    
    # ORA verifichiamo che l'utente sia stato effettivamente salvato nel DB!
    user = AppUser.query.filter_by(email="nuovo.utente@studenti.unisa.it").first()
    assert user is not None
    assert user.role_id is not None

def test_create_operator_success(client):
    """Verifica che un admin possa creare un nuovo operatore."""
    headers = {'X-User-Id': str(uuid.uuid4())}
    payload = {
        "email": "nuovo.operatore@campus.it",
        "campus_ids": [str(uuid.uuid4())]
    }
    
    response = client.post('/admin/operators', json=payload, headers=headers)
    
    assert response.status_code == 201
    assert 'user_id' in response.json
    assert 'totp_provisioning_uri' in response.json
    
    # Verifica salvataggio a DB
    new_op = AppUser.query.filter_by(email="nuovo.operatore@campus.it").first()
    assert new_op is not None
    # Verifica che il ruolo sia effettivamente OPERATORE
    role = db.session.get(Role, new_op.role_id)
    assert role.name == RoleType.OPERATORE

def test_create_operator_duplicate(client):
    """Verifica la protezione contro la creazione di operatori duplicati."""
    # Creiamo un operatore prima
    role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    user = AppUser(email="duplicato@campus.it", role_id=role.id)
    db.session.add(user)
    db.session.commit()
    
    # Tentiamo di ricrearlo
    response = client.post('/admin/operators', json={"email": "duplicato@campus.it"})
    assert response.status_code == 409
    assert "già presente" in response.json['error']

def test_update_operator_success(client):
    """Verifica l'aggiornamento dei permessi spaziali (Campus) di un operatore."""
    # 1. Creazione operatore base
    role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    user = AppUser(email="update@campus.it", role_id=role.id)
    db.session.add(user)
    db.session.commit()
    
    new_campus_id = str(uuid.uuid4())
    
    # 2. Esecuzione aggiornamento
    response = client.put(f'/admin/operators/{str(user.id)}', json={
        "campus_ids": [new_campus_id]
    })
    
    assert response.status_code == 200
    
    # 3. Verifica che il Soft Link sia stato creato correttamente
    link = UserCampus.query.filter_by(user_id=user.id).first()
    assert link is not None
    assert str(link.campus_id) == new_campus_id

def test_get_operators(client):
    """Verifica il recupero della lista degli operatori simulando un admin."""
    # 1. Creiamo un Amministratore di test per superare il controllo di sicurezza
    admin_role = Role.query.filter_by(name=RoleType.AMMINISTRATORE).first()
    admin = AppUser(email="admin_test@campus.it", role_id=admin_role.id, first_name="Admin", last_name="Test")
    
    # 2. Creiamo i due Operatori standard
    role = Role.query.filter_by(name=RoleType.OPERATORE).first()
    op1 = AppUser(email="op1@campus.it", role_id=role.id, first_name="A", last_name="B")
    op2 = AppUser(email="op2@campus.it", role_id=role.id, first_name="C", last_name="D")
    
    db.session.add_all([admin, op1, op2])
    db.session.commit()

    # 3. Effettuiamo la chiamata includendo l'header obbligatorio X-User-Id
    headers = {'X-User-Id': str(admin.id)}
    response = client.get('/admin/operators', headers=headers)

    assert response.status_code == 200
    
    # Verifica aggiuntiva per assicurarsi che il payload non sia vuoto
    data = response.get_json()
    assert len(data) >= 2
    