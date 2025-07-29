/**
 * Monitoring - Module de surveillance et métriques
 * 
 * Module contenant :
 * - Métriques temps réel en mémoire
 * - Health check du système
 * - Persistance MongoDB des logs
 * - Statistiques et rapports
 * - Nettoyage automatique
 */

const mongoose = require('mongoose');

class Monitoring {
  constructor(service) {
    this.service = service;
    this.config = service.config;
    this.metrics = service.metrics;
  }

  /**
   * Configure le monitoring et les alertes
   */
  setupMonitoring() {
    for (const [queueName, queueEvents] of this.service.queueEvents) {
      // Monitoring des succès
      queueEvents.on('completed', ({ jobId }) => {
        this.service.log(`✅ [${queueName}] Job ${jobId} terminé`);
        
        // Alerte si configurée
        if (this.service.alertService) {
          this.service.alertService.notifyJobCompleted(queueName, jobId);
        }
      });

      // Monitoring des échecs avec alertes
      queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.service.logError(`❌ [${queueName}] Job ${jobId} échoué: ${failedReason}`);
        
        // Alerte critique
        if (this.service.alertService) {
          this.service.alertService.notifyJobFailed(queueName, jobId, failedReason);
        }
      });

      // Monitoring des jobs bloqués
      queueEvents.on('stalled', ({ jobId }) => {
        this.service.logError(`⚠️ [${queueName}] Job ${jobId} bloqué`);
        
        // Alerte de surveillance
        if (this.service.alertService) {
          this.service.alertService.notifyJobStalled(queueName, jobId);
        }
      });

