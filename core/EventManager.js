const { QueueEvents } = require('bullmq');

/**
 * EventManager - Système d'événements unifié
 * 
 * Centralise la gestion des événements BullMQ pour toutes les queues.
 * Permet d'ajouter des listeners personnalisés et de monitorer l'activité.
 */
class EventManager {
  constructor(config) {
    this.config = config;
    this.queueEvents = new Map();
    this.customListeners = new Map();
    this.connection = config.redis;
    this.globalListeners = new Map();
  }

  /**
   * Initialise l'EventManager
   */
  async initialize() {
    console.log('📡 Initialisation de l\'EventManager...');
    // Configuration des listeners globaux par défaut
    this.setupDefaultGlobalListeners();
    console.log('✅ EventManager initialisé');
  }

  /**
   * Configure des listeners globaux par défaut
   */
  setupDefaultGlobalListeners() {
    // Logger global pour tous les événements completed
    this.addGlobalListener('completed', (queueName, { jobId, name, returnvalue }) => {
      console.log(`🎉 [GLOBAL] Job ${jobId} (${name}) terminé sur ${queueName}`);
    });

    // Logger global pour tous les événements failed
    this.addGlobalListener('failed', (queueName, { jobId, name, failedReason }) => {
      console.error(`💥 [GLOBAL] Job ${jobId} (${name}) échoué sur ${queueName}: ${failedReason}`);
    });

    // Monitoring des jobs bloqués
    this.addGlobalListener('stalled', (queueName, { jobId }) => {
      console.warn(`⏰ [GLOBAL] Job ${jobId} bloqué sur ${queueName}`);
    });
  }

  /**
   * Crée un QueueEvents pour une queue spécifique
   */
  createQueueEvents(queueName) {
    if (this.queueEvents.has(queueName)) {
      return this.queueEvents.get(queueName);
    }

    const queueEvents = new QueueEvents(queueName, {
      connection: this.connection
    });

    // Configuration des événements de base
    this.setupQueueEvents(queueEvents, queueName);

    this.queueEvents.set(queueName, queueEvents);
    console.log(`📡 Events configurés pour la queue "${queueName}"`);

    return queueEvents;
  }

  /**
   * Configure les événements de base pour une queue
   */
  setupQueueEvents(queueEvents, queueName) {
    // Événements principaux
    const eventTypes = [
      'completed', 'failed', 'active', 'waiting', 'stalled', 
      'progress', 'removed', 'drained', 'paused', 'resumed'
    ];

    eventTypes.forEach(eventType => {
      queueEvents.on(eventType, (data) => {
        // Déclenchement des listeners globaux
        this.triggerGlobalListeners(eventType, queueName, data);
        
        // Déclenchement des listeners spécifiques à cette queue
        this.triggerQueueListeners(queueName, eventType, data);
      });
    });

    // Gestion des erreurs
    queueEvents.on('error', (error) => {
      console.error(`❌ Erreur events queue "${queueName}":`, error);
    });
  }

