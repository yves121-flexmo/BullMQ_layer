const QueueManager = require('./QueueManager');
const WorkerManager = require('./WorkerManager');
const EventManager = require('./EventManager');
const FlowManager = require('./FlowManager');

/**
 * BullMQManager - Gestionnaire central BullMQ pur
 * 
 * Interface unifiée pour tous les composants BullMQ sans logique métier.
 * Utilisable pour n'importe quel type de jobs (emails, exports, traitement d'images, etc.)
 */
class BullMQManager {
  constructor(config = {}) {
    this.config = {
      redis: {
        url: config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379'
      },
      isProduction: config.isProduction || process.env.NODE_ENV === 'production',
      defaultOptions: {
        attempts: config.defaultOptions?.attempts || 3,
        backoff: config.defaultOptions?.backoff || { type: 'fixed', delay: 5000 },
        removeOnComplete: config.defaultOptions?.removeOnComplete || 100,
        removeOnFail: config.defaultOptions?.removeOnFail || 50
      },
      logger: config.logger || null, // Logger personnalisé optionnel
      ...config
    };

    // Initialisation des managers core
    this.queueManager = new QueueManager(this.config);
    this.workerManager = new WorkerManager(this.config);
    this.eventManager = new EventManager(this.config);
    this.flowManager = new FlowManager(this.config);

    this.isInitialized = false;
  }

  /**
   * Initialise le système BullMQ
   */
  async initialize() {
    if (this.isInitialized) {
      this.log('⚠️  BullMQManager déjà initialisé');
      return;
    }

    try {
      this.log('🚀 Initialisation du BullMQManager...');
      
      await this.queueManager.initialize();
      await this.eventManager.initialize();
      
      this.isInitialized = true;
      this.log('✅ BullMQManager initialisé avec succès');
    } catch (error) {
      this.logError('❌ Erreur lors de l\'initialisation du BullMQManager:', error);
      throw error;
    }
  }

  /**
   * Crée une nouvelle queue
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
    
    this.log(`📤 Job "${jobName}" ajouté à la queue "${queueName}" (ID: ${job.id})`);
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
      jobId: `${jobName}-scheduled`
    };

    const job = await queue.add(jobName, data, jobOptions);
    this.log(`⏰ Job "${jobName}" planifié sur "${queueName}" avec le pattern: ${cronPattern}`);
    return job;
  }

  /**
   * Crée un workflow avec dépendances
   */
  async addFlow(flowDefinition) {
    return this.flowManager.addFlow(flowDefinition);
  }

  /**
   * Ajoute un listener d'événements
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
      queueName,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length
    };
  }

  /**
   * Récupère les statistiques globales de toutes les queues
   */
  async getGlobalStats() {
    const queues = this.getQueues();
    const globalStats = {
      totalQueues: Object.keys(queues).length,
      totalWaiting: 0,
      totalActive: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalDelayed: 0,
      totalJobs: 0,
      queues: {}
    };

    for (const [queueName] of Object.entries(queues)) {
      try {
        const stats = await this.getQueueStats(queueName);
        globalStats.queues[queueName] = stats;
        
        globalStats.totalWaiting += stats.waiting;
        globalStats.totalActive += stats.active;
        globalStats.totalCompleted += stats.completed;
        globalStats.totalFailed += stats.failed;
        globalStats.totalDelayed += stats.delayed;
        globalStats.totalJobs += stats.total;
      } catch (error) {
        this.logError(`❌ Erreur récupération stats pour ${queueName}:`, error);
        globalStats.queues[queueName] = { error: error.message };
      }
    }

    return globalStats;
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
    
    this.log(`🧹 Queue "${queueName}" nettoyée`);
  }

  /**
   * Nettoie toutes les queues
   */
  async cleanAllQueues(options = {}) {
    const queues = this.getQueues();
    const cleanPromises = [];

    for (const queueName of Object.keys(queues)) {
      cleanPromises.push(
        this.cleanQueue(queueName, options).catch(error => {
          this.logError(`❌ Erreur nettoyage ${queueName}:`, error);
        })
      );
    }

    await Promise.all(cleanPromises);
    this.log('🧹 Toutes les queues nettoyées');
  }

  /**
   * Pause une queue
   */
  async pauseQueue(queueName) {
    const queue = this.queueManager.getQueue(queueName);
    if (queue) {
      await queue.pause();
      this.log(`⏸️ Queue "${queueName}" mise en pause`);
    }
  }

  /**
   * Reprend une queue
   */
  async resumeQueue(queueName) {
    const queue = this.queueManager.getQueue(queueName);
    if (queue) {
      await queue.resume();
      this.log(`▶️ Queue "${queueName}" reprise`);
    }
  }

  /**
   * Récupère la liste de toutes les queues
   */
  getQueues() {
    return this.queueManager.getQueues();
  }

  /**
   * Récupère tous les workers
   */
  getWorkers() {
    return this.workerManager.getWorkers();
  }

  /**
   * Vérifie l'état de santé du système
   */
  async healthCheck() {
    try {
      const globalStats = await this.getGlobalStats();
      const workersStats = this.workerManager.getWorkersStats();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: {
          isProduction: this.config.isProduction,
          redisUrl: this.config.redis.url.replace(/\/\/.*@/, '//***@')
        },
        queues: globalStats,
        workers: workersStats
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Arrête proprement tous les composants
   */
  async shutdown() {
    this.log('🛑 Arrêt du BullMQManager...');
    
    await this.workerManager.shutdown();
    await this.queueManager.shutdown();
    await this.eventManager.shutdown();
    await this.flowManager.shutdown();
    
    this.isInitialized = false;
    this.log('✅ BullMQManager arrêté proprement');
  }

  /**
   * Logger intelligent selon l'environnement
   */
  log(message, data = null) {
    if (this.config.logger) {
      this.config.logger.info(message, data);
    } else if (!this.config.isProduction) {
      console.log(message, data || '');
    }
  }

  /**
   * Logger d'erreurs
   */
  logError(message, error) {
    if (this.config.logger) {
      this.config.logger.error(message, { error: error.message, stack: error.stack });
    } else if (!this.config.isProduction) {
      console.error(message, error);
    }
  }
}

module.exports = BullMQManager; 