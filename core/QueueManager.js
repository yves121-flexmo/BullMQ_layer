const { Queue, QueueScheduler } = require('bullmq');

/**
 * QueueManager - Gère toutes les queues et leurs schedulers
 * 
 * Centralise la création et la gestion des queues BullMQ.
 * Un scheduler est automatiquement créé pour chaque queue pour gérer
 * les jobs delayed et recurring.
 */
class QueueManager {
  constructor(config) {
    this.config = config;
    this.queues = new Map();
    this.schedulers = new Map();
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
   * Crée une nouvelle queue avec son scheduler associé
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

    // Création de la queue
    const queue = new Queue(queueName, queueOptions);
    this.queues.set(queueName, queue);

    // Création du scheduler associé (nécessaire pour les jobs delayed/recurring)
    const scheduler = new QueueScheduler(queueName, { 
      connection: this.connection,
      ...options.schedulerOptions 
    });
    this.schedulers.set(queueName, scheduler);

    console.log(`✅ Queue "${queueName}" créée avec son scheduler`);

    // Gestion des erreurs
    queue.on('error', (error) => {
      console.error(`❌ Erreur queue "${queueName}":`, error);
    });

    scheduler.on('error', (error) => {
      console.error(`❌ Erreur scheduler "${queueName}":`, error);
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
   * Récupère un scheduler existant
   */
  getScheduler(queueName) {
    return this.schedulers.get(queueName);
  }

  /**
   * Récupère toutes les queues
   */
  getQueues() {
    return Object.fromEntries(this.queues);
  }

  /**
   * Récupère tous les schedulers
   */
  getSchedulers() {
    return Object.fromEntries(this.schedulers);
  }

  /**
   * Supprime une queue et son scheduler
   */
  async removeQueue(queueName) {
    const queue = this.queues.get(queueName);
    const scheduler = this.schedulers.get(queueName);

    if (queue) {
      await queue.close();
      this.queues.delete(queueName);
    }

    if (scheduler) {
      await scheduler.close();
      this.schedulers.delete(queueName);
    }

    console.log(`🗑️  Queue "${queueName}" et son scheduler supprimés`);
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
   * Ferme proprement toutes les queues et schedulers
   */
  async shutdown() {
    console.log('🛑 Arrêt du QueueManager...');

    // Fermeture des schedulers
    for (const [queueName, scheduler] of this.schedulers) {
      try {
        await scheduler.close();
        console.log(`✅ Scheduler "${queueName}" fermé`);
      } catch (error) {
        console.error(`❌ Erreur fermeture scheduler "${queueName}":`, error);
      }
    }

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
    this.schedulers.clear();
    console.log('✅ QueueManager arrêté proprement');
  }
}

module.exports = QueueManager; 