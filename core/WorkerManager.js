const { Worker } = require('bullmq');

/**
 * WorkerManager - Gère tous les workers et leurs handlers
 * 
 * Centralise la création et la gestion des workers BullMQ.
 * Permet de définir des handlers pour différents types de jobs.
 */
class WorkerManager {
  constructor(config) {
    this.config = config;
    this.workers = new Map();
    this.handlers = new Map();
    this.connection = config.redis;
  }

  /**
   * Démarre un worker pour une queue spécifique
   */
  startWorker(queueName, handlers, options = {}) {
    if (this.workers.has(queueName)) {
      console.log(`⚠️  Worker pour "${queueName}" existe déjà`);
      return this.workers.get(queueName);
    }

    // Stockage des handlers pour cette queue
    this.handlers.set(queueName, handlers);

    const workerOptions = {
      connection: this.connection,
      concurrency: options.concurrency || 5,
      removeOnComplete: options.removeOnComplete || this.config.defaultOptions.removeOnComplete,
      removeOnFail: options.removeOnFail || this.config.defaultOptions.removeOnFail,
      ...options
    };

    // Création du worker avec le processeur principal
    const worker = new Worker(queueName, async (job) => {
      return await this.processJob(queueName, job);
    }, workerOptions);

    // Gestion des événements du worker
    this.setupWorkerEvents(worker, queueName);

    this.workers.set(queueName, worker);
    console.log(`👷 Worker "${queueName}" démarré avec ${Object.keys(handlers).length} handlers`);

    return worker;
  }

  /**
   * Processeur principal qui route les jobs vers les bons handlers
   */
  async processJob(queueName, job) {
    const handlers = this.handlers.get(queueName);
    const handler = handlers[job.name];

    if (!handler) {
      throw new Error(`Aucun handler trouvé pour le job "${job.name}" dans la queue "${queueName}"`);
    }

    console.log(`🔄 Traitement du job "${job.name}" (ID: ${job.id}) sur "${queueName}"`);
    
    try {
      const startTime = Date.now();
      const result = await handler(job.data, job);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Job "${job.name}" (ID: ${job.id}) terminé en ${duration}ms`);
      return result;
    } catch (error) {
      console.error(`❌ Erreur dans le job "${job.name}" (ID: ${job.id}):`, error);
      throw error;
    }
  }

  /**
   * Configure les événements d'un worker
   */
  setupWorkerEvents(worker, queueName) {
    worker.on('completed', (job, result) => {
      console.log(`✅ [${queueName}] Job ${job.id} (${job.name}) terminé avec succès`);
    });

    worker.on('failed', (job, error) => {
      console.error(`❌ [${queueName}] Job ${job.id} (${job.name}) échoué:`, error.message);
    });

    worker.on('progress', (job, progress) => {
      console.log(`📊 [${queueName}] Job ${job.id} (${job.name}) progression: ${progress}%`);
    });

    worker.on('error', (error) => {
      console.error(`💥 [${queueName}] Erreur worker:`, error);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`⏰ [${queueName}] Job ${jobId} bloqué (stalled)`);
    });

    worker.on('active', (job) => {
      console.log(`🚀 [${queueName}] Job ${job.id} (${job.name}) démarré`);
    });
  }

  /**
   * Ajoute un handler pour un type de job spécifique
   */
  addHandler(queueName, jobName, handler) {
    if (!this.handlers.has(queueName)) {
      this.handlers.set(queueName, {});
    }

    this.handlers.get(queueName)[jobName] = handler;
    console.log(`🔧 Handler ajouté pour "${jobName}" sur "${queueName}"`);
  }

  /**
   * Supprime un handler
   */
  removeHandler(queueName, jobName) {
    const handlers = this.handlers.get(queueName);
    if (handlers && handlers[jobName]) {
      delete handlers[jobName];
      console.log(`🗑️  Handler "${jobName}" supprimé de "${queueName}"`);
    }
  }

  /**
   * Récupère un worker
   */
  getWorker(queueName) {
    return this.workers.get(queueName);
  }

  /**
   * Récupère tous les workers
   */
  getWorkers() {
    return Object.fromEntries(this.workers);
  }

  /**
   * Récupère les handlers d'une queue
   */
  getHandlers(queueName) {
    return this.handlers.get(queueName) || {};
  }

  /**
   * Pause un worker
   */
  async pauseWorker(queueName) {
    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.pause();
      console.log(`⏸️  Worker "${queueName}" mis en pause`);
    }
  }

  /**
   * Reprend un worker
   */
  async resumeWorker(queueName) {
    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.resume();
      console.log(`▶️  Worker "${queueName}" repris`);
    }
  }

  /**
   * Arrête un worker spécifique
   */
  async stopWorker(queueName) {
    const worker = this.workers.get(queueName);
    if (worker) {
      await worker.close();
      this.workers.delete(queueName);
      this.handlers.delete(queueName);
      console.log(`🛑 Worker "${queueName}" arrêté`);
    }
  }

  /**
   * Récupère les statistiques de tous les workers
   */
  getWorkersStats() {
    const stats = {};
    
    for (const [queueName, worker] of this.workers) {
      stats[queueName] = {
        isRunning: worker.isRunning(),
        isPaused: worker.isPaused(),
        concurrency: worker.opts.concurrency,
        handlersCount: Object.keys(this.handlers.get(queueName) || {}).length
      };
    }

    return stats;
  }

  /**
   * Arrête proprement tous les workers
   */
  async shutdown() {
    console.log('🛑 Arrêt du WorkerManager...');

    const shutdownPromises = [];
    
    for (const [queueName, worker] of this.workers) {
      shutdownPromises.push(
        worker.close().then(() => {
          console.log(`✅ Worker "${queueName}" fermé`);
        }).catch((error) => {
          console.error(`❌ Erreur fermeture worker "${queueName}":`, error);
        })
      );
    }

    await Promise.all(shutdownPromises);
    
    this.workers.clear();
    this.handlers.clear();
    console.log('✅ WorkerManager arrêté proprement');
  }

  /**
   * Crée des handlers génériques d'exemple
   */
  static createSampleHandlers() {
    return {
      'process-data': async (data, job) => {
        console.log(`🔄 Traitement des données: ${data.type || 'non spécifié'}`);
        
        // Simulation du traitement
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        console.log(`✅ Données traitées avec succès`);
        return { success: true, processedAt: new Date(), dataType: data.type };
      },

      'generate-report': async (data, job) => {
        console.log(`📊 Génération de rapport: ${data.reportType}`);
        
        // Simulation de la génération
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        console.log(`✅ Rapport généré: ${data.reportType}`);
        return { success: true, reportId: `RPT-${Date.now()}`, type: data.reportType };
      },

      'cleanup-task': async (data, job) => {
        console.log(`🧹 Tâche de nettoyage: ${data.target}`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        console.log(`✅ Nettoyage terminé: ${data.target}`);
        return { success: true, cleanedTarget: data.target, itemsRemoved: Math.floor(Math.random() * 100) };
      }
    };
  }
}

module.exports = WorkerManager; 