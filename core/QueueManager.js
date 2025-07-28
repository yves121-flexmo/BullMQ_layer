const { Queue } = require('bullmq');

/**
 * QueueManager - Gère toutes les queues
 * 
 * Centralise la création et la gestion des queues BullMQ.
 * Note: Dans les versions récentes de BullMQ, le scheduler est intégré 
 * directement dans la Queue, plus besoin de QueueScheduler séparé.
 */
class QueueManager {
  constructor(config) {
    this.config = config;
    this.queues = new Map();
    this.connection = config.redis;
  }

  /**
   * Initialise le QueueManager
   */
  async initialize() {
    console.log('📋 Initialisation du QueueManager...');
    // Pas d'initialisation spécifique nécessaire
    console.log('✅ QueueManager initialisé');
  }

  /**
   * Crée une nouvelle queue
   */
  createQueue(queueName, options = {}) {
    if (this.queues.has(queueName)) {
      console.log(`⚠️  Queue "${queueName}" existe déjà`);
      return this.queues.get(queueName);
    }

    const queueOptions = {
      connection: this.connection,
      defaultJobOptions: {
        removeOnComplete: options.removeOnComplete || this.config.defaultOptions.removeOnComplete,
        removeOnFail: options.removeOnFail || this.config.defaultOptions.removeOnFail,
        attempts: options.attempts || this.config.defaultOptions.attempts,
        backoff: options.backoff || this.config.defaultOptions.backoff
      },
      ...options
    };

    // Création de la queue (scheduler intégré automatiquement)
    const queue = new Queue(queueName, queueOptions);
    this.queues.set(queueName, queue);

    console.log(`✅ Queue "${queueName}" créée (scheduler intégré)`);

    // Gestion des erreurs
    queue.on('error', (error) => {
      console.error(`❌ Erreur queue "${queueName}":`, error);
    });

    return queue;
  }

  /**
   * Récupère une queue existante
   */
  getQueue(queueName) {
    return this.queues.get(queueName);
  }

  /**
   * Récupère toutes les queues
   */
  getQueues() {
    return Object.fromEntries(this.queues);
  }

  /**
   * Supprime une queue
   */
  async removeQueue(queueName) {
    const queue = this.queues.get(queueName);

    if (queue) {
      await queue.close();
      this.queues.delete(queueName);
      console.log(`🗑️  Queue "${queueName}" supprimée`);
    }
  }

  /**
   * Pause une queue
   */
  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.pause();
      console.log(`⏸️  Queue "${queueName}" mise en pause`);
    }
  }

  /**
   * Reprend une queue
   */
  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.resume();
      console.log(`▶️  Queue "${queueName}" reprise`);
    }
  }

  /**
   * Vide complètement une queue
   */
  async obliterateQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.obliterate();
      console.log(`💥 Queue "${queueName}" vidée complètement`);
    }
  }

  /**
   * Récupère les jobs récurrents d'une queue
   */
  async getRepeatableJobs(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      return await queue.getRepeatableJobs();
    }
    return [];
  }

  /**
   * Supprime un job récurrent
   */
  async removeRepeatableJob(queueName, jobId, repeatOptions) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.removeRepeatableByKey(jobId);
      console.log(`🗑️  Job récurrent "${jobId}" supprimé de "${queueName}"`);
    }
  }

  /**
   * Récupère les métriques de toutes les queues
   */
  async getAllQueueMetrics() {
    const metrics = {};
    
    for (const [queueName, queue] of this.queues) {
      try {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        const delayed = await queue.getDelayed();
        const paused = await queue.isPaused();

        metrics[queueName] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          paused
        };
      } catch (error) {
        metrics[queueName] = { error: error.message };
      }
    }

    return metrics;
  }

  /**
   * Nettoie toutes les queues
   */
  async cleanAllQueues(olderThan = 24 * 3600 * 1000, limit = 100) {
    console.log('🧹 Nettoyage de toutes les queues...');
    
    for (const [queueName, queue] of this.queues) {
      try {
        await queue.clean(olderThan, limit, 'completed');
        await queue.clean(olderThan, limit, 'failed');
        console.log(`✅ Queue "${queueName}" nettoyée`);
      } catch (error) {
        console.error(`❌ Erreur nettoyage queue "${queueName}":`, error);
      }
    }
  }

  /**
   * Ferme proprement toutes les queues
   */
  async shutdown() {
    console.log('🛑 Arrêt du QueueManager...');

    // Fermeture des queues
    for (const [queueName, queue] of this.queues) {
      try {
        await queue.close();
        console.log(`✅ Queue "${queueName}" fermée`);
      } catch (error) {
        console.error(`❌ Erreur fermeture queue "${queueName}":`, error);
      }
    }

    this.queues.clear();
    console.log('✅ QueueManager arrêté proprement');
  }
}

module.exports = QueueManager; 