/**
 * @fileoverview Monitoring - Module de surveillance et métriques
 * 
 * Module contenant :
 * - Métriques temps réel en mémoire avec persistance MongoDB
 * - Health check du système et surveillance des composants
 * - Statistiques et rapports de performance détaillés
 * - Nettoyage automatique des anciens jobs
 * - Génération d'alertes automatiques basées sur les seuils
 * - Export des métriques au format Prometheus
 * - Dashboard HTML intégré pour le monitoring visuel
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

const mongoose = require('mongoose');

/**
 * @typedef {Object} ServiceStats
 * @property {Object} service - Informations générales du service
 * @property {boolean} service.isInitialized - État d'initialisation
 * @property {number} service.uptime - Temps de fonctionnement en millisecondes
 * @property {string} service.environment - Environnement ('production', 'development')
 * @property {Object} metrics - Métriques en temps réel
 * @property {Object<string, QueueStats>} queues - Statistiques par queue
 * @property {Object} mongodb - État de la connexion MongoDB
 */

/**
 * @typedef {Object} QueueStats
 * @property {number} waiting - Nombre de jobs en attente
 * @property {number} active - Nombre de jobs actifs
 * @property {number} completed - Nombre de jobs complétés
 * @property {number} failed - Nombre de jobs échoués
 * @property {number} delayed - Nombre de jobs retardés
 */

/**
 * @typedef {Object} HealthCheck
 * @property {string} status - État de santé ('healthy', 'degraded', 'unhealthy')
 * @property {Date} timestamp - Timestamp du check
 * @property {Object<string, boolean>} checks - Résultats des vérifications individuelles
 * @property {string} [error] - Message d'erreur si unhealthy
 */

/**
 * @typedef {Object} QueueMetrics
 * @property {string} name - Nom de la queue
 * @property {Object} current - Métriques actuelles
 * @property {Object} performance - Métriques de performance
 * @property {number} performance.throughput - Jobs traités par heure
 * @property {number} performance.averageWaitTime - Temps d'attente moyen
 * @property {number} performance.errorRate - Taux d'erreur en pourcentage
 */

/**
 * @typedef {Object} PerformanceReport
 * @property {Object} timeframe - Période d'analyse
 * @property {Date} timeframe.start - Date de début
 * @property {Date} timeframe.end - Date de fin
 * @property {number} timeframe.durationHours - Durée en heures
 * @property {Object} metrics - Métriques générales
 * @property {Object<string, QueueMetrics>} queues - Métriques par queue
 * @property {Object} alerts - Statistiques des alertes
 */

/**
 * @typedef {Object} SystemAlert
 * @property {string} type - Type d'alerte ('error_rate', 'queue_backlog', 'email_volume', 'mongodb_disconnected')
 * @property {string} severity - Sévérité ('info', 'warning', 'error')
 * @property {string} message - Message descriptif
 * @property {string} recommendation - Recommandation d'action
 * @property {Date} [timestamp] - Timestamp de l'alerte
 */

/**
 * @typedef {Object} CleanupResult
 * @property {number} totalCleaned - Nombre total de jobs nettoyés
 * @property {number} olderThan - Seuil d'âge en millisecondes
 * @property {Array<string>} cleanedQueues - Noms des queues nettoyées
 * @property {Object<string, number>} detailsByQueue - Détails par queue
 */

/**
 * Monitoring - Classe de surveillance et métriques pour ReminderService
 * 
 * Cette classe centralise toutes les fonctionnalités de monitoring, surveillance
 * et génération de rapports. Elle gère les métriques en temps réel, la persistance
 * MongoDB, les alertes automatiques et l'export de données.
 * 
 * @class Monitoring
 */
class Monitoring {
  
  /**
   * Crée une instance de Monitoring
   * 
   * @param {Object} service - Instance du ReminderService principal
   * @param {Object} service.config - Configuration du service
   * @param {boolean} service.config.isProduction - Indicateur environnement production
   * @param {Object} service.config.mongo - Configuration MongoDB
   * @param {Object} service.metrics - Métriques en temps réel
   * @param {Date} service.metrics.startTime - Heure de démarrage du service
   * @param {Function} service.log - Fonction de logging
   * @param {Function} service.logError - Fonction de logging d'erreurs
   * @param {Map} service.queues - Map des queues BullMQ
   * @param {Map} service.queueEvents - Map des événements de queues
   * @param {boolean} service.mongoConnected - État connexion MongoDB
   * @param {Object} [service.alertService] - Service d'alertes optionnel
   */
  constructor(service) {
    /**
     * Instance du service principal
     * @type {Object}
     * @private
     */
    this.service = service;
    
    /**
     * Configuration du service
     * @type {Object}
     * @private
     */
    this.config = service.config;
    
    /**
     * Métriques en temps réel
     * @type {Object}
     * @private
     */
    this.metrics = service.metrics;
  }

  /**
   * Configure le monitoring et les alertes pour toutes les queues
   * 
   * Met en place les listeners d'événements BullMQ pour surveiller
   * l'état des jobs et déclencher les alertes appropriées.
   * 
   * @returns {void}
   * 
   * @example
   * const monitoring = new Monitoring(service);
   * monitoring.setupMonitoring();
   * // Les événements BullMQ sont maintenant surveillés
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
   * 
   * Collecte toutes les métriques disponibles incluant l'état du service,
   * les statistiques par queue, et l'état des connexions externes.
   * 
   * @async
   * @returns {Promise<ServiceStats>} Statistiques complètes du service
   * @throws {Error} Si la récupération des statistiques échoue
   * 
   * @example
   * const stats = await monitoring.getStats();
   * console.log(`Uptime: ${stats.service.uptime}ms`);
   * console.log(`Queues actives: ${Object.keys(stats.queues).length}`);
   * Object.entries(stats.queues).forEach(([name, queueStats]) => {
   *   console.log(`${name}: ${queueStats.active} jobs actifs`);
   * });
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
   * Vérifie l'état de santé complet du service
   * 
   * Effectue une série de vérifications sur tous les composants critiques
   * et retourne un rapport de santé détaillé.
   * 
   * @async
   * @returns {Promise<HealthCheck>} Rapport de santé du système
   * 
   * @example
   * const health = await monitoring.healthCheck();
   * console.log(`Statut global: ${health.status}`);
   * 
   * if (health.status !== 'healthy') {
   *   console.log('Problèmes détectés:');
   *   Object.entries(health.checks).forEach(([check, status]) => {
   *     if (!status) console.log(`- ${check}: ÉCHEC`);
   *   });
   * }
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
   * Nettoie les anciens jobs de toutes les queues
   * 
   * Supprime les jobs complétés et échoués plus anciens que le seuil spécifié
   * pour maintenir des performances optimales.
   * 
   * @async
   * @param {number} [olderThan=86400000] - Seuil d'âge en millisecondes (24h par défaut)
   * @returns {Promise<CleanupResult>} Résultat du nettoyage
   * @throws {Error} Si le nettoyage échoue
   * 
   * @example
   * // Nettoyer les jobs de plus de 1 heure
   * const result = await monitoring.cleanOldJobs(60 * 60 * 1000);
   * console.log(`${result.totalCleaned} jobs nettoyés`);
   * 
   * @example
   * // Nettoyage par défaut (24h)
   * const result = await monitoring.cleanOldJobs();
   * result.cleanedQueues.forEach(queueName => {
   *   console.log(`Queue ${queueName}: ${result.detailsByQueue[queueName]} jobs nettoyés`);
   * });
   */
  async cleanOldJobs(olderThan = 24 * 60 * 60 * 1000) { // 24h par défaut
    let totalCleaned = 0;
    const cleanedQueues = [];
    const detailsByQueue = {};

    for (const [queueName, queue] of this.service.queues) {
      try {
        const completedCleaned = await queue.clean(olderThan, 100, 'completed');
        const failedCleaned = await queue.clean(olderThan, 50, 'failed');
        const queueTotal = completedCleaned.length + failedCleaned.length;
        
        totalCleaned += queueTotal;
        cleanedQueues.push(queueName);
        detailsByQueue[queueName] = queueTotal;
        
        this.service.log(`🧹 Queue "${queueName}" nettoyée: ${queueTotal} jobs`);
      } catch (error) {
        this.service.logError(`❌ Erreur nettoyage queue ${queueName}:`, error);
      }
    }

    this.service.log(`🧹 ${totalCleaned} anciens jobs nettoyés au total`);
    
    return { 
      totalCleaned, 
      olderThan, 
      cleanedQueues, 
      detailsByQueue 
    };
  }

  /**
   * Sauvegarde les logs d'exécution en MongoDB
   * 
   * Persiste les logs d'exécution des jobs de rappels avec toutes les
   * métadonnées nécessaires pour l'analyse et le reporting.
   * 
   * @async
   * @param {Object} data - Données d'exécution à sauvegarder
   * @param {string} data.type - Type d'exécution ('corporate', 'coverage')
   * @param {number} data.totalProcessed - Nombre d'éléments traités
   * @param {Array} data.results - Résultats détaillés
   * @param {Date} data.executionDate - Date d'exécution
   * @returns {Promise<void>}
   * @throws {Error} Si la sauvegarde échoue
   * 
   * @example
   * const executionData = {
   *   type: 'corporate',
   *   totalProcessed: 15,
   *   results: [...],
   *   executionDate: new Date()
   * };
   * await monitoring.saveExecutionLog(executionData);
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
   * 
   * Persiste les informations d'envoi d'emails pour le suivi et l'analyse
   * des performances du système de notification.
   * 
   * @async
   * @param {Object} emailData - Données d'email à sauvegarder
   * @param {string} emailData.emailType - Type d'email envoyé
   * @param {number} emailData.recipientCount - Nombre de destinataires
   * @param {string} emailData.reimbursementId - ID du remboursement concerné
   * @param {Date} emailData.timestamp - Timestamp d'envoi
   * @returns {Promise<void>}
   * @throws {Error} Si la sauvegarde échoue
   * 
   * @example
   * const emailData = {
   *   emailType: 'payment-reminder',
   *   recipientCount: 3,
   *   reimbursementId: 'RBT-001',
   *   timestamp: new Date()
   * };
   * await monitoring.saveEmailLog(emailData);
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
   * Génère un rapport de performance détaillé
   * 
   * Analyse les performances du système sur une période donnée
   * et génère un rapport complet avec métriques et recommandations.
   * 
   * @async
   * @param {number} [timeframe=86400000] - Période d'analyse en millisecondes (24h par défaut)
   * @returns {Promise<PerformanceReport>} Rapport de performance complet
   * @throws {Error} Si la génération du rapport échoue
   * 
   * @example
   * // Rapport sur les dernières 6 heures
   * const report = await monitoring.generatePerformanceReport(6 * 60 * 60 * 1000);
   * console.log(`Période: ${report.timeframe.durationHours}h`);
   * console.log(`Taux de succès: ${report.metrics.successRate}%`);
   * console.log(`Jobs/heure: ${report.metrics.averageJobsPerHour}`);
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
   * Calcule les métriques détaillées d'une queue spécifique
   * 
   * @private
   * @async
   * @param {string} queueName - Nom de la queue
   * @param {number} timeframe - Période d'analyse en millisecondes
   * @returns {Promise<QueueMetrics|null>} Métriques de la queue
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
   * Calcule la moyenne de jobs traités par heure
   * 
   * @private
   * @returns {number} Nombre moyen de jobs par heure
   */
  calculateAverageJobsPerHour() {
    const uptimeHours = (Date.now() - this.metrics.startTime.getTime()) / (1000 * 60 * 60);
    const totalJobs = this.metrics.jobs.completed + this.metrics.jobs.failed;
    return uptimeHours > 0 ? Math.round(totalJobs / uptimeHours) : 0;
  }

  /**
   * Calcule le taux de succès global
   * 
   * @private
   * @returns {number} Taux de succès en pourcentage
   */
  calculateSuccessRate() {
    const totalJobs = this.metrics.jobs.completed + this.metrics.jobs.failed;
    return totalJobs > 0 ? Math.round((this.metrics.jobs.completed / totalJobs) * 100) : 100;
  }

  /**
   * Calcule le temps d'exécution moyen estimé
   * 
   * @private
   * @returns {number} Temps d'exécution moyen en secondes
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
   * Génère et vérifie les alertes automatiques basées sur les métriques
   * 
   * Analyse les métriques actuelles et génère des alertes si des seuils
   * critiques sont dépassés.
   * 
   * @async
   * @returns {Promise<Array<SystemAlert>>} Liste des alertes générées
   * 
   * @example
   * const alerts = await monitoring.checkAndGenerateAlerts();
   * alerts.forEach(alert => {
   *   console.log(`[${alert.severity.toUpperCase()}] ${alert.message}`);
   *   console.log(`Recommandation: ${alert.recommendation}`);
   * });
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
   * Démarre le monitoring automatique périodique
   * 
   * Lance une surveillance automatique qui vérifie les alertes et
   * effectue le nettoyage à intervalles réguliers.
   * 
   * @param {number} [intervalMinutes=5] - Intervalle en minutes entre les vérifications
   * @returns {void}
   * 
   * @example
   * // Monitoring toutes les 10 minutes
   * monitoring.startPeriodicMonitoring(10);
   * 
   * @example
   * // Monitoring par défaut (5 minutes)
   * monitoring.startPeriodicMonitoring();
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
   * 
   * Génère une chaîne de métriques compatible avec Prometheus
   * pour l'intégration dans des systèmes de monitoring externes.
   * 
   * @returns {string} Métriques formatées pour Prometheus
   * 
   * @example
   * const prometheusMetrics = monitoring.getPrometheusMetrics();
   * console.log(prometheusMetrics);
   * // # HELP reminder_service_uptime_seconds Uptime du service en secondes
   * // # TYPE reminder_service_uptime_seconds gauge
   * // reminder_service_uptime_seconds 3600
   * // ...
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
   * Génère un dashboard HTML simple pour le monitoring visuel
   * 
   * Crée une page HTML avec les métriques principales et un rafraîchissement
   * automatique pour le monitoring en temps réel.
   * 
   * @returns {string} Code HTML du dashboard
   * 
   * @example
   * const dashboardHtml = monitoring.generateDashboardHTML();
   * 
   * // Servir le dashboard via Express
   * app.get('/dashboard', (req, res) => {
   *   res.send(dashboardHtml);
   * });
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