  /**
   * Déclenche les listeners globaux
   */
  triggerGlobalListeners(eventType, queueName, data) {
    const listeners = this.globalListeners.get(eventType);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(queueName, data);
        } catch (error) {
          console.error(`❌ Erreur dans listener global ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Déclenche les listeners spécifiques à une queue
   */
  triggerQueueListeners(queueName, eventType, data) {
    const queueListeners = this.customListeners.get(queueName);
    if (queueListeners) {
      const typeListeners = queueListeners.get(eventType);
      if (typeListeners) {
        typeListeners.forEach(listener => {
          try {
            listener(data);
          } catch (error) {
            console.error(`❌ Erreur dans listener ${eventType} de ${queueName}:`, error);
          }
        });
      }
    }
  }

  /**
   * Ajoute un listener global (pour toutes les queues)
   */
  addGlobalListener(eventType, callback) {
    if (!this.globalListeners.has(eventType)) {
      this.globalListeners.set(eventType, []);
    }
    
    this.globalListeners.get(eventType).push(callback);
    console.log(`🔔 Listener global ajouté pour l'événement "${eventType}"`);
  }

  /**
   * Ajoute un listener pour une queue spécifique
   */
  addListener(queueName, eventType, callback) {
    // S'assurer que QueueEvents existe pour cette queue
    this.createQueueEvents(queueName);

    if (!this.customListeners.has(queueName)) {
      this.customListeners.set(queueName, new Map());
    }

    const queueListeners = this.customListeners.get(queueName);
    if (!queueListeners.has(eventType)) {
      queueListeners.set(eventType, []);
    }

    queueListeners.get(eventType).push(callback);
    console.log(`🔔 Listener ajouté pour "${eventType}" sur "${queueName}"`);
  }

  /**
   * Supprime un listener global
   */
  removeGlobalListener(eventType, callback) {
    const listeners = this.globalListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
        console.log(`🗑️  Listener global supprimé pour "${eventType}"`);
      }
    }
  }

  /**
   * Supprime tous les listeners d'une queue
   */
  removeQueueListeners(queueName) {
    this.customListeners.delete(queueName);
    console.log(`🗑️  Tous les listeners supprimés pour "${queueName}"`);
  }

  /**
   * Récupère les statistiques d'événements
   */
  getEventStats() {
    const stats = {
      globalListeners: {},
      queueListeners: {},
      activeQueues: Array.from(this.queueEvents.keys())
    };

    // Statistiques des listeners globaux
    for (const [eventType, listeners] of this.globalListeners) {
      stats.globalListeners[eventType] = listeners.length;
    }

    // Statistiques des listeners par queue
    for (const [queueName, queueListeners] of this.customListeners) {
      stats.queueListeners[queueName] = {};
      for (const [eventType, listeners] of queueListeners) {
        stats.queueListeners[queueName][eventType] = listeners.length;
      }
    }

    return stats;
  }

  /**
   * Crée des listeners pré-définis pour le monitoring
   */
  setupMonitoringListeners() {
    // Monitoring des performances
    this.addGlobalListener('completed', (queueName, { jobId, name, returnvalue }) => {
      if (returnvalue && typeof returnvalue === 'object' && returnvalue.duration) {
        console.log(`⏱️  [PERF] Job ${name} terminé en ${returnvalue.duration}ms sur ${queueName}`);
      }
    });

    // Alertes pour les échecs récurrents
    const failureCount = new Map();
    this.addGlobalListener('failed', (queueName, { jobId, name, failedReason }) => {
      const key = `${queueName}:${name}`;
      const count = failureCount.get(key) || 0;
      failureCount.set(key, count + 1);
      
      if (count >= 3) {
        console.warn(`🚨 [ALERT] Job ${name} a échoué ${count + 1} fois sur ${queueName}`);
      }
    });

    // Reset du compteur d'échecs lors des succès
    this.addGlobalListener('completed', (queueName, { jobId, name }) => {
      const key = `${queueName}:${name}`;
      failureCount.delete(key);
    });

    console.log('📊 Listeners de monitoring configurés');
  }

  /**
   * Crée des listeners pour l'audit
   */
  setupAuditListeners() {
    const auditLog = [];

    const auditEvents = ['completed', 'failed', 'active', 'stalled'];
    
    auditEvents.forEach(eventType => {
      this.addGlobalListener(eventType, (queueName, data) => {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          queueName,
          eventType,
          jobId: data.jobId,
          jobName: data.name || 'unknown',
          data: eventType === 'failed' ? { reason: data.failedReason } : {}
        };
        
        auditLog.push(auditEntry);
        
        // Garder seulement les 1000 dernières entrées
        if (auditLog.length > 1000) {
          auditLog.shift();
        }
      });
    });

    // Méthode pour récupérer l'audit log
    this.getAuditLog = (limit = 100) => {
      return auditLog.slice(-limit);
    };

    console.log('📋 Listeners d\'audit configurés');
  }

  /**
   * Ferme proprement tous les QueueEvents
   */
  async shutdown() {
    console.log('🛑 Arrêt de l\'EventManager...');

    const shutdownPromises = [];
    
    for (const [queueName, queueEvents] of this.queueEvents) {
      shutdownPromises.push(
        queueEvents.close().then(() => {
          console.log(`✅ Events "${queueName}" fermés`);
        }).catch((error) => {
          console.error(`❌ Erreur fermeture events "${queueName}":`, error);
        })
      );
    }

    await Promise.all(shutdownPromises);
    
    this.queueEvents.clear();
    this.customListeners.clear();
    this.globalListeners.clear();
    console.log('✅ EventManager arrêté proprement');
  }
}

module.exports = EventManager; 