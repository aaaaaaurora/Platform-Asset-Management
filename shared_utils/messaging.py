import os
import json
import time
import pika

class RabbitMQManager:
    """
    Gestore centralizzato per la comunicazione asincrona tramite RabbitMQ.
    Implementa pattern di connessione sicura, retry automatico e supporto a consumer avanzati.
    """
    def __init__(self, rabbitmq_url=None):
        self.rabbitmq_url = rabbitmq_url or os.getenv('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq-service:5672/')
 
    def get_connection(self):
        """
        Effettua la connessione a RabbitMQ con un meccanismo di retry (Backoff).
        Utile per gestire i tempi di avvio dei container in Kubernetes.
        """
        connection = None
        while not connection:
            try:
                params = pika.URLParameters(self.rabbitmq_url)
                connection = pika.BlockingConnection(params)
            except pika.exceptions.AMQPConnectionError:
                print("[Shared Messaging] RabbitMQ non ancora pronto. Tentativo tra 5 secondi...")
                time.sleep(5)
        return connection

    def publish_event(self, exchange_name, action, actor_id, service_name, extra_data=None):
        """
        Pubblica un evento standardizzato su un Exchange RabbitMQ.
        """
        # Estrazione intelligente dell'entity_id dai dati extra per normalizzarlo per il Log Service  
        entity_id = None
        if extra_data and isinstance(extra_data, dict):
            entity_id = (
                extra_data.get('entity_id') or 
                extra_data.get('asset_id') or 
                extra_data.get('campus_id') or 
                extra_data.get('media_id') or 
                extra_data.get('category_id') or
                extra_data.get('warning_id') or
                extra_data.get('maintenance_id')
            )

        event = {
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "autore_id": str(actor_id) if actor_id is not None else None,
            "entity_id": str(entity_id) if entity_id is not None else None,
            "azione": action,
            "service_name": service_name
        }
        
        if extra_data and isinstance(extra_data, dict):
            event.update(extra_data)

        try:
            connection = self.get_connection()
            channel = connection.channel()
            
            # Dichiara l'exchange di tipo fanout (pub/sub)
            channel.exchange_declare(exchange=exchange_name, exchange_type='fanout', durable=True)
            
            channel.basic_publish(
                exchange=exchange_name,
                routing_key='',
                body=json.dumps(event),
                properties=pika.BasicProperties(delivery_mode=2)  # Messaggio persistente
            )
            connection.close()
        except Exception as e:
            print(f"[Shared Messaging] Errore di pubblicazione evento su {exchange_name}: {str(e)}")

    def start_consumer(self, exchange_name, callback_function, queue_name=None, auto_ack=True, durable_queue=False):
        """
        Avvia un consumer in ascolto su un determinato exchange (Fanout).
        
        - Se queue_name è specificato e durable_queue=True, crea una coda persistente (ideale per il Log Service).
        - Se auto_ack=False, permette il controllo manuale dei messaggi tramite basic_ack/basic_nack nella callback.
        """
        try:
            connection = self.get_connection()
            channel = connection.channel()
            
            channel.exchange_declare(exchange=exchange_name, exchange_type='fanout', durable=True)
            
            if queue_name:
                # Coda dedicata e persistente (utile per Log Service)
                channel.queue_declare(queue=queue_name, durable=durable_queue)
                channel.queue_bind(exchange=exchange_name, queue=queue_name)
                target_queue = queue_name
            else:
                # Comportamento legacy: coda esclusiva e temporanea
                result = channel.queue_declare(queue='', exclusive=True)
                target_queue = result.method.queue
                channel.queue_bind(exchange=exchange_name, queue=target_queue)

            # Gestione del QoS per evitare di sovraccaricare il consumer se auto_ack è False
            if not auto_ack:
                channel.basic_qos(prefetch_count=10)

            channel.basic_consume(queue=target_queue, on_message_callback=callback_function, auto_ack=auto_ack)
            print(f"[Shared Messaging] Consumer in ascolto sull'exchange '{exchange_name}' (Coda: {target_queue}, Auto-Ack: {auto_ack})")
            channel.start_consuming()
        except Exception as e:
            print(f"[Shared Messaging] Errore nel consumer RabbitMQ: {str(e)}")
            raise e # Rilanciamo l'eccezione per permettere il retry a monte