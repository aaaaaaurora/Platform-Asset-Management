import os
import jwt
import requests
from flask_cors import CORS
from flask import Flask, request, jsonify, Response

# ============================================================================
# INIZIALIZZAZIONE E CONFIGURAZIONE 
# ============================================================================

app = Flask(__name__)
CORS(app)
# Configurazione della chiave segreta per la validazione del JWT
app.config['JWT_SECRET'] = os.getenv('JWT_SECRET', 'super-secret-key-fallback')

# Mappatura dei microservizi di backend (configurabili tramite variabili d'ambiente o service discovery di K8s)
SERVICES = {
    'auth': os.getenv('AUTH_SERVICE_URL', 'http://auth-service:5000'),
    'geozone': os.getenv('GEOZONE_SERVICE_URL', 'http://geozone-service:5000'),
    'asset': os.getenv('ASSET_SERVICE_URL', 'http://asset-service:5000'),
    'warning': os.getenv('WARNING_SERVICE_URL', 'http://warning-service:5000'),
    'log': os.getenv('LOG_SERVICE_URL', 'http://log-service:5000'),
    'media': os.getenv('MEDIA_SERVICE_URL', 'http://media-service:5000')
}

# ============================================================================
# FUNZIONI DI UTILITA' E SICUREZZA
# ============================================================================

def verify_jwt_token():
    """
    Estrae e valida crittograficamente il token JWT dall'header Authorization (Bearer Token).
    Restituisce il payload decodificato in caso di successo, altrimenti None.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ')[1]
    try:
        # Decodifica e verifica della firma con l'algoritmo standard HS256
        payload = jwt.decode(token, app.config['JWT_SECRET'], algorithms=["HS256"])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# ============================================================================
# ENDPOINT PER IL LIVENESS / READINESS PROBE
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint per i controlli di integrità di Kubernetes."""
    return jsonify({"status": "healthy", "service": "api-gateway"}), 200

# ============================================================================
# SMISTATORE DI TRAFFICO (REVERSE PROXY DINAMICO)
# ============================================================================

# <-- 3. Aggiunto il metodo 'OPTIONS' per permettere al proxy di instradarlo se necessario
@app.route('/api/<service_name>', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
@app.route('/api/<service_name>/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def gateway_proxy(service_name, path):
    """
    Punto di ingresso unico: intercetta le chiamate verso /api/<service_name>/<path>,
    valida il token, arricchisce la richiesta e la inoltra al servizio di competenza.
    """
    if service_name not in SERVICES:
        return jsonify({"error": "Gateway Error: Microservizio di destinazione non trovato"}), 404

    # Costruzione dell'URL di destinazione verso il microservizio interno
    target_base_url = SERVICES[service_name]
    target_url = f"{target_base_url}/{path}" if path else f"{target_base_url}"

    # Validazione opzionale/rigida del JWT per le rotte protette
    token_payload = verify_jwt_token()

    # Copia degli header originali escludendo l'Host
    headers = {key: value for (key, value) in request.headers if key.lower() != 'host'}

    # Se il token è valido, iniettiamo i metadati dell'utente per i microservizi a valle
    if token_payload:
        headers['X-User-Id'] = str(token_payload.get('sub'))
        headers['X-User-Role'] = str(token_payload.get('role', ''))
        headers['X-User-Email'] = str(token_payload.get('email', '')) 
        
        # Estrazione e propagazione dei campus autorizzati (convertiti in stringa separata da virgole)
        campus_ids = token_payload.get('campus_ids', [])
        if isinstance(campus_ids, list):
            headers['X-Campus-Ids'] = ",".join(str(c) for c in campus_ids)
            
    try:
        # Inoltro della richiesta HTTP utilizzando la libreria requests
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers=headers,
            data=request.get_data(),
            cookies=request.cookies,
            params=request.args,
            allow_redirects=False,
            timeout=60
        )

        # Filtraggio degli header di hop-by-hop non instradabili
        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        headers_to_forward = [
            (name, value) for (name, value) in resp.raw.headers.items() 
            if name.lower() not in excluded_headers
        ]

        # Restituzione della risposta del microservizio direttamente al client originario
        return Response(resp.content, resp.status_code, headers_to_forward)

    except requests.exceptions.RequestException as e:
        return jsonify({
            "error": f"Gateway Timeout o Errore di comunicazione con il servizio '{service_name}': {str(e)}"
        }), 502


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
