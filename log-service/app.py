import os
import json
import logging
import threading
import time
from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import func, case, or_
from sqlalchemy.exc import SQLAlchemyError
from marshmallow import Schema, fields, INCLUDE, ValidationError
import csv
import io
from flask import Response
import dateutil.parser
from flask_socketio import SocketIO

# Importiamo il gestore centralizzato per RabbitMQ (dalla cartella condivisa)
from shared_utils.messaging import RabbitMQManager

# ============================================================================
# 1. CONFIGURAZIONE E SETUP
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('log-service')

app = Flask(__name__)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5433/log_db')
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

db = SQLAlchemy(app)
mq_manager = RabbitMQManager()


# ============================================================================
# 2. UTILITY FUNCTIONS E MIDDLEWARE
# ============================================================================

def get_auth_context():
    campuses_header = request.headers.get('X-Campus-Ids', '')
    campus_ids = [c.strip() for c in campuses_header.split(',')] if campuses_header else []
    
    return {
        'user_id': request.headers.get('X-User-Id'),
        'role': request.headers.get('X-User-Role'),
        'campus_ids': campus_ids
    }

def error_response(message, status_code):
    return jsonify({"error": message}), status_code


# ============================================================================
# 3. MODELLI DATABASE (Append-Only)
# ============================================================================

class AuditLog(db.Model):
    __tablename__ = 'audit_log'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=db.text('gen_random_uuid()'))
    correlation_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    service_name = db.Column(db.String(50), nullable=False, index=True)
    action = db.Column(db.String(100), nullable=False, index=True)
    actor_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    entity_id = db.Column(db.String(100), nullable=True, index=True) 
    payload = db.Column(JSONB, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), index=True)

    def to_dict(self):
        return {
            "id": str(self.id),
            "correlation_id": str(self.correlation_id) if self.correlation_id else None,
            "service_name": self.service_name,
            "action": self.action,
            "actor_id": str(self.actor_id) if self.actor_id else None,
            "entity_id": str(self.entity_id) if self.entity_id else None,
            "payload": self.payload,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


# ============================================================================
# 4. DTO (Data Transfer Objects)
# ============================================================================

class EventPayloadSchema(Schema):
    class Meta:
        unknown = INCLUDE

    service_name = fields.String(required=True)
    azione = fields.String(required=True)
    autore_id = fields.UUID(allow_none=True, load_default=None)
    correlation_id = fields.UUID(allow_none=True, load_default=None)
    entity_id = fields.String(allow_none=True, load_default=None) 
    timestamp = fields.String(allow_none=True)


# ============================================================================
# 5. REPOSITORY LAYER
# ============================================================================

class AuditLogRepository:
    
    @staticmethod
    def insert(log_entry: AuditLog) -> AuditLog:
        try:
            db.session.add(log_entry)
            db.session.commit()
            return log_entry
        except SQLAlchemyError as e:
            db.session.rollback()
            logger.error(f"Errore DB durante l'inserimento: {str(e)}")
            raise e

    @staticmethod
    def _build_filter_query(filters: dict):
        query = db.session.query(AuditLog)

        # 1. Filtro globale: Escludi sempre i log dei media
        query = query.filter(AuditLog.service_name != 'media-service')

        if filters.get('service_name'):
            query = query.filter(AuditLog.service_name == filters['service_name'])
        if filters.get('action'):
            query = query.filter(AuditLog.action.ilike(f"%{filters['action']}%"))
        if filters.get('actor_id'):
            query = query.filter(AuditLog.actor_id == filters['actor_id'])
        if filters.get('entity_id'):
            query = query.filter(AuditLog.entity_id == filters['entity_id'])
        if filters.get('start_date'):
            query = query.filter(AuditLog.created_at >= filters['start_date'])
        if filters.get('end_date'):
            query = query.filter(AuditLog.created_at <= filters['end_date'])

        log_type = filters.get('log_type')

        if log_type == 'system':
            # Log di sistema: solo auth-service, nessun filtro campus/categoria applicato
            query = query.filter(AuditLog.service_name == 'auth-service')
        elif log_type == 'business':
            # Log operativi: escludi auth-service, applica filtri territoriali/categoria
            query = query.filter(AuditLog.service_name != 'auth-service')
            
            campus_ids = filters.get('campus_ids')
            if campus_ids:
                query = query.filter(
                    or_(
                        AuditLog.payload['campus_id'].astext.in_(campus_ids),
                        AuditLog.payload['campus_id'].astext == None
                    )
                )
                
            category_ids = filters.get('category_ids')
            if category_ids:
                query = query.filter(AuditLog.payload['category_id'].astext.in_(category_ids))
        else:
            # Comportamento di default
            campus_ids = filters.get('campus_ids')
            if campus_ids:
                query = query.filter(
                    or_(
                        AuditLog.payload['campus_id'].astext.in_(campus_ids),
                        AuditLog.payload['campus_id'].astext == None
                    )
                )
                
            category_ids = filters.get('category_ids')
            if category_ids:
                query = query.filter(AuditLog.payload['category_id'].astext.in_(category_ids))

        return query.order_by(AuditLog.created_at.desc())

    @staticmethod
    def get_logs(filters: dict, page: int = 1, per_page: int = 50):
        query = AuditLogRepository._build_filter_query(filters)
        return query.paginate(page=page, per_page=per_page, error_out=False)

    @staticmethod
    def get_all_logs(filters: dict):
        query = AuditLogRepository._build_filter_query(filters)
        return query.all()
 
    @staticmethod
    def find_by_id(log_id: str) -> AuditLog:
        return db.session.query(AuditLog).filter(AuditLog.id == log_id).first()

    @staticmethod
    def get_dashboard_metrics(filters: dict) -> dict:
        def apply_base_filters(query, apply_category=True):
            query = query.filter(AuditLog.service_name != 'media-service')
            if filters.get('start_date'):
                query = query.filter(AuditLog.created_at >= filters['start_date'])
            if filters.get('end_date'):
                query = query.filter(AuditLog.created_at <= filters['end_date'])
            if filters.get('campus_ids'):
                query = query.filter(AuditLog.payload['campus_id'].astext.in_(filters['campus_ids']))
            if apply_category and filters.get('category_ids'):
                query = query.filter(AuditLog.payload['category_id'].astext.in_(filters['category_ids']))
            return query

        # Conteggio Asset (con filtro categoria applicato)
        asset_query = apply_base_filters(db.session.query(AuditLog), apply_category=True)
        created_assets = asset_query.filter(AuditLog.action == 'ASSET_CREATED').count()
        deleted_assets = asset_query.filter(AuditLog.action == 'ASSET_DELETED').count()
        assets_count = max(0, created_assets - deleted_assets)
        
        # Conteggio Segnalazioni (filtro categoria IGNORATO per evitare il bug del ritorno a 0)
        warning_query = apply_base_filters(db.session.query(AuditLog), apply_category=False)
        created_warnings = warning_query.filter(AuditLog.action == 'CREATE_WARNING').count()
        resolved_warnings = warning_query.filter(AuditLog.action == 'RESOLVE_WARNING').count()
        tickets_count = max(0, created_warnings - resolved_warnings) 
        interventions_count = resolved_warnings 

        net_asset_calc = func.sum(
            case(
                (AuditLog.action == 'ASSET_CREATED', 1),
                (AuditLog.action == 'ASSET_DELETED', -1),
                else_=0
            )
        )

        category_label = func.coalesce(AuditLog.payload['category_name'].astext, AuditLog.payload['category_id'].astext).label('category_label')
        category_query = db.session.query(category_label, net_asset_calc).filter(
            AuditLog.action.in_(['ASSET_CREATED', 'ASSET_DELETED'])
        )
        category_query = apply_base_filters(category_query, apply_category=True)
        category_dist_results = category_query.group_by('category_label').having(net_asset_calc > 0).all()
        
        campus_label = func.coalesce(AuditLog.payload['campus_name'].astext, AuditLog.payload['campus_id'].astext).label('campus_label')
        campus_query = db.session.query(campus_label, net_asset_calc).filter(
            AuditLog.action.in_(['ASSET_CREATED', 'ASSET_DELETED'])
        )
        campus_query = apply_base_filters(campus_query, apply_category=True)
        campus_dist_results = campus_query.group_by('campus_label').having(net_asset_calc > 0).all()

        return {
            "totals": {
                "assets": assets_count,
                "tickets": tickets_count,
                "interventions": interventions_count,
            },
            "distributions": {
                "by_category": {row[0]: row[1] for row in category_dist_results if row[0]},
                "by_campus": {row[0]: row[1] for row in campus_dist_results if row[0]}
            }
        }
    
    @staticmethod
    def get_dashboard_charts(filters: dict) -> dict:
        # Modificato per contare ESCLUSIVAMENTE gli ASSET_CREATED senza sottrarre gli eliminati
        time_series_query = db.session.query(
            func.date_trunc('day', AuditLog.created_at).label('creation_day'),
            func.count().label('count')
        ).filter(AuditLog.action == 'ASSET_CREATED')
        
        time_series_query = time_series_query.filter(AuditLog.service_name != 'media-service')
        
        if filters.get('start_date'):
            time_series_query = time_series_query.filter(AuditLog.created_at >= filters['start_date'])
        if filters.get('end_date'):
            time_series_query = time_series_query.filter(AuditLog.created_at <= filters['end_date'])
            
        campus_ids = filters.get('campus_ids')
        if campus_ids:
            time_series_query = time_series_query.filter(AuditLog.payload['campus_id'].astext.in_(campus_ids))
            
        category_ids = filters.get('category_ids')
        if category_ids:
            time_series_query = time_series_query.filter(AuditLog.payload['category_id'].astext.in_(category_ids))
            
        time_series_results = time_series_query.group_by('creation_day').order_by('creation_day').all()
        
        return {
            "time_series": [
                {
                    "date": row[0].strftime('%Y-%m-%d') if row[0] else None, 
                    "count": row[1]
                } for row in time_series_results
            ]
        }


# ============================================================================
# 6. SERVICE LAYER
# ============================================================================

class PermissionError(Exception): pass
class NotFoundError(Exception): pass

class LogService:
    
    @staticmethod
    def _extract_filters(query_params: dict) -> dict:
        filters = {
            'service_name': query_params.get('service_name'),
            'action': query_params.get('action'),
            'actor_id': query_params.get('actor_id'),
            'entity_id': query_params.get('entity_id'),
            'start_date': query_params.get('start_date'),
            'end_date': query_params.get('end_date'),
            'log_type': query_params.get('log_type')  # Nuovo parametro
        }
        
        requested_campus = query_params.get('campus_id')
        if requested_campus:
            filters['campus_ids'] = [c.strip() for c in requested_campus.split(',')]
            
        requested_category = query_params.get('category_id')
        if requested_category:
            filters['category_ids'] = [c.strip() for c in requested_category.split(',')]
            
        return filters

    @staticmethod
    def get_paginated_logs(auth_context: dict, query_params: dict) -> dict:
        if auth_context.get('role') != 'AMMINISTRATORE':
            raise PermissionError("Accesso negato. Solo gli Amministratori possono consultare lo storico operazioni.")

        filters = LogService._extract_filters(query_params)
        
        user_campuses = auth_context.get('campus_ids', [])
        requested_campus = query_params.get('campus_id')
        
        if requested_campus:
            requested_list = [c.strip() for c in requested_campus.split(',')]
            valid_campuses = [c for c in requested_list if c in user_campuses]
            if not valid_campuses:
                filters['campus_ids'] = ["INVALID_CAMPUS"] 
            else:
                filters['campus_ids'] = valid_campuses
        else:
            filters['campus_ids'] = user_campuses

        try:
            page = int(query_params.get('page', 1))
            per_page = int(query_params.get('limit', 50))
            if per_page > 100: per_page = 100
        except ValueError:
            page = 1
            per_page = 50

        pagination = AuditLogRepository.get_logs(filters, page, per_page)
        return {
            "total_items": pagination.total,
            "total_pages": pagination.pages,
            "current_page": pagination.page,
            "items_per_page": per_page,
            "logs": [log.to_dict() for log in pagination.items]
        }

    @staticmethod
    def get_log_detail(auth_context: dict, log_id: str) -> dict:
        if auth_context.get('role') != 'AMMINISTRATORE':
            raise PermissionError("Accesso negato.")
        
        log_entry = AuditLogRepository.find_by_id(log_id)
        if not log_entry:
            raise NotFoundError("Record di audit non trovato.")
            
        return log_entry.to_dict()

    @staticmethod
    def export_csv(auth_context: dict, query_params: dict) -> str:
        if auth_context.get('role') != 'AMMINISTRATORE':
            raise PermissionError("Accesso negato.")
        
        filters = LogService._extract_filters(query_params)
        user_campuses = auth_context.get('campus_ids', [])
        
        requested_campus = query_params.get('campus_id')
        if requested_campus:
            requested_list = [c.strip() for c in requested_campus.split(',')]
            valid_campuses = [c for c in requested_list if c in user_campuses]
            if not valid_campuses:
                filters['campus_ids'] = ["INVALID_CAMPUS"]
            else:
                filters['campus_ids'] = valid_campuses
        else:
            filters['campus_ids'] = user_campuses
            
        logs = AuditLogRepository.get_all_logs(filters)

        headers = ['Data e Ora', 'Servizio', 'Azione', 'Utente', 'Oggetto Coinvolto', 'Dettagli Aggiuntivi']

        action_map = {
            'UPDATE_OPERATOR_PROFILE': 'Aggiornamento Profilo Operatore',
            '2FA_SUCCESS_LOGIN': 'Accesso con 2FA',
            'GOOGLE_LOGIN_SUCCESS': 'Accesso con Google',
            'CATEGORY_DELETED': 'Eliminazione Categoria',
            'CATEGORY_CREATED': 'Creazione Categoria',
            'ASSET_CREATED': 'Creazione Asset',
            'ASSET_UPDATED': 'Aggiornamento Asset',
            'ASSET_DELETED': 'Eliminazione Asset'
        }
        
        service_map = {
            'auth-service': 'Autenticazione',
            'asset-service': 'Gestione Asset',
            'log-service': 'Audit Log',
            'geozone-service': 'Gestione Mappe',
            'media-service': 'Gestione Media',
            'warning-service': 'Gestione Segnalazioni'
        }

        output = io.StringIO()
        output.write('\ufeff')
        writer = csv.DictWriter(output, fieldnames=headers, delimiter=';') 
        writer.writeheader()

        for log in logs:
            payload = log.payload if isinstance(log.payload, dict) else {}
            data_ora = log.created_at.strftime('%Y-%m-%d %H:%M:%S') if log.created_at else 'Data Sconosciuta'
            azione_pulita = action_map.get(log.action, log.action.replace('_', ' ').title())
            servizio_pulito = service_map.get(log.service_name, log.service_name)
            utente = payload.get('email') or str(log.actor_id) if log.actor_id else 'Sistema / Sconosciuto'

            oggetto = ''
            if payload.get('campus_name'): oggetto += f"Campus: {payload.get('campus_name')} "
            if payload.get('category_name'): oggetto += f"Categoria: {payload.get('category_name')} "
            if payload.get('asset_name'): oggetto += f"Asset: {payload.get('asset_name')} "
            elif log.entity_id: oggetto += f"ID: {str(log.entity_id)[:8]}..." 
            
            oggetto = oggetto.strip() if oggetto else 'Operazione di Sistema'

            keys_to_ignore = {
                'email', 'autore_id', 'actor_id', 'service_name', 'azione', 'action', 
                'timestamp', 'correlation_id', 'entity_id', 'campus_name', 'category_name', 'asset_name',
                'campus_id', 'category_id', 'media_id', 'asset_id'
            }
            
            dettagli_list = []
            for key, val in payload.items():
                if key not in keys_to_ignore and val not in [None, '', [], {}]:
                    if isinstance(val, dict): clean_val = ", ".join([f"{k}: {v}" for k, v in val.items()])
                    elif isinstance(val, list): clean_val = ", ".join(map(str, val))
                    else: clean_val = str(val)
                    
                    clean_key = key.replace('_', ' ').title()
                    dettagli_list.append(f"{clean_key}: {clean_val}")

            dettagli_stringa = " | ".join(dettagli_list) if dettagli_list else "-"

            row = {
                'Data e Ora': data_ora,
                'Servizio': servizio_pulito,
                'Azione': azione_pulita,
                'Utente': utente,
                'Oggetto Coinvolto': oggetto,
                'Dettagli Aggiuntivi': dettagli_stringa
            }
            writer.writerow(row)

        return output.getvalue()

    @staticmethod
    def get_dashboard_stats(auth_context: dict, query_params: dict) -> dict:
        user_role = auth_context.get('role')
        user_campuses = auth_context.get('campus_ids', [])

        if user_role != 'AMMINISTRATORE':
            raise PermissionError("Accesso negato. Solo gli Amministratori possono visualizzare la dashboard.")

        if not user_campuses:
            return {
                "totals": {"assets": 0, "interventions": 0, "tickets": 0},
                "distributions": {"by_campus": {}, "by_category": {}}
            }

        filters = LogService._extract_filters(query_params)

        requested_campus = query_params.get('campus_id')
        if requested_campus:
            requested_list = [c.strip() for c in requested_campus.split(',')]
            valid_campuses = [c for c in requested_list if c in user_campuses]
            if valid_campuses:
                filters['campus_ids'] = valid_campuses
            else:
                return {
                    "totals": {"assets": 0, "interventions": 0, "tickets": 0},
                    "distributions": {"by_campus": {}, "by_category": {}}
                }
        else:
            filters['campus_ids'] = user_campuses
            
        return AuditLogRepository.get_dashboard_metrics(filters)

    @staticmethod
    def get_dashboard_chart_data(auth_context: dict, query_params: dict) -> dict:
        user_role = auth_context.get('role')
        user_campuses = auth_context.get('campus_ids', [])

        if user_role != 'AMMINISTRATORE':
            raise PermissionError("Accesso negato.")
            
        if not user_campuses:
            return {"time_series": []}

        filters = LogService._extract_filters(query_params)
        
        requested_campus = query_params.get('campus_id')
        if requested_campus:
            requested_list = [c.strip() for c in requested_campus.split(',')]
            valid_campuses = [c for c in requested_list if c in user_campuses]
            if valid_campuses:
                filters['campus_ids'] = valid_campuses
            else:
                return {"time_series": []}
        else:
            filters['campus_ids'] = user_campuses
            
        return AuditLogRepository.get_dashboard_charts(filters)

# ============================================================================
# 7. ENDPOINT: API RESTFUL
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    try:
        db.session.execute(db.text('SELECT 1'))
        return jsonify({"status": "healthy", "database": "connected"}), 200
    except Exception as e:
        logger.error(f"Health check fallito: {str(e)}")
        return error_response("Service Unavailable", 503)
    
@app.route('/api/logs', methods=['GET'])
def get_logs():
    auth_context = get_auth_context()
    try:
        result = LogService.get_paginated_logs(auth_context, request.args)
        return jsonify(result), 200
    except PermissionError as pe:
        return error_response(str(pe), 403)
    except Exception as e:
        logger.error(f"Errore recupero log: {str(e)}")
        return error_response("Errore interno del server", 500)
    
@app.route('/api/logs/<log_id>', methods=['GET'])
def get_log_by_id(log_id):
    auth_context = get_auth_context()
    try:
        result = LogService.get_log_detail(auth_context, log_id)
        return jsonify(result), 200
    except PermissionError as pe:
        return error_response(str(pe), 403)
    except NotFoundError as nf:
        return error_response(str(nf), 404)
    except Exception as e:
        logger.error(f"Errore dettaglio log: {str(e)}")
        return error_response("Errore interno del server", 500)
    
@app.route('/api/logs/export', methods=['GET'])
def export_logs():
    auth_context = get_auth_context()
    try:
        csv_data = LogService.export_csv(auth_context, request.args)
        return Response(
            csv_data,
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_logs_export.csv"}
        )
    except PermissionError as pe:
        return error_response(str(pe), 403)
    except Exception as e:
        logger.error(f"Errore esportazione CSV: {str(e)}")
        return error_response("Errore interno del server", 500)

@app.route('/api/dashboard/metrics', methods=['GET'])
def get_dashboard_metrics_api():
    auth_context = get_auth_context()
    try:
        result = LogService.get_dashboard_stats(auth_context, request.args)
        return jsonify(result), 200
    except PermissionError as pe:
        return error_response(str(pe), 403)
    except Exception as e:
        logger.error(f"Errore elaborazione metriche dashboard: {str(e)}")
        return error_response("Errore interno del server", 500)
    
@app.route('/api/dashboard/charts', methods=['GET'])
def get_dashboard_charts_api():
    auth_context = get_auth_context()
    try:
        result = LogService.get_dashboard_chart_data(auth_context, request.args)
        return jsonify(result), 200
    except PermissionError as pe:
        return error_response(str(pe), 403)
    except Exception as e:
        logger.error(f"Errore elaborazione dati grafici dashboard: {str(e)}")
        return error_response("Errore interno del server", 500)


# ============================================================================
# 8. RABBITMQ CONSUMER BACKGROUND THREAD CON WEBSOCKET
# ============================================================================

def process_log_event(ch, method, properties, body):
    with app.app_context():
        try:
            message_data = json.loads(body.decode('utf-8'))
            
            schema = EventPayloadSchema()
            validated_data = schema.load(message_data)
            
            # SCARTO LOG MEDIA: Blocchiamo il salvataggio dei log provenienti da media-service
            if validated_data.get('service_name') == 'media-service':
                if ch.is_open:
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            raw_timestamp = validated_data.get('timestamp')
            parsed_created_at = dateutil.parser.isoparse(raw_timestamp) if raw_timestamp else None

            log_entry = AuditLog(
                correlation_id=validated_data.get('correlation_id'),
                service_name=validated_data.get('service_name'),
                action=validated_data.get('azione'),
                actor_id=validated_data.get('autore_id'),
                entity_id=validated_data.get('entity_id'),
                payload=message_data,
                created_at=parsed_created_at  
            )
            
            AuditLogRepository.insert(log_entry)
            
            # <-- EMISSIONE WEBSOCKET DOPO IL SALVATAGGIO REALE -->
            socketio.emit('new_log_event', {
                'action': log_entry.action,
                'service': log_entry.service_name
            })
            
            if ch.is_open:
                ch.basic_ack(delivery_tag=method.delivery_tag)
                
            logger.info(f"Audit log registrato con successo: '{log_entry.action}' da '{log_entry.service_name}'")

        except json.JSONDecodeError:
            logger.error(f"Payload scartato (Non è JSON valido): {body}")
            if ch.is_open:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        except ValidationError as err:
            logger.error(f"Payload scartato (Fallimento validazione DTO): {err.messages}")
            if ch.is_open:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        except Exception as e:
            logger.error(f"Errore temporaneo DB, requeue del messaggio: {str(e)}")
            if ch.is_open:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

def start_mq_consumer():
    while True:
        try:
            logger.info("[*] Avvio consumer RabbitMQ (Log Service)...")
            mq_manager.start_consumer(
                exchange_name='system_events', 
                callback_function=process_log_event,
                queue_name='audit_log_persistent_queue',
                auto_ack=False,
                durable_queue=True
            )
        except Exception as e:
            logger.error(f"[!] Connessione RabbitMQ persa: {str(e)}. Riconnessione tra 5s...")
            time.sleep(5)

# ============================================================================
# ENTRY POINT  
# ============================================================================

consumer_thread = threading.Thread(target=start_mq_consumer, daemon=True)
consumer_thread.start()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)