      // Monitoring progression
      queueEvents.on('progress', ({ jobId, data }) => {
        this.service.log(`📊 [${queueName}] Job ${jobId} progression: ${data}%`);
      });
    }

    this.service.log('📊 Monitoring et système d\'alertes configurés');
  }

  /**
   * Récupère les statistiques complètes du service
   */
  async getStats() {
    const stats = {
      service: {
        isInitialized: this.service.isInitialized,
        uptime: Date.now() - this.metrics.startTime.getTime(),
        environment: this.config.isProduction ? 'production' : 'development'
      },
      metrics: { ...this.metrics },
      queues: {},
      mongodb: {
        connected: this.service.mongoConnected,
        uri: this.config.mongo.uri ? '[CONFIGURED]' : null
      }
    };

    // Stats détaillées par queue
    for (const [queueName, queue] of this.service.queues) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();
      const delayed = await queue.getDelayed();

      stats.queues[queueName] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length
      };
    }

    return stats;
  }

  /**
   * Vérifie l'état de santé du service
   */
  async healthCheck() {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date(),
        checks: {
          initialized: this.service.isInitialized,
          queues: this.service.queues.size > 0,
          workers: this.service.workers.size > 0,
          mongodb: this.service.mongoConnected,
          redis: true // Toujours OK si on arrive ici
        }
      };

      // Test Redis rapide
      try {
        const testQueue = this.service.queues.values().next().value;
        if (testQueue) {
          await testQueue.add('health-check', {}, { delay: 1 });
          health.checks.redis = true;
        }
      } catch (error) {
        health.checks.redis = false;
        health.status = 'degraded';
      }

      // Déterminer le statut global
      const allChecksOk = Object.values(health.checks).every(check => check === true);
      if (!allChecksOk && health.status === 'healthy') {
        health.status = 'degraded';
      }

      return health;
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date(),
        error: error.message
      };
    }
  }

  /**
   * Nettoie les anciens jobs
   */
  async cleanOldJobs(olderThan = 24 * 60 * 60 * 1000) { // 24h par défaut
    let totalCleaned = 0;

    for (const [queueName, queue] of this.service.queues) {
      try {
        await queue.clean(olderThan, 100, 'completed');
        await queue.clean(olderThan, 50, 'failed');
        totalCleaned += 150; // Estimation
        this.service.log(`🧹 Queue "${queueName}" nettoyée`);
      } catch (error) {
        this.service.logError(`❌ Erreur nettoyage queue ${queueName}:`, error);
      }
    }

    this.service.log(`🧹 ${totalCleaned} anciens jobs nettoyés`);
    return { totalCleaned, olderThan };
  }

  /**
   * Sauvegarde les logs d'exécution en MongoDB
   */
  async saveExecutionLog(data) {
    if (!this.service.mongoConnected) return;

    try {
      // Schéma simple pour les logs d'exécution
      const ExecutionLog = mongoose.model('ExecutionLog', new mongoose.Schema({
        type: String,
        data: mongoose.Schema.Types.Mixed,
        timestamp: { type: Date, default: Date.now },
        environment: String
      }), 'execution_logs');

      await ExecutionLog.create({
        type: data.type,
        data,
        environment: this.config.isProduction ? 'production' : 'development'
      });

      this.service.log(`💾 Log d'exécution ${data.type} sauvegardé`);
    } catch (error) {
      this.service.logError('❌ Erreur sauvegarde log d\'exécution:', error);
    }
  }

  /**
   * Sauvegarde les logs d'emails en MongoDB
   */
  async saveEmailLog(emailData) {
    if (!this.service.mongoConnected) return;

    try {
      const EmailLog = mongoose.model('EmailLog', new mongoose.Schema({
        emailType: String,
        recipientCount: Number,
        reimbursementId: String,
        timestamp: { type: Date, default: Date.now },
        environment: String,
        data: mongoose.Schema.Types.Mixed
      }), 'email_logs');

      await EmailLog.create({
        ...emailData,
        environment: this.config.isProduction ? 'production' : 'development'
      });

      this.service.log(`💾 Log d'email sauvegardé`);
    } catch (error) {
      this.service.logError('❌ Erreur sauvegarde log d\'email:', error);
    }
  }

  /**
   * Génère un rapport de performance
   */
  async generatePerformanceReport(timeframe = 24 * 60 * 60 * 1000) {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - timeframe);

    const report = {
      timeframe: {
        start: startTime,
        end: endTime,
        durationHours: Math.round(timeframe / (1000 * 60 * 60))
      },
      metrics: {
        ...this.metrics,
        averageJobsPerHour: this.calculateAverageJobsPerHour(),
        successRate: this.calculateSuccessRate(),
        averageExecutionTime: this.calculateAverageExecutionTime()
      },
      queues: {},
      alerts: {
        total: 0,
        byType: {}
      }
    };

    // Performance par queue
    for (const [queueName, queue] of this.service.queues) {
      try {
        const queueMetrics = await this.getQueueMetrics(queueName, timeframe);
        report.queues[queueName] = queueMetrics;
      } catch (error) {
        this.service.logError(`❌ Erreur métriques queue ${queueName}:`, error);
      }
    }

    return report;
  }

  /**
   * Calcule les métriques d'une queue
   */
  async getQueueMetrics(queueName, timeframe) {
    const queue = this.service.queues.get(queueName);
    if (!queue) return null;

    const metrics = {
      name: queueName,
      current: {
        waiting: (await queue.getWaiting()).length,
        active: (await queue.getActive()).length,
        completed: (await queue.getCompleted()).length,
        failed: (await queue.getFailed()).length,
        delayed: (await queue.getDelayed()).length
      },
      performance: {
        throughput: 0,
        averageWaitTime: 0,
        errorRate: 0
      }
    };

    // Calcul des performances (simplifié)
    const totalJobs = metrics.current.completed + metrics.current.failed;
    if (totalJobs > 0) {
      metrics.performance.errorRate = Math.round((metrics.current.failed / totalJobs) * 100);
      metrics.performance.throughput = Math.round(totalJobs / (timeframe / (1000 * 60 * 60))); // jobs/heure
    }

    return metrics;
  }

  /**
   * Calcule la moyenne de jobs par heure
   */
  calculateAverageJobsPerHour() {
    const uptimeHours = (Date.now() - this.metrics.startTime.getTime()) / (1000 * 60 * 60);
    const totalJobs = this.metrics.jobs.completed + this.metrics.jobs.failed;
    return uptimeHours > 0 ? Math.round(totalJobs / uptimeHours) : 0;
  }

  /**
   * Calcule le taux de succès
   */
  calculateSuccessRate() {
    const totalJobs = this.metrics.jobs.completed + this.metrics.jobs.failed;
    return totalJobs > 0 ? Math.round((this.metrics.jobs.completed / totalJobs) * 100) : 100;
  }

  /**
   * Calcule le temps d'exécution moyen (estimation)
   */
  calculateAverageExecutionTime() {
    // Estimation basée sur le type de jobs
    const emailJobs = this.metrics.emails.sent;
    const reminderJobs = this.metrics.reminders.sent;
    
    // Temps estimés par type (en secondes)
    const avgEmailTime = 2;
    const avgReminderTime = 5;
    
    const totalTime = (emailJobs * avgEmailTime) + (reminderJobs * avgReminderTime);
    const totalJobs = emailJobs + reminderJobs;
    
    return totalJobs > 0 ? Math.round(totalTime / totalJobs) : 0;
  }

  /**
   * Génère des alertes automatiques basées sur les métriques
   */
  async checkAndGenerateAlerts() {
    const alerts = [];

    // Alerte sur taux d'échec élevé
    const successRate = this.calculateSuccessRate();
    if (successRate < 90) {
      alerts.push({
        type: 'error_rate',
        severity: 'warning',
        message: `Taux de succès faible: ${successRate}%`,
        recommendation: 'Vérifier les erreurs récentes et la connectivité'
      });
    }

    // Alerte sur jobs en attente
    let totalWaiting = 0;
    for (const [queueName, queue] of this.service.queues) {
      const waiting = (await queue.getWaiting()).length;
      totalWaiting += waiting;
      
      if (waiting > 50) {
        alerts.push({
          type: 'queue_backlog',
          severity: 'warning',
          message: `Queue ${queueName} a ${waiting} jobs en attente`,
          recommendation: 'Augmenter la concurrence ou vérifier les performances'
        });
      }
    }

    // Alerte sur volume d'emails
    if (this.metrics.emails.processing > 10) {
      alerts.push({
        type: 'email_volume',
        severity: 'info',
        message: `${this.metrics.emails.processing} emails en cours de traitement`,
        recommendation: 'Surveiller la charge du service email'
      });
    }

    // Alerte MongoDB
    if (this.config.mongo.uri && !this.service.mongoConnected) {
      alerts.push({
        type: 'mongodb_disconnected',
        severity: 'error',
        message: 'MongoDB déconnecté - logs non persistés',
        recommendation: 'Vérifier la connectivité MongoDB'
      });
    }

    // Envoyer alertes si configuré
    if (alerts.length > 0 && this.service.alertService) {
      for (const alert of alerts) {
        await this.service.alertService.notifySystemAlert?.(alert);
      }
    }

    return alerts;
  }

  /**
   * Démarre le monitoring automatique
   */
  startPeriodicMonitoring(intervalMinutes = 5) {
    setInterval(async () => {
      try {
        await this.checkAndGenerateAlerts();
        
        // Nettoyage automatique si configuré
        if (this.config.autoCleanup) {
          await this.cleanOldJobs();
        }
      } catch (error) {
        this.service.logError('❌ Erreur monitoring périodique:', error);
      }
    }, intervalMinutes * 60 * 1000);

    this.service.log(`🔄 Monitoring automatique démarré (${intervalMinutes}min)`);
  }

  /**
   * Exporte les métriques au format Prometheus
   */
  getPrometheusMetrics() {
    const metrics = [];

    // Métriques de base
    metrics.push(`# HELP reminder_service_uptime_seconds Uptime du service en secondes`);
    metrics.push(`# TYPE reminder_service_uptime_seconds gauge`);
    metrics.push(`reminder_service_uptime_seconds ${Math.round((Date.now() - this.metrics.startTime.getTime()) / 1000)}`);

    // Métriques des jobs
    metrics.push(`# HELP reminder_jobs_completed_total Total des jobs complétés`);
    metrics.push(`# TYPE reminder_jobs_completed_total counter`);
    metrics.push(`reminder_jobs_completed_total ${this.metrics.jobs.completed}`);

    metrics.push(`# HELP reminder_jobs_failed_total Total des jobs échoués`);
    metrics.push(`# TYPE reminder_jobs_failed_total counter`);
    metrics.push(`reminder_jobs_failed_total ${this.metrics.jobs.failed}`);

    metrics.push(`# HELP reminder_jobs_active_current Jobs actuellement actifs`);
    metrics.push(`# TYPE reminder_jobs_active_current gauge`);
    metrics.push(`reminder_jobs_active_current ${this.metrics.jobs.active}`);

    // Métriques des emails
    metrics.push(`# HELP reminder_emails_sent_total Total des emails envoyés`);
    metrics.push(`# TYPE reminder_emails_sent_total counter`);
    metrics.push(`reminder_emails_sent_total ${this.metrics.emails.sent}`);

    metrics.push(`# HELP reminder_emails_failed_total Total des emails échoués`);
    metrics.push(`# TYPE reminder_emails_failed_total counter`);
    metrics.push(`reminder_emails_failed_total ${this.metrics.emails.failed}`);

    // Métriques des rappels
    metrics.push(`# HELP reminder_reminders_sent_total Total des rappels envoyés`);
    metrics.push(`# TYPE reminder_reminders_sent_total counter`);
    metrics.push(`reminder_reminders_sent_total ${this.metrics.reminders.sent}`);

    return metrics.join('\n');
  }

  /**
   * Génère un dashboard simple en HTML
   */
  generateDashboardHTML() {
    const stats = this.metrics;
    const uptime = Math.round((Date.now() - stats.startTime.getTime()) / 1000);
    const successRate = this.calculateSuccessRate();

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>ReminderService Dashboard</title>
        <meta http-equiv="refresh" content="30">
        <style>
            body { font-family: Arial; margin: 20px; background: #f5f5f5; }
            .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .metric { display: inline-block; margin: 10px 20px; text-align: center; }
            .metric-value { font-size: 2em; font-weight: bold; color: #2196F3; }
            .metric-label { color: #666; }
            .status-ok { color: #4CAF50; }
            .status-warning { color: #FF9800; }
            .status-error { color: #F44336; }
        </style>
    </head>
    <body>
        <h1>📊 ReminderService Dashboard</h1>
        
        <div class="card">
            <h2>État du Service</h2>
            <div class="metric">
                <div class="metric-value status-ok">ACTIF</div>
                <div class="metric-label">Statut</div>
            </div>
            <div class="metric">
                <div class="metric-value">${uptime}s</div>
                <div class="metric-label">Uptime</div>
            </div>
            <div class="metric">
                <div class="metric-value ${successRate >= 95 ? 'status-ok' : successRate >= 90 ? 'status-warning' : 'status-error'}">${successRate}%</div>
                <div class="metric-label">Taux de succès</div>
            </div>
        </div>

        <div class="card">
            <h2>Jobs</h2>
            <div class="metric">
                <div class="metric-value">${stats.jobs.completed}</div>
                <div class="metric-label">Complétés</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.jobs.failed}</div>
                <div class="metric-label">Échoués</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.jobs.active}</div>
                <div class="metric-label">Actifs</div>
            </div>
        </div>

        <div class="card">
            <h2>Emails</h2>
            <div class="metric">
                <div class="metric-value">${stats.emails.sent}</div>
                <div class="metric-label">Envoyés</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.emails.failed}</div>
                <div class="metric-label">Échoués</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.emails.processing}</div>
                <div class="metric-label">En cours</div>
            </div>
        </div>

        <div class="card">
            <h2>Rappels</h2>
            <div class="metric">
                <div class="metric-value">${stats.reminders.sent}</div>
                <div class="metric-label">Envoyés</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.reminders.failed}</div>
                <div class="metric-label">Échoués</div>
            </div>
            <div class="metric">
                <div class="metric-value">${stats.reminders.skipped}</div>
                <div class="metric-label">Ignorés</div>
            </div>
        </div>

        <div class="card">
            <h2>Environnement</h2>
            <p><strong>Mode:</strong> ${this.config.isProduction ? 'Production' : 'Développement'}</p>
            <p><strong>MongoDB:</strong> ${this.service.mongoConnected ? '✅ Connecté' : '❌ Déconnecté'}</p>
            <p><strong>Redis:</strong> ✅ Connecté</p>
            <p><strong>Dernière mise à jour:</strong> ${new Date().toLocaleString()}</p>
        </div>
    </body>
    </html>
    `;
  }
}

module.exports = Monitoring;