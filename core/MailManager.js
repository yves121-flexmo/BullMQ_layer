const QueueManager = require('./QueueManager');
const WorkerManager = require('./WorkerManager');
const EventManager = require('./EventManager');
const FlowManager = require('./FlowManager');

/**
 * MailManager - Classe principale qui unifie tous les composants BullMQ
 * 
 * Cette classe simplifie l'utilisation de BullMQ en fournissant une interface
 * unique pour gérer les queues, workers, events et flows
 */
class MailManager {
  constructor(config = {}) {
    this.config = {
      redis: {
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
        url: config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379'
      },
      defaultOptions: {
        attempts: config.defaultOptions?.attempts || 3,
        backoff: config.defaultOptions?.backoff || { type: 'fixed', delay: 5000 },
        removeOnComplete: config.defaultOptions?.removeOnComplete || 100,
        removeOnFail: config.defaultOptions?.removeOnFail || 50
      },
      ...config
    };

    // Initialisation des managers
    this.queueManager = new QueueManager(this.config);
    this.workerManager = new WorkerManager(this.config);
    this.eventManager = new EventManager(this.config);
    this.flowManager = new FlowManager(this.config);

    this.isInitialized = false;
  }

  /**
   * Initialise le système de mail
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  MailManager déjà initialisé');
      return;
    }

    try {
      console.log('🚀 Initialisation du MailManager...');
      
      await this.queueManager.initialize();
      await this.eventManager.initialize();
      
      this.isInitialized = true;
      console.log('✅ MailManager initialisé avec succès');
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation du MailManager:', error);
      throw error;
    }
  }

  /**
   * Crée une nouvelle queue pour un type de mail spécifique
   */
  createQueue(queueName, options = {}) {
    return this.queueManager.createQueue(queueName, options);
  }

  /**
   * Démarre un worker pour traiter les jobs d'une queue
   */
  startWorker(queueName, handlers, options = {}) {
    return this.workerManager.startWorker(queueName, handlers, options);
  }

  /**
   * Ajoute un job simple à la queue
   */
  async addJob(queueName, jobName, data, options = {}) {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" n'existe pas`);
    }

    const jobOptions = { ...this.config.defaultOptions, ...options };
    const job = await queue.add(jobName, data, jobOptions);
    
    console.log(`📤 Job "${jobName}" ajouté à la queue "${queueName}" (ID: ${job.id})`);
    return job;
  }

  /**
   * Planifie un job récurrent
   */
  async scheduleJob(queueName, jobName, data, cronPattern, options = {}) {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" n'existe pas`);
    }

    const jobOptions = {
      ...this.config.defaultOptions,
      ...options,
      repeat: { pattern: cronPattern },
      jobId: `${jobName}-scheduled` // ID unique pour éviter les doublons
    };

    const job = await queue.add(jobName, data, jobOptions);
    console.log(`⏰ Job "${jobName}" planifié sur "${queueName}" avec le pattern: ${cronPattern}`);
    return job;
  }

  /**
   * Crée un workflow avec dépendances
   */
  async addFlow(flowDefinition) {
    return this.flowManager.addFlow(flowDefinition);
  }

  /**
   * Ajoute un listener d'événements personnalisé
   */
  onEvent(queueName, eventType, callback) {
    return this.eventManager.addListener(queueName, eventType, callback);
  }

  /**
   * Récupère les statistiques d'une queue
   */
  async getQueueStats(queueName) {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" n'existe pas`);
    }

    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    const delayed = await queue.getDelayed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length
    };
  }

  /**
   * Nettoie les anciens jobs d'une queue
   */
  async cleanQueue(queueName, options = {}) {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" n'existe pas`);
    }

    const cleanOptions = {
      grace: options.grace || 1000,
      limit: options.limit || 100,
      ...options
    };

    await queue.clean(24 * 3600 * 1000, cleanOptions.limit, 'completed');
    await queue.clean(24 * 3600 * 1000, cleanOptions.limit, 'failed');
    
    console.log(`🧹 Queue "${queueName}" nettoyée`);
  }

  /**
   * Arrête proprement tous les composants
   */
  async shutdown() {
    console.log('🛑 Arrêt du MailManager...');
    
    await this.workerManager.shutdown();
    await this.queueManager.shutdown();
    await this.eventManager.shutdown();
    await this.flowManager.shutdown();
    
    this.isInitialized = false;
    console.log('✅ MailManager arrêté proprement');
  }

  /**
   * Récupère la liste de toutes les queues
   */
  getQueues() {
    return this.queueManager.getQueues();
  }

  /**
   * Vérifie l'état de santé du système
   */
  async healthCheck() {
    try {
      const queues = this.getQueues();
      const health = {};

      for (const [name, queue] of Object.entries(queues)) {
        health[name] = await this.getQueueStats(name);
      }

      return {
        status: 'healthy',
        queues: health,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = MailManager; 