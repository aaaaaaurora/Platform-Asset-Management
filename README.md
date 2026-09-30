# Platform Asset Management

Piattaforma **cloud-native e mobile** per il censimento, la manutenzione e il monitoraggio di **asset geolocalizzati in ambito Multi-Campus**.

Progetto di tesi del Corso di Laurea Magistrale in **Ingegneria Informatica** – Dipartimento DIEM, Università degli Studi di Salerno – A.A. 2025/2026.

**Autrici:** Aurora Campione, Claudia Carucci

---

## Indice

1. [Panoramica](#1-panoramica)
2. [Funzionalità principali](#2-funzionalità-principali)
3. [Attori e ruoli](#3-attori-e-ruoli)
4. [Architettura](#4-architettura)
5. [Stack tecnologico](#5-stack-tecnologico)
6. [Struttura del repository](#6-struttura-del-repository)
7. [Microservizi in dettaglio](#7-microservizi-in-dettaglio)
8. [Frontend (Web App e App Mobile)](#8-frontend-web-app-e-app-mobile)
9. [Modello dei dati](#9-modello-dei-dati)
10. [Comunicazione asincrona (RabbitMQ)](#10-comunicazione-asincrona-rabbitmq)
11. [Infrastruttura e deployment su Kubernetes](#11-infrastruttura-e-deployment-su-kubernetes)
12. [Pipeline CI/CD (Jenkins)](#12-pipeline-cicd-jenkins)
13. [Accesso al sistema in produzione](#13-accesso-al-sistema-in-produzione)
14. [Guida rapida ai test funzionali](#14-guida-rapida-ai-test-funzionali)
15. [Installazione dell'app mobile](#15-installazione-dellapp-mobile)
16. [Riferimento API](#16-riferimento-api)
17. [Attributi di qualità e tattiche architetturali](#17-attributi-di-qualità-e-tattiche-architetturali)
18. [Testing](#18-testing)
19. [Sviluppo locale](#19-sviluppo-locale)
20. [Configurazione e gestione dei segreti](#20-configurazione-e-gestione-dei-segreti)
21. [Documentazione di progetto e scostamenti dal design](#21-documentazione-di-progetto-e-scostamenti-dal-design)
22. [Note e limitazioni](#22-note-e-limitazioni)
23. [Licenza e contatti](#23-licenza-e-contatti)

---

## 1. Panoramica

Nei contesti operativi moderni la raccolta dei dati sul campo è soggetta a errori umani, lentezza di inserimento e rigidità degli schemi dati. Questa piattaforma risponde con tre obiettivi:

| Obiettivo | Descrizione |
|---|---|
| **Flessibilità e indipendenza dal dominio** | Gli Amministratori definiscono **a runtime** nuove categorie di asset (pali della luce, alberi, panchine, irrigatori…) e i relativi attributi (stringa, numero, booleano, data, menu a tendina) **senza modificare codice o schema del database**, grazie alla persistenza schema-less su MongoDB. |
| **Automazione con Intelligenza Artificiale** | L'app mobile acquisisce le coordinate GPS e le foto; il Media Service invoca **Google Cloud Vision API** che analizza le immagini e **suggerisce i metadati**. L'Operatore può sempre correggere e validare. L'AI è usata esclusivamente *as a Service*. |
| **Gestione centralizzata e sicura** | Backend a microservizi con **isolamento dei dati per campus**, **2FA** (TOTP), **RBAC** basato su JWT e storicizzazione immutabile di ogni operazione. Il pubblico partecipa tramite un sistema di segnalazione guasti. |

Il sistema è validato su due domini operativi distinti, per dimostrare l'indipendenza dallo schema dati: un caso **infrastrutturale** (pali dell'illuminazione) e un caso **biologico** (alberi del campus).

---

## 2. Funzionalità principali

**Identità e sicurezza**
- Login con **Google OAuth 2.0** (nessuna password gestita internamente).
- **2FA obbligatoria** con Microsoft Authenticator (TOTP, libreria `pyotp`).
- Auto-provisioning degli Utenti Base al primo accesso; profili Operatore pre-registrati dall'Amministratore tramite e-mail.
- **JWT** (HS256) con ruolo, campus e categorie; validato dall'API Gateway.
- Operatori associati a zero o più campus e a una categoria di asset.

**Configurazione dinamica del dominio**
- Creazione, modifica ed eliminazione di **categorie**, con aggiunta e modifica di **attributi personalizzati**.
- Attributi utilizzabili come **filtri di ricerca**; stato **"Unavailable"** per deprecare un attributo preservando lo storico.
- Registrazione di **campus** con perimetro geografico (poligono) su PostGIS.

**Censimento sul campo (app mobile)**
- **Georeferenziazione automatica** via GPS.
- Foto tramite fotocamera nativa (Capacitor Camera), con compressione lato server (Pillow).
- **Suggerimenti automatici** dei metadati tramite Computer Vision; revisione e correzione manuale prima del salvataggio.
- Degradazione graziosa: se l'AI non risponde, si prosegue con il form vuoto.

**Manutenzione e storicizzazione**
- Modifica di attributi e immagini di un asset già censito.
- Interventi di manutenzione (preventiva/correttiva) con nota testuale.
- **Storico immutabile** ad ogni aggiornamento (`asset_history`) con operatore e timestamp.

**Esplorazione e mappatura**
- **Mappa interattiva** vettoriale (MapLibre GL JS + OpenFreeMap/OpenStreetMap) con marker e scheda di dettaglio.
- Vista **a elenco** filtrabile per categoria, campus e attributi dinamici.
- Visualizzazioni limitate automaticamente al perimetro di competenza dell'utente.

**Segnalazioni pubbliche**
- L'Utente Base seleziona un asset sulla mappa e invia una segnalazione testuale.
- L'Operatore consulta le segnalazioni del proprio campus e le chiude registrando una nota di intervento.

**Reportistica (Amministratore)**
- **Storico** completo e filtrabile delle operazioni (audit log).
- **Dashboard** con metriche (asset totali, distribuzione per categoria e campus, segnalazioni, interventi) e grafici.
- **Esportazione CSV** di storico e asset.

---

## 3. Attori e ruoli

| Ruolo (`RoleType`) | Client | Descrizione |
|---|---|---|
| `GUEST` (Utente Base) | Web App | Studenti, docenti, visitatori. Consulta la mappa e invia segnalazioni. Accede con qualsiasi account Google. |
| `OPERATORE` | App Mobile (censimento) + Web App | Personale tecnico. Censisce, aggiorna e gestisce le segnalazioni nei campus e nelle categorie assegnati. |
| `AMMINISTRATORE` | Web App | Configura categorie, attributi, campus e profili Operatore; consulta dashboard e storico; esporta i dati. |

---

## 4. Architettura

Architettura a **microservizi** con pattern **Database-per-Service** e **Polyglot Persistence**. Comunicazione sincrona REST/JSON attraverso un unico API Gateway, comunicazione asincrona event-driven su **RabbitMQ**.

```
   Amministratore · Operatore · Utente Base
                    │  HTTP(S)
        ┌───────────▼───────────┐
        │  Frontend (React/Nginx)│   Web App SPA  +  App Android (Capacitor)
        └───────────┬───────────┘
                    │  /api/<servizio>/...
        ┌───────────▼───────────┐
        │      API Gateway       │   Flask: verifica JWT, inietta X-User-*,
        │   (2 repliche, K8s)    │   proxy verso i microservizi
        └─┬────┬─────┬────┬────┬─┴───┐
          ▼    ▼     ▼    ▼    ▼     ▼
        Auth GeoZone Asset Media Warning Log
        (PG)  (PostGIS)(Mongo)(MinIO+PG) (PG)   (PG)
          └──────────┴──────┴─────┴───────┴──────┘
                 RabbitMQ – exchange fanout `system_events`
```

### Servizi

| Servizio | Cartella | Responsabilità | Persistenza |
|---|---|---|---|
| **Frontend** | `frontend/` | Web App (React + TypeScript) servita da Nginx; base per l'app Android. | – |
| **API Gateway** | `api-gateway-service/` | Ingresso unico; decodifica il JWT e propaga l'identità agli altri servizi; reverse proxy. | – |
| **Auth Service** | `auth-service/` | Login Google, 2FA TOTP, gestione Operatori, emissione JWT. | PostgreSQL |
| **GeoZone Service** | `geozone-service/` | CRUD dei campus, poligoni GeoJSON, verifica di appartenenza di una coordinata. | PostgreSQL + PostGIS |
| **Asset Service** | `asset-service/` | Categorie dinamiche, attributi, asset, storico, esportazione. | MongoDB |
| **Media Service** | `media-service/` | Upload, compressione e archiviazione immagini; analisi con Cloud Vision. | MinIO (S3) + PostgreSQL |
| **Warning Service** | `warning-service/` | Segnalazioni e interventi di manutenzione. | PostgreSQL |
| **Log Service** | `log-service/` | Audit log immutabile, dashboard, esportazione CSV; consumer degli eventi. | PostgreSQL |
| **Shared utils** | `shared_utils/` | `RabbitMQManager`: pubblicazione/consumo eventi condiviso da tutti i servizi. | – |

### Servizi esterni

| Servizio | Uso |
|---|---|
| Google OAuth 2.0 | Autenticazione primaria delegata |
| Microsoft Authenticator | Secondo fattore (TOTP) |
| OpenFreeMap / OpenStreetMap | Tile vettoriali e dati geografici (anche per il recupero del perimetro dei campus) |
| Google Cloud Vision API | Analisi semantica delle immagini |

### Scelte progettuali chiave
- **Database-per-Service** con **soft linking**: i servizi si riferiscono a risorse altrui solo tramite UUID/ID, senza foreign key cross-service.
- **Eventual consistency** con eventi su RabbitMQ; cache locali dei riferimenti (`campus_cache` nell'Asset Service, `local_asset_cache` nel Warning Service).
- **Claim Check** per le immagini: binari su MinIO, indice su PostgreSQL.
- **Append-only** per storico asset, interventi e audit log.
- **Isolamento multi-campus**: ogni servizio filtra i dati in base ai campus presenti nel JWT (`X-Campus-Ids`).

---

## 5. Stack tecnologico

| Ambito | Tecnologie (versioni dal repository) |
|---|---|
| **Backend** | Python 3.9 (immagini `python:3.9-slim`), Flask 3.0.0, Flask-SQLAlchemy 3.1.1, Flask-Migrate, PyJWT 2.8, pyotp 2.9, google-auth 2.29, Pillow, marshmallow (Log), flask-cors (Gateway) |
| **Frontend** | React 19, TypeScript 5.7, Vite 6, Tailwind CSS 4, React Router 7, ApexCharts, `@react-oauth/google`, `jwt-decode`, MapLibre GL JS 3.6.2 (+ `react-map-gl`), Leaflet, `@capacitor/core` e `@capacitor/camera` |
| **Base UI** | Template open-source *TailAdmin React* (licenza MIT, vedi `frontend/LICENSE.md`) |
| **Database** | PostgreSQL 15 (+ PostGIS 3.4 con GeoAlchemy2), MongoDB 4.4 (pymongo 4.6) |
| **Object storage** | MinIO (client `minio` 7.2) |
| **Messaggistica** | RabbitMQ 3 (management) con client `pika` 1.3 |
| **AI** | Google Cloud Vision (`google-cloud-vision` 3.7) |
| **Container e orchestrazione** | Docker, Kubernetes (K3s) con Ingress NGINX |
| **CI/CD** | Jenkins (Pipeline dichiarativa), Docker Hub, `kubectl`, Newman (Postman) |
| **Testing** | Pytest, pytest-mock, mongomock, collection Postman/Newman |

---

## 6. Struttura del repository

Il repository GitHub contiene il ramo **`master`** con backend, frontend web, manifest Kubernetes e pipeline.

```
Platform-Asset-Management/
├── Jenkinsfile                     # Pipeline CI/CD (test, build, push, deploy)
├── api-gateway-service/            # Gateway Flask
│   ├── app.py  Dockerfile  requirements.txt
│   └── tests/                      # test_unit.py + collection Postman
├── auth-service/                   # Identità, 2FA, JWT, Operatori
│   ├── app.py  Dockerfile  requirements.txt
│   └── tests/                      # test_unit.py, setup_tests.sh, collection Postman
├── geozone-service/                # Campus e geometrie (PostGIS)
├── asset-service/                  # Categorie, asset, storico (MongoDB)
├── media-service/                  # Immagini, MinIO, Cloud Vision
├── warning-service/                # Segnalazioni e manutenzioni
├── log-service/                    # Audit log, dashboard, export CSV
├── shared_utils/
│   └── messaging.py                # RabbitMQManager (pub/sub condiviso)
├── frontend/                       # Web App React + TypeScript (Vite)
│   ├── src/
│   │   ├── App.tsx                 # Routing e controllo accessi per ruolo
│   │   ├── context/                # AuthContext, ThemeContext, SidebarContext
│   │   ├── components/             # admin/, auth/, dashboard/, guest/, form/, ui/ ...
│   │   ├── layout/                 # AppLayout, AppHeader, AppSidebar
│   │   └── pages/                  # Admin/, AssetPages/, AuthPages/, Dashboard/, WarningPages/
│   ├── Dockerfile  nginx.conf  vite.config.ts  package.json
│   └── .env                        # VITE_GOOGLE_CLIENT_ID, VITE_API_URL
└── k8s/
    ├── ingress.yaml
    ├── secrets.yaml
    ├── service/                    # Deployment + Service di ogni microservizio e del frontend
    └── storage/                    # PostgreSQL, MongoDB, MinIO, RabbitMQ, init job e ConfigMap
```

**Rami**

| Ramo | Contenuto |
|---|---|
| `master` | Backend, Web App, manifest Kubernetes, pipeline (su GitHub). |
| `feature/mobile-app-conversion` | Conversione in app Android (Capacitor) e APK installabile; disponibile sul repository ospitato sulla VM di gestione `192.168.72.110`. |

---

## 7. Microservizi in dettaglio

Tutti i servizi sono applicazioni **Flask** containerizzate (porta `5000`), espongono `GET /health` per le probe di Kubernetes e pubblicano eventi di audit sull'exchange `system_events`.

### 7.1 API Gateway (`api-gateway-service`)
- Unico punto di ingresso: instrada `/api/<servizio>/<path>` verso `auth`, `geozone`, `asset`, `warning`, `log`, `media` (URL configurabili con variabili `*_SERVICE_URL`).
- Decodifica il JWT (HS256, `JWT_SECRET`) e, se valido, inietta gli header `X-User-Id`, `X-User-Role`, `X-User-Email`, `X-Campus-Ids` per i servizi a valle.
- Gestisce CORS, inoltra metodi `GET/POST/PUT/PATCH/DELETE/OPTIONS`, timeout 60 s, risponde `502` se il servizio a valle non è raggiungibile.
- Esempio: `GET /api/asset/api/assets` → `asset-service:5000/api/assets`.

### 7.2 Auth Service (`auth-service`)
- `POST /auth/google` – verifica l'ID token Google. Per un utente nuovo genera segreto TOTP e token temporaneo (`is_new_user`), per un utente esistente restituisce il token temporaneo per il secondo fattore.
- `POST /auth/2fa/verify` – valida il codice TOTP (`temp_token` + `totp_code`) e restituisce il **JWT definitivo** con ruolo, `campus_ids` e categoria.
- `POST/GET /admin/operators`, `PUT /admin/operators/<uuid>` – creazione, elenco e aggiornamento dei profili Operatore (e-mail già presente → `409`).
- `GET /me` – profilo dell'utente corrente.
- Consuma gli eventi su `auth_service_queue`.

### 7.3 GeoZone Service (`geozone-service`)
- `POST/GET /api/geozones/campuses`, `GET/PUT/DELETE /api/geozones/campuses/<id>` – gestione dei campus (poligono `GEOMETRY(Polygon, 4326)`, indice GiST).
- `POST /api/geozones/verify-location` – verifica con PostGIS se `latitudine`/`longitudine` ricadono nel campus indicato (`campusId`); usata dagli altri servizi.

### 7.4 Asset Service (`asset-service`)
- **Categorie:** `POST/GET /api/categories`, `GET/PUT/DELETE /api/categories/<id>`, `POST /api/categories/<id>/attributes`, `PUT /api/categories/<id>/attributes/<nome>`.
- **Asset:** `POST/GET /api/assets`, `GET/PUT/DELETE /api/assets/<id>`, `GET /api/assets/<id>/history`, `GET /api/assets/export`.
- Validazione dei metadati contro gli attributi della categoria (tipo, obbligatorietà, opzioni del menu).
- Ricerca con filtro territoriale, filtro per categoria e filtri dinamici sugli attributi, con paginazione e risposta GeoJSON per la mappa.
- Ad ogni modifica scrive uno snapshot in `asset_history`; consuma eventi su `asset_service_queue` (es. sincronizzazione della cache dei campus).

### 7.5 Media Service (`media-service`)
- `POST /images/upload` – upload multipart (campo `images`, una o più immagini), validazione, compressione con Pillow, salvataggio su MinIO e metadati su PostgreSQL.
- `GET /images/<id>` – recupero dell'immagine; `DELETE /images/<id>` – rimozione.
- `POST /images/<id>/analyze` – scarica l'immagine da MinIO, invoca **Google Cloud Vision** e converte le etichette in suggerimenti strutturati per i metadati.
- Il bucket è creato automaticamente all'avvio (`MEDIA_BUCKET`). Se Cloud Vision non risponde, l'analisi degrada in modalità fallback (nessun suggerimento) senza bloccare il censimento.

### 7.6 Warning Service (`warning-service`)
- `POST /warnings` – crea una segnalazione collegata a un asset.
- `GET /warnings` – elenco con filtro territoriale automatico.
- `PATCH /warnings/<id>/resolve` – chiude la segnalazione con nota di intervento.
- `POST /maintenances` – registra una manutenzione (preventiva o correttiva) riservata agli Operatori, anche senza segnalazione.
- Stati: `aperta`, `chiusa`, `annullata`. Mantiene `LocalAssetCache` aggiornata consumando eventi su `warning_service_queue`.

### 7.7 Log Service (`log-service`)
- Consumer persistente (`audit_log_persistent_queue`) di tutti gli eventi di sistema, con ack/nack manuale (requeue sugli errori temporanei del database).
- `GET /api/logs` (paginato e filtrabile), `GET /api/logs/<id>`, `GET /api/logs/export` (CSV).
- `GET /api/dashboard/metrics` e `GET /api/dashboard/charts` – KPI e dati per i grafici.

---

## 8. Frontend (Web App e App Mobile)

Applicazione **React 19 + TypeScript** costruita con **Vite**, basata sul template TailAdmin e servita in produzione da **Nginx** (build multi-stage `node:18-alpine` → `nginx:alpine`, con fallback a `index.html` per il routing SPA).

### Routing e controllo accessi (`src/App.tsx`)

| Percorso | Ruoli ammessi | Pagina |
|---|---|---|
| `/signin` | pubblico | Login Google + 2FA |
| `/map` | utenti autenticati | Mappa interattiva (`CampusMap`) |
| `/dashboard` | Amministratore | Dashboard KPI |
| `/admin/operators` | Amministratore | Gestione Operatori |
| `/admin/categories`, `/admin/categories/new`, `/admin/categories/:id` | Amministratore | Gestione categorie e attributi |
| `/admin/campuses`, `/admin/campus/new` | Amministratore | Elenco e registrazione campus |
| `/admin/history` | Amministratore | Storico operazioni (audit) |
| `/assets/new` | Operatore | Censimento nuovo asset (foto, GPS, suggerimenti AI) |
| `/operator/tickets` | Operatore | Gestione segnalazioni |
| `/assets/list` | Amministratore, Operatore | Elenco asset filtrabile |

L'accesso è protetto da `ProtectedRoute` in base al ruolo contenuto nel JWT; lo stato di autenticazione è gestito da `AuthContext`.

### App mobile Android
- La stessa base di codice è convertita in app nativa con **Capacitor** (`@capacitor/core`, `@capacitor/camera`); la pagina di censimento (`CreateAsset`) usa la fotocamera nativa.
- Il progetto Android e l'APK sono nel ramo `feature/mobile-app-conversion` (`frontend/android/app-release/app-debug.apk`).

### Variabili di configurazione (`frontend/.env`)

| Variabile | Descrizione |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth 2.0 di Google |
| `VITE_API_URL` | URL base dell'API Gateway |

---

## 9. Modello dei dati

**Auth Service (PostgreSQL, 3NF):** `role`, `app_user` (e-mail, `google_id`, segreto TOTP, `is_active`, timestamp), `user_campus`, `user_category` (soft link a campus e categorie). Ruoli: `GUEST`, `OPERATORE`, `AMMINISTRATORE`.

**GeoZone Service (PostgreSQL + PostGIS):** tabella `campus` con `name` univoco, `description`, `geom` `GEOMETRY(Polygon, 4326)` e indice **GiST**.

**Asset Service (MongoDB):** collezioni `categories` (nome e array di attributi con tipo, `is_filter`, stato), `campus_cache`, `assets` (categoria, campus, geometria GeoJSON con indice `2dsphere`, oggetto `metadata` dinamico) e `asset_history` (snapshot immutabili con operatore e timestamp).

**Warning Service (PostgreSQL):** `warning` (ENUM di stato), `maintenance_intervention` (append-only, ENUM `preventiva`/`correttiva`, `warning_id` nullable) e `local_asset_cache`.

**Log Service (PostgreSQL):** tabella `audit_log` con `service_name`, `action`, `actor_id`, `entity_id`, `payload` **JSONB** e `created_at`; nessun aggiornamento previsto sui record.

**Media Service (MinIO + PostgreSQL):** bucket S3 per i binari e tabella `media_metadata` (nome originale, MIME type, dimensione, bucket, `object_key`).

I database PostgreSQL logici (auth, geozone, warning, log, media) sono creati dal job `db-schema-init` (`k8s/storage/postgres-init-job.yaml`, `postgres-configmap.yaml`).

---

## 10. Comunicazione asincrona (RabbitMQ)

Tutti i servizi usano `shared_utils/messaging.py` (`RabbitMQManager`):

- **Exchange:** `system_events`, di tipo **fanout** e durevole.
- **Pubblicazione:** messaggi persistenti (`delivery_mode=2`) con payload standard: `timestamp` (ISO 8601 UTC), `autore_id`, `entity_id` (ricavato da asset/campus/media/categoria/segnalazione/manutenzione), `azione`, `service_name`, più dati specifici dell'evento.
- **Consumo:** code dedicate e durevoli per servizio.
- **Resilienza:** connessione con retry ogni 5 secondi finché il broker non è pronto.

| Coda | Consumer | Scopo |
|---|---|---|
| `audit_log_persistent_queue` | Log Service | Storicizzazione immutabile degli eventi |
| `asset_service_queue` | Asset Service | Sincronizzazione della cache dei campus (`CAMPUS_CREATED`/`CAMPUS_UPDATED`) e pulizia degli asset alla rimozione di un campus |
| `warning_service_queue` | Warning Service | Aggiornamento della cache asset→campus (`ASSET_CREATED`/`ASSET_UPDATED`) |
| `auth_service_queue` | Auth Service | Alla creazione di un campus (`CAMPUS_CREATED`) lo associa all'Amministratore che lo ha creato |

L'interfaccia di management di RabbitMQ è esposta dall'Ingress su `rabbitmq.192.168.72.109.nip.io`.

---

## 11. Infrastruttura e deployment su Kubernetes

Deployment **On-Premise** su due macchine virtuali (pattern *Two-Tier Hybrid Node*: gestione separata dall'esecuzione), raggiungibili dalla rete di campus o via **OpenVPN**.

| Risorsa | Valore |
|---|---|
| vCPU / RAM / Disco | 4 / 16 GB / 48 GB per VM |
| Sistema operativo | Ubuntu Server 24.04 LTS |

| Nodo | IP | Ruolo |
|---|---|---|
| **Gestione** | `192.168.72.110` | Jenkins Controller, Git client, Kubeconfig come Secret |
| **Esecuzione** | `192.168.72.109` | Cluster K3s, API Server (`6443`), Ingress, microservizi, agenti Jenkins effimeri, Docker |

Flussi: deployment `110 → 109` (HTTPS `6443`, mTLS via Kubeconfig); tunnel agenti JNLP `109 → 110` (TCP `50000`); webhook GitHub → `110` (porta `8080`); pull immagini da Docker Hub.

### Workload (cartella `k8s/`)

| Componente | Repliche | Immagine | Esposizione |
|---|---|---|---|
| Frontend | 2 | `claudia179/urban-frontend` | NodePort **32080** |
| API Gateway | 2 | `claudia179/api-gateway-service-img` | NodePort **32050**, Ingress `/api` |
| Auth Service | 2 | `claudia179/auth-service-img` | interno |
| Asset Service | 2 | `claudia179/asset-service-img` | interno |
| GeoZone / Log / Media / Warning | 1 ciascuno | `claudia179/<servizio>-img` | interno |
| PostgreSQL | 1 (PVC 5 Gi) | `postgis/postgis:15-3.4-alpine` | interno |
| MongoDB | 1 | `mongo:4.4` | interno |
| MinIO | 1 | `minio/minio` | interno |
| RabbitMQ | 1 | `rabbitmq:3-management` | Ingress (UI di management) |

**Ingress** (`k8s/ingress.yaml`, classe `nginx`, `proxy-body-size: 50m` per gli upload):
- `192.168.72.109.nip.io/api` → API Gateway (porta 5000)
- `rabbitmq.192.168.72.109.nip.io/` → RabbitMQ Management (porta 15672)

### Deployment manuale
```bash
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/storage/            # PostgreSQL, MongoDB, MinIO, RabbitMQ, ConfigMap
kubectl apply -f k8s/ingress.yaml
kubectl delete job db-schema-init --ignore-not-found=true
kubectl apply -f k8s/storage/postgres-init-job.yaml
kubectl wait --for=condition=complete --timeout=120s job/db-schema-init
kubectl apply -f k8s/service/            # microservizi e frontend
kubectl get pods
```

---

## 12. Pipeline CI/CD (Jenkins)

La pipeline è definita nel **`Jenkinsfile`** (Jenkins Controller sulla VM `192.168.72.110`, trigger da webhook GitHub, credenziali `dockerhub-id` e `k8s-secret`).

```
git push ─► GitHub ─webhook─► Jenkins
                                │
   1. Inizializzazione
   2. Setup infrastruttura dati e broker (secrets, MongoDB, MinIO, RabbitMQ,
      PostgreSQL, ConfigMap, Ingress, job di init degli schemi)
   3. Ciclo di vita dei microservizi (stage in parallelo, solo se cambiano
      i file della relativa cartella – `when { changeset ... }`)
        per ogni servizio:  Test unitari → Build immagine → Integration test
                            → Push su Docker Hub → Deploy su K8s
   4. Frontend Web: build immagine → push → deploy
   5. System Verification
```

Dettagli:
- **Esecuzione selettiva:** ogni servizio viene ricostruito e rilasciato solo se il suo codice è cambiato.
- **Test unitari** in container effimeri con il database reale (`postgres:15`, `postgis/postgis:15-3.3`, `mongo:4.4`), tramite Pytest.
- **Integration test:** l'immagine appena costruita è avviata con il proprio database effimero, poi si eseguono le collection **Postman** con **Newman** (Gateway: verifica dell'endpoint di health).
- **Push:** immagine taggata con `BUILD_NUMBER` e con `latest` su Docker Hub.
- **Deploy:** `kubectl apply` del manifest, `kubectl set image` e `kubectl rollout status` → **rolling update senza downtime**.
- Se i test falliscono la pipeline si arresta e non avviene alcun rilascio.

---

## 13. Accesso al sistema in produzione

Il sistema è già operativo sulla macchina di dipartimento.

> 🔐 **Prerequisito:** connessione **OpenVPN** attiva.

### 13.1 Dashboard Web – Amministratore

| | |
|---|---|
| **URL** | http://192.168.72.109.nip.io:32080/signin |
| **Account Google** | `asset.management.unisa@gmail.com` |
| **2FA** | Microsoft Authenticator (chiave TOTP comunicata separatamente) |

**Configurazione del secondo fattore**
1. Apri l'app **Microsoft Authenticator**.
2. **Aggiungi account** → **Altro account** → **Inserimento manuale**.
3. Incolla la chiave di configurazione TOTP fornita via e-mail (`<CHIAVE_TOTP>`).
4. Inserisci il codice a 6 cifre generato quando richiesto dopo il login Google.

> ℹ️ La chiave TOTP non è riportata in questo README per motivi di sicurezza.

### 13.2 Dashboard Web – Guest
Accedi con **qualsiasi account Google standard**: il profilo Utente Base viene creato automaticamente al primo accesso. Consente di consultare la mappa e inviare segnalazioni.

### 13.3 App Mobile – Operatore
1. Dalla dashboard Amministratore (`/admin/operators`) crea un **profilo Operatore** (e-mail, campus e categoria assegnati).
2. Installa l'APK ([sezione 15](#15-installazione-dellapp-mobile)).
3. Accedi con l'account Google dell'e-mail registrata e completa la 2FA.

### Endpoint utili
| Servizio | Indirizzo |
|---|---|
| Web App | `http://192.168.72.109.nip.io:32080` |
| API (via Ingress) | `http://192.168.72.109.nip.io/api/...` |
| API Gateway (NodePort) | `http://192.168.72.109:32050` |
| RabbitMQ Management | `http://rabbitmq.192.168.72.109.nip.io` |

---

## 14. Guida rapida ai test funzionali

| # | Attore | Azione | Esito atteso |
|---|---|---|---|
| 1 | Amministratore | Login Google + 2FA | Accesso alla dashboard |
| 2 | Amministratore | Registra un nuovo campus (`/admin/campus/new`) | Anteprima del perimetro e salvataggio |
| 3 | Amministratore | Crea una categoria (es. *Palo della luce*, *Albero*) con attributi di tipi diversi | Categoria subito disponibile nei menu |
| 4 | Amministratore | Crea un profilo Operatore con campus e categoria | Profilo registrato |
| 5 | Operatore | Login sull'app mobile, concede GPS e fotocamera | Mappa centrata sul campus |
| 6 | Operatore | Censisce un asset: categoria → GPS → foto → suggerimenti AI → validazione | Asset salvato e visibile in mappa |
| 7 | Guest | Seleziona un asset sulla mappa e invia una segnalazione | Conferma di invio |
| 8 | Operatore | Apre le segnalazioni, interviene, aggiunge nota e chiude | Segnalazione rimossa dalle attive |
| 9 | Operatore | Modifica gli attributi di un asset | Nuova voce nello storico |
| 10 | Amministratore | Imposta un attributo su "Unavailable" | Nascosto nei form, visibile nello storico |
| 11 | Amministratore | Consulta dashboard e storico, esporta il CSV | KPI corretti, file CSV filtrato |

**Casi limite:** login Google annullato; codice 2FA errato/scaduto; segnalazione con nota vuota; permessi GPS/fotocamera negati; servizio AI non raggiungibile (form vuoto); Operatore senza campus (nessun dato); accesso a risorse di un altro campus (`403`); e-mail Operatore già presente (`409`).

---

## 15. Installazione dell'app mobile

APK nel ramo **`feature/mobile-app-conversion`**:

```
frontend/android/app-release/app-debug.apk
```

Il ramo è disponibile sul repository ospitato dalla VM `192.168.72.110`.

```bash
git checkout feature/mobile-app-conversion
adb install frontend/android/app-release/app-debug.apk
```

In alternativa trasferire il file sullo smartphone e aprirlo, abilitando l'installazione da origini sconosciute.

**Requisiti:** Android con GPS e fotocamera, rete di campus o VPN, app Microsoft Authenticator.

---

## 16. Riferimento API

Le richieste dei client passano dal Gateway con il formato **`/api/<servizio>/<percorso-del-servizio>`** e l'header `Authorization: Bearer <JWT>`. Esempi:

```
POST /api/auth/auth/google                    → auth-service  /auth/google
GET  /api/asset/api/assets?campus_id=<uuid>   → asset-service /api/assets
POST /api/warning/warnings                    → warning-service /warnings
GET  /api/log/api/dashboard/metrics           → log-service /api/dashboard/metrics
```

| Servizio | Metodo | Percorso (lato servizio) | Descrizione |
|---|---|---|---|
| Auth | POST | `/auth/google` | Verifica ID token Google, restituisce il token temporaneo |
| Auth | POST | `/auth/2fa/verify` | Verifica TOTP e restituisce il JWT definitivo |
| Auth | GET / POST | `/admin/operators` | Elenco / creazione Operatori |
| Auth | PUT | `/admin/operators/<uuid>` | Aggiornamento di un Operatore |
| Auth | GET | `/me` | Profilo corrente |
| GeoZone | GET / POST | `/api/geozones/campuses` | Elenco / creazione campus |
| GeoZone | GET / PUT / DELETE | `/api/geozones/campuses/<id>` | Dettaglio / modifica / eliminazione |
| GeoZone | POST | `/api/geozones/verify-location` | Verifica se una coordinata ricade nel campus |
| Asset | GET / POST | `/api/categories` | Elenco / creazione categorie |
| Asset | GET / PUT / DELETE | `/api/categories/<id>` | Gestione categoria |
| Asset | POST | `/api/categories/<id>/attributes` | Aggiunta attributo |
| Asset | PUT | `/api/categories/<id>/attributes/<nome>` | Modifica / deprecazione attributo |
| Asset | GET / POST | `/api/assets` | Ricerca (filtri dinamici, GeoJSON) / creazione asset |
| Asset | GET / PUT / DELETE | `/api/assets/<id>` | Gestione asset |
| Asset | GET | `/api/assets/<id>/history` | Storico dell'asset |
| Asset | GET | `/api/assets/export` | Esportazione asset |
| Media | POST | `/images/upload` | Upload immagini (multipart, campo `images`) |
| Media | GET / DELETE | `/images/<id>` | Recupero / rimozione immagine |
| Media | POST | `/images/<id>/analyze` | Analisi Computer Vision e suggerimenti |
| Warning | GET / POST | `/warnings` | Elenco / creazione segnalazioni |
| Warning | PATCH | `/warnings/<id>/resolve` | Chiusura con nota di intervento |
| Warning | POST | `/maintenances` | Registrazione manutenzione (Operatori) |
| Log | GET | `/api/logs`, `/api/logs/<id>` | Storico paginato / dettaglio |
| Log | GET | `/api/logs/export` | Esportazione CSV |
| Log | GET | `/api/dashboard/metrics`, `/api/dashboard/charts` | KPI e dati dei grafici |
| Tutti | GET | `/health` | Liveness/readiness probe |

**Convenzioni:** payload JSON, codici HTTP semantici (`400` validazione, `401` non autenticato, `403` fuori perimetro, `404`, `409` conflitto, `413/415` upload, `503` servizio AI non disponibile), timestamp ISO 8601, coordinate WGS 84 (EPSG:4326), geometrie GeoJSON.

Ogni servizio dispone anche di una **collection Postman** in `<servizio>/tests/*_collection.json`, importabile per provare le API.

---

## 17. Attributi di qualità e tattiche architetturali

Architettura guidata dalla metodologia **Attribute-Driven Design (ADD)** con scenari di qualità misurabili.

| Attributo | Obiettivo | Tattiche principali |
|---|---|---|
| **Disponibilità** | Continuità operativa (target 99.9%) | Health check/heartbeat, Exception Detection, Active Redundancy (repliche di Gateway, Auth, Asset e Frontend), Reconfiguration, Retry con backoff, Graceful Degradation, Removal from Service, Circuit Breaker sull'AI |
| **Modificabilità** | Estendere il dominio a runtime senza modificare il codice | Split Module, Encapsulate, Restrict Dependencies (Database-per-Service), Use an Intermediary (RabbitMQ), parametrizzazione a runtime |
| **Usabilità** | Segnalazione in < 2 min e ≤ 4 click | Maintain System/Task Model, Cancel/Undo, MVVM, programmazione asincrona |
| **Sicurezza** | Isolamento multi-campus | Authenticate/Authorize Actors (JWT + RBAC), Validate Input, Encrypt Data, Audit immutabile |
| **Performance** | Mappa con > 5.000 asset in < 3 s | Concurrency, Manage Event Rate (eventi asincroni), Prioritize Events, scaling orizzontale, paginazione e risposte GeoJSON |
| **Testabilità** | Test unitari rapidi e isolati (> 85% di coverage sul modulo di validazione) | Sandbox effimera, Abstract Data Sources (mocking), Executable Assertions, Dependency Injection (`DATABASE_URL`) |
| **Integrabilità** | Export standard e interoperabile | Service Discovery K8s, Use an Intermediary, Orchestrate, esportazione CSV UTF-8 |

---

## 18. Testing

Ogni servizio ha la cartella `tests/` con:

| Servizio | Test unitari (`test_unit.py`) |
|---|---|
| api-gateway-service | 5 |
| auth-service | 9 |
| asset-service | 18 |
| geozone-service | 20 |
| log-service | 11 |
| media-service | 7 |
| warning-service | 8 |
| **Totale** | **78** |

Inoltre: **collection Postman** (`*_collection.json`) eseguite con **Newman** nell'integration test della pipeline, e script `setup_tests.sh` (Auth e Media) che popolano i dati di test nei container effimeri.

I test usano `mongomock`/`pytest-mock` e database effimeri; la stringa di connessione è iniettata con `DATABASE_URL`, quindi puntabile a un'istanza sandbox (Dependency Injection).

```bash
cd auth-service            # o un altro servizio
pip install -r requirements.txt
PYTHONPATH=.:.. pytest tests/test_unit.py -p no:cacheprovider
```

Alcuni test richiedono un database raggiungibile con l'`DATABASE_URL` opportuna (vedi [sezione 19](#19-sviluppo-locale)).

---

## 19. Sviluppo locale

### Prerequisiti
- Docker; Python 3.9+; Node.js 18+ (consigliato 20+) e npm
- Un'istanza (o container) di PostgreSQL/PostGIS, MongoDB, MinIO e RabbitMQ
- Credenziali Google OAuth (Client ID) e, per i suggerimenti AI, credenziali Google Cloud Vision

### Variabili d'ambiente dei servizi

| Variabile | Usata da | Descrizione |
|---|---|---|
| `DATABASE_URL` | Auth, GeoZone, Warning, Log, Media (PostgreSQL), Asset (MongoDB) | Stringa di connessione |
| `JWT_SECRET` | Gateway, Auth | Chiave di firma dei JWT |
| `RABBITMQ_URL` | tutti | Default `amqp://guest:guest@rabbitmq-service:5672/` |
| `GOOGLE_CLIENT_ID` | Auth | Client ID OAuth |
| `TOTP_ISSUER_NAME` | Auth | Nome mostrato in Authenticator (default `Campus_Management`) |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MEDIA_BUCKET` | Media | Object storage |
| `AUTH_SERVICE_URL`, `GEOZONE_SERVICE_URL`, `ASSET_SERVICE_URL`, `WARNING_SERVICE_URL`, `LOG_SERVICE_URL`, `MEDIA_SERVICE_URL` | Gateway | URL interni dei servizi |

### Backend – singolo servizio
```bash
git clone https://github.com/aaaaaaurora/Platform-Asset-Management.git
cd Platform-Asset-Management

# Esempio: Asset Service in container
cd asset-service
cp -r ../shared_utils .          # come fa la pipeline: shared_utils va copiata nel contesto di build
docker build -t asset-service .
docker run -p 5000:5000 \
  -e DATABASE_URL="mongodb://<user>:<pass>@<host>:27017/asset_db?authSource=admin" \
  -e RABBITMQ_URL="amqp://<user>:<pass>@<host>:5672/" \
  asset-service
```
I Dockerfile copiano `shared_utils/` dentro l'immagine (`COPY shared_utils /app/shared_utils`): prima del build la cartella va quindi copiata nella directory del servizio, esattamente come fa il `Jenkinsfile` (`rm -rf shared_utils && cp -r ../shared_utils .`). La cartella copiata non va versionata.

### Frontend
```bash
cd frontend
npm install --legacy-peer-deps
# imposta VITE_GOOGLE_CLIENT_ID e VITE_API_URL in .env
npm run dev        # server di sviluppo Vite
npm run build      # build di produzione (tsc -b && vite build)
npm run lint
```

### Ambiente completo su Kubernetes
Vedi [sezione 11](#deployment-manuale).

---

## 20. Configurazione e gestione dei segreti

- I parametri sensibili (chiave JWT, password dei database, credenziali MinIO e RabbitMQ, stringhe di connessione) sono definiti nel Secret Kubernetes `app-secrets` (`k8s/secrets.yaml`) e letti dai Deployment tramite `secretKeyRef`.
- I file di configurazione presenti nel repository (`k8s/secrets.yaml`, `frontend/.env`, `auth-service/client_secret.json`) sono pensati per l'**ambiente dimostrativo** di dipartimento.
- **Per qualsiasi uso reale** occorre: sostituire tutti i valori, ruotare le credenziali, non versionare i segreti (secret manager o *Sealed Secrets*) e non affidarsi ai valori di *fallback* presenti nel codice (`JWT_SECRET`, credenziali MinIO e RabbitMQ di default).
- La chiave TOTP dell'account amministratore e i token di accesso al repository non vanno mai inseriti nel codice o nella documentazione.

---

## 21. Documentazione di progetto e scostamenti dal design

| Documento | Contenuto |
|---|---|
| **Tesi** | Descrizione complessiva del lavoro |
| **SRS** – Software Requirements Specification | 7 Epiche e User Stories con criteri di accettazione, flussi BPMN, casi d'uso, attributi di qualità, vincoli |
| **SDA** – Software Design Architecture | Vista logica (C4, interfacce), vista dei dati, deployment, tattiche di qualità, pipeline CI/CD |

**Vincoli di progetto (SRS):** microservizi con API REST/HTTPS, segregazione dei dati per campus, approccio API-First, due client distinti (mobile e web), backend Python, frontend React, MapLibre GL JS, RabbitMQ, Docker + Kubernetes, Git, CI/CD con testing automatico, Kanban su ClickUp.

**Dove l'implementazione si discosta dalla documentazione di progetto**

| Tema | SDA | Implementazione nel repository |
|---|---|---|
| API Gateway | Gateway con API Composition e `correlation_id` | Gateway Flask che valida il JWT, propaga gli header `X-User-*` e fa da reverse proxy |
| Exchange RabbitMQ | `system.events` | Exchange `system_events` di tipo fanout |
| Endpoint | Percorsi indicativi (`/logs/history`, `/geozones`, `/warnings/{id}/resolve`…) | Percorsi effettivi nella [sezione 16](#16-riferimento-api) (es. `/api/logs`, `/api/geozones/campuses`) |
| Stati segnalazione | `aperta`, `chiusa` | Presente anche `annullata` |
| Frontend | React | React con TypeScript, base TailAdmin |

---

## 22. Note e limitazioni

- L'addestramento dei modelli di Computer Vision è **fuori dallo scopo**: l'AI è un servizio esterno.
- L'APK fornito è una build **debug** a scopo dimostrativo.
- L'accesso al sistema in produzione richiede la VPN del dipartimento.
- L'app mobile è destinata **solo agli Operatori** per il censimento; la Web App serve Amministratori, Utenti Base e Operatori (per le modifiche).
- Ambiente dimensionato per la sperimentazione (2 VM); i servizi sono progettati per scalare orizzontalmente.

---

## 23. Licenza e contatti

Progetto accademico sviluppato presso il **Dipartimento di Ingegneria dell'Informazione ed Elettrica e Matematica Applicata (DIEM) – Università degli Studi di Salerno**.

La parte di interfaccia basata su **TailAdmin React** è distribuita con licenza MIT (`frontend/LICENSE.md`).

| | |
|---|---|
| **Aurora Campione** | a.campione5@studenti.unisa.it |
| **Claudia Carucci** | – |
