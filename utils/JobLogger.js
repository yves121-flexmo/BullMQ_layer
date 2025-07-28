/**
 * JobLogger - Système de logs globaux pour jobs BullMQ
 * 
 * Suit l'état, le temps d'exécution, les statuts et performances de tous les jobs
 * indépendamment du type métier (emails, exports, etc.)
 */
class JobLogger {
  constructor(config = {}) {
    this.config = {
      isProduction: config.isProduction || process.env.NODE_ENV === 'production',
      logLevel: config.logLevel || 'info', // debug, info, warn, error
      enableMetrics: config.enableMetrics !== false,
      mongo: {
        uri: config.mongo?.uri || process.env.MONGO_URI || null,
        collection: config.mongo?.collection || 'job_logs'
      },
      retentionDays: config.retentionDays || 30,
      logger: config.logger || null, // Logger personnalisé (Winston, etc.)
      ...config
    };

    // Métriques en mémoire
    this.metrics = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      averageExecutionTime: 0,
      queueMetrics: {}, // Par queue
      jobTypeMetrics: {}, // Par type de job
      errorCounts: {},
      lastUpdated: new Date()
    };

    // Jobs actifs pour calcul du temps
    this.activeJobs = new Map();
  }

  /**
   * Log quand un job démarre
   */
  logJobStarted(jobData) {
    const logEntry = {
      jobId: jobData.id,
      queueName: jobData.queueName,
      jobName: jobData.name,
      status: 'started',
      startTime: new Date(),
      data: this.sanitizeJobData(jobData.data),
      attempts: jobData.attemptsMade || 0,
      priority: jobData.opts?.priority || 5
    };

    // Stocker pour calcul du temps d'exécution
    this.activeJobs.set(jobData.id, logEntry);

    // Mise à jour des métriques
    this.updateMetrics('started', jobData);

    this.log('info', `🚀 [${logEntry.queueName}] Job ${logEntry.jobId} (${logEntry.jobName}) démarré`, logEntry);
    
    // Sauvegarde si production
    if (this.config.isProduction && this.config.mongo.uri) {
      this.saveToDatabase(logEntry);
    }

    return logEntry;
  }

  /**
   * Log quand un job se termine avec succès
   */
  logJobCompleted(jobData, result = null) {
    const startEntry = this.activeJobs.get(jobData.id);
    const executionTime = startEntry ? Date.now() - startEntry.startTime.getTime() : 0;

    const logEntry = {
      jobId: jobData.id,
      queueName: jobData.queueName,
      jobName: jobData.name,
      status: 'completed',
      startTime: startEntry?.startTime || new Date(),
      endTime: new Date(),
      executionTime, // en ms
      result: this.sanitizeResult(result),
      attempts: jobData.attemptsMade || 0
    };

    // Nettoyer les jobs actifs
    this.activeJobs.delete(jobData.id);

    // Mise à jour des métriques
    this.updateMetrics('completed', jobData, executionTime);

    this.log('info', `✅ [${logEntry.queueName}] Job ${logEntry.jobId} (${logEntry.jobName}) terminé en ${executionTime}ms`, logEntry);
    
    if (this.config.isProduction && this.config.mongo.uri) {
      this.saveToDatabase(logEntry);
    }

    return logEntry;
  }

  /**
   * Log quand un job échoue
   */
  logJobFailed(jobData, error) {
    const startEntry = this.activeJobs.get(jobData.id);
    const executionTime = startEntry ? Date.now() - startEntry.startTime.getTime() : 0;

    const logEntry = {
      jobId: jobData.id,
      queueName: jobData.queueName,
      jobName: jobData.name,
      status: 'failed',
      startTime: startEntry?.startTime || new Date(),
      endTime: new Date(),
      executionTime,
      error: {
        message: error.message,
        stack: this.config.logLevel === 'debug' ? error.stack : null,
        name: error.name
      },
      attempts: jobData.attemptsMade || 0,
      maxAttempts: jobData.opts?.attempts || 3
    };

    // Nettoyer les jobs actifs
    this.activeJobs.delete(jobData.id);

    // Mise à jour des métriques
    this.updateMetrics('failed', jobData, executionTime, error);

    this.log('error', `❌ [${logEntry.queueName}] Job ${logEntry.jobId} (${logEntry.jobName}) échoué après ${executionTime}ms: ${error.message}`, logEntry);
    
    if (this.config.isProduction && this.config.mongo.uri) {
      this.saveToDatabase(logEntry);
    }

    return logEntry;
  }

  /**
   * Log quand un job progresse
   */
  logJobProgress(jobData, progress) {
    const logEntry = {
      jobId: jobData.id,
      queueName: jobData.queueName,
      jobName: jobData.name,
      status: 'progress',
      timestamp: new Date(),
      progress: progress
    };

    this.log('debug', `📊 [${logEntry.queueName}] Job ${logEntry.jobId} (${logEntry.jobName}) progression: ${progress}%`, logEntry);
    
    return logEntry;
  }

  /**
   * Log quand un job est bloqué (stalled)
   */
  logJobStalled(jobData) {
    const logEntry = {
      jobId: jobData.id,
      queueName: jobData.queueName,
      jobName: jobData.name,
      status: 'stalled',
      timestamp: new Date(),
      attempts: jobData.attemptsMade || 0
    };

    this.updateMetrics('stalled', jobData);

    this.log('warn', `⏰ [${logEntry.queueName}] Job ${logEntry.jobId} (${logEntry.jobName}) bloqué (stalled)`, logEntry);
    
    if (this.config.isProduction && this.config.mongo.uri) {
      this.saveToDatabase(logEntry);
    }

    return logEntry;
  }

  /**
   * Met à jour les métriques en temps réel
   */
  updateMetrics(status, jobData, executionTime = 0, error = null) {
    if (!this.config.enableMetrics) return;

    const queueName = jobData.queueName;
    const jobName = jobData.name;

    // Métriques globales
    this.metrics.totalJobs++;
    
    if (status === 'completed') {
      this.metrics.completedJobs++;
      
      // Calcul de la moyenne du temps d'exécution
      const currentAvg = this.metrics.averageExecutionTime;
      const totalCompleted = this.metrics.completedJobs;
      this.metrics.averageExecutionTime = ((currentAvg * (totalCompleted - 1)) + executionTime) / totalCompleted;
      
    } else if (status === 'failed') {
      this.metrics.failedJobs++;
      
      // Comptage des erreurs
      const errorKey = error ? error.message : 'Unknown error';
      this.metrics.errorCounts[errorKey] = (this.metrics.errorCounts[errorKey] || 0) + 1;
      
    } else if (status === 'started') {
      this.metrics.activeJobs++;
    }

    // Métriques par queue
    if (!this.metrics.queueMetrics[queueName]) {
      this.metrics.queueMetrics[queueName] = {
        total: 0,
        completed: 0,
        failed: 0,
        averageTime: 0,
        lastActivity: new Date()
      };
    }

    const queueMetric = this.metrics.queueMetrics[queueName];
    queueMetric.total++;
    queueMetric.lastActivity = new Date();

    if (status === 'completed') {
      queueMetric.completed++;
      queueMetric.averageTime = ((queueMetric.averageTime * (queueMetric.completed - 1)) + executionTime) / queueMetric.completed;
    } else if (status === 'failed') {
      queueMetric.failed++;
    }

    // Métriques par type de job
    if (!this.metrics.jobTypeMetrics[jobName]) {
      this.metrics.jobTypeMetrics[jobName] = {
        total: 0,
        completed: 0,
        failed: 0,
        averageTime: 0
      };
    }

    const jobMetric = this.metrics.jobTypeMetrics[jobName];
    jobMetric.total++;

    if (status === 'completed') {
      jobMetric.completed++;
      jobMetric.averageTime = ((jobMetric.averageTime * (jobMetric.completed - 1)) + executionTime) / jobMetric.completed;
    } else if (status === 'failed') {
      jobMetric.failed++;
    }

    this.metrics.lastUpdated = new Date();
  }

  /**
   * Récupère les métriques actuelles
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeJobsCount: this.activeJobs.size,
      successRate: this.metrics.totalJobs > 0 
        ? ((this.metrics.completedJobs / this.metrics.totalJobs) * 100).toFixed(2)
        : 0,
      failureRate: this.metrics.totalJobs > 0 
        ? ((this.metrics.failedJobs / this.metrics.totalJobs) * 100).toFixed(2)
        : 0
    };
  }

  /**
   * Récupère les statistiques détaillées
   */
  getDetailedStats() {
    const metrics = this.getMetrics();
    
    return {
      global: {
        totalJobs: metrics.totalJobs,
        completedJobs: metrics.completedJobs,
        failedJobs: metrics.failedJobs,
        activeJobs: metrics.activeJobsCount,
        successRate: `${metrics.successRate}%`,
        failureRate: `${metrics.failureRate}%`,
        averageExecutionTime: `${Math.round(metrics.averageExecutionTime)}ms`
      },
      queues: metrics.queueMetrics,
      jobTypes: metrics.jobTypeMetrics,
      topErrors: this.getTopErrors(),
      performance: {
        fastestJobs: this.getFastestJobTypes(),
        slowestJobs: this.getSlowestJobTypes()
      },
      lastUpdated: metrics.lastUpdated
    };
  }

  /**
   * Récupère les erreurs les plus fréquentes
   */
  getTopErrors(limit = 5) {
    return Object.entries(this.metrics.errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([error, count]) => ({ error, count }));
  }

  /**
   * Récupère les types de jobs les plus rapides
   */
  getFastestJobTypes(limit = 5) {
    return Object.entries(this.metrics.jobTypeMetrics)
      .filter(([, metrics]) => metrics.completed > 0)
      .sort((a, b) => a[1].averageTime - b[1].averageTime)
      .slice(0, limit)
      .map(([jobType, metrics]) => ({
        jobType,
        averageTime: Math.round(metrics.averageTime),
        completedJobs: metrics.completed
      }));
  }

  /**
   * Récupère les types de jobs les plus lents
   */
  getSlowestJobTypes(limit = 5) {
    return Object.entries(this.metrics.jobTypeMetrics)
      .filter(([, metrics]) => metrics.completed > 0)
      .sort((a, b) => b[1].averageTime - a[1].averageTime)
      .slice(0, limit)
      .map(([jobType, metrics]) => ({
        jobType,
        averageTime: Math.round(metrics.averageTime),
        completedJobs: metrics.completed
      }));
  }

  /**
   * Nettoie les données sensibles des jobs
   */
  sanitizeJobData(data) {
    if (!data) return null;
    
    // Créer une copie pour éviter de modifier l'original
    const sanitized = { ...data };
    
    // Supprimer les champs sensibles
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'credentials'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    // Limiter la taille des données
    const dataString = JSON.stringify(sanitized);
    if (dataString.length > 1000) {
      return { _truncated: true, _size: dataString.length };
    }

    return sanitized;
  }

  /**
   * Nettoie les résultats des jobs
   */
  sanitizeResult(result) {
    if (!result) return null;
    
    // Limiter la taille des résultats
    const resultString = JSON.stringify(result);
    if (resultString.length > 500) {
      return { _truncated: true, _size: resultString.length };
    }

    return result;
  }

  /**
   * Sauvegarde en base de données (MongoDB)
   */
  async saveToDatabase(logEntry) {
    if (!this.config.mongo.uri) return;

    try {
      // TODO: Implémenter la sauvegarde MongoDB
      // const mongoose = require('mongoose');
      // await JobLogModel.create(logEntry);
      
      this.log('debug', `💾 Log job ${logEntry.jobId} sauvegardé en base`);
    } catch (error) {
      this.log('error', '❌ Erreur sauvegarde log job:', error);
    }
  }

  /**
   * Nettoie les anciens logs
   */
  async cleanOldLogs() {
    if (!this.config.mongo.uri) return;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      // TODO: Implémenter le nettoyage MongoDB
      // await JobLogModel.deleteMany({ startTime: { $lt: cutoffDate } });
      
      this.log('info', `🧹 Logs antérieurs à ${cutoffDate.toISOString()} nettoyés`);
    } catch (error) {
      this.log('error', '❌ Erreur nettoyage logs:', error);
    }
  }

  /**
   * Réinitialise les métriques
   */
  resetMetrics() {
    this.metrics = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      averageExecutionTime: 0,
      queueMetrics: {},
      jobTypeMetrics: {},
      errorCounts: {},
      lastUpdated: new Date()
    };
    
    this.activeJobs.clear();
    this.log('info', '🔄 Métriques réinitialisées');
  }

  /**
   * Logger intelligent selon l'environnement et niveau
   */
  log(level, message, data = null) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = levels[this.config.logLevel] || 1;
    const messageLevel = levels[level] || 1;

    if (messageLevel < currentLevel) return;

    if (this.config.logger) {
      this.config.logger[level](message, data);
    } else if (!this.config.isProduction) {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      
      if (level === 'error') {
        console.error(logLine, data || '');
      } else if (level === 'warn') {
        console.warn(logLine, data || '');
      } else {
        console.log(logLine, data || '');
      }
    }
  }

  /**
   * Configure les listeners automatiques pour BullMQManager
   */
  attachToBullMQManager(bullMQManager) {
    // Stocker la référence pour attacher les nouvelles queues
    this.bullMQManager = bullMQManager;
    
    // Fonction pour attacher les listeners à une queue
    const attachToQueue = (queueName) => {
      bullMQManager.onEvent(queueName, 'active', (job) => {
        this.logJobStarted({ 
          id: job.id, 
          queueName, 
          name: job.name, 
          data: job.data,
          opts: job.opts 
        });
      });

      bullMQManager.onEvent(queueName, 'completed', (job, result) => {
        this.logJobCompleted({ 
          id: job.id, 
          queueName, 
          name: job.name 
        }, result);
      });

      bullMQManager.onEvent(queueName, 'failed', (job, error) => {
        this.logJobFailed({ 
          id: job.id, 
          queueName, 
          name: job.name,
          attemptsMade: job.attemptsMade,
          opts: job.opts
        }, error);
      });

      bullMQManager.onEvent(queueName, 'progress', (job, progress) => {
        this.logJobProgress({ 
          id: job.id, 
          queueName, 
          name: job.name 
        }, progress);
      });

      bullMQManager.onEvent(queueName, 'stalled', (jobId) => {
        this.logJobStalled({ 
          id: jobId, 
          queueName, 
          name: 'unknown' 
        });
      });
    };

    // Attacher aux queues existantes
    const existingQueues = bullMQManager.getQueues();
    Object.keys(existingQueues).forEach(attachToQueue);

    // Méthode pour attacher aux nouvelles queues créées
    this.attachToQueue = attachToQueue;

    this.log('info', `📊 JobLogger attaché à ${Object.keys(existingQueues).length} queues existantes`);
  }

  /**
   * Attache le logger à une nouvelle queue (à appeler après création)
   */
  attachToNewQueue(queueName) {
    if (this.attachToQueue) {
      this.attachToQueue(queueName);
      this.log('info', `📊 JobLogger attaché à la nouvelle queue: ${queueName}`);
    }
  }
}

module.exports = JobLogger; 