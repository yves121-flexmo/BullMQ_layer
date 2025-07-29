require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const mongoose = require('mongoose');

// Modules modulaires
const JobHandlers = require('./handlers');
const EmailUtils = require('./email-utils');
const BusinessLogic = require('./business-logic');
const Monitoring = require('./monitoring');

/**
 * ReminderService - Version Lite Modulaire du système de rappels
 * 
 * Service générique couplé au système d'alertes avec architecture modulaire
 * légèrement découplée tout en restant dans l'esprit "lite".
 * 
 * Modules extraits :
 * - JobHandlers : Gestionnaires de tâches
 * - EmailUtils : Utilitaires et templates email
 * - BusinessLogic : Logique métier remboursements
 * - Monitoring : Surveillance et métriques
 */
class ReminderService {
  constructor(config = {}) {
    // Configuration avec variables d'environnement par défaut
    this.config = {
      redis: {
        url: config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379'
      },
      mongo: {
        uri: config.mongo?.uri || process.env.MONGO_URI || null
      },
      isProduction: config.isProduction ?? (process.env.NODE_ENV === 'production'),
      
      // Configuration des queues de rappels
      corporateQueue: config.corporateQueue || 'corporate-reminders',
      coverageQueue: config.coverageQueue || 'coverage-reminders',
      emailQueue: config.emailQueue || 'email-reminders',
      
      // Configuration des cron patterns
      corporateCron: config.corporateCron || '0 9 1-10 * *', // 10 premiers jours du mois à 9h
      coverageCron: config.coverageCron || '0 10 * * *',     // Tous les jours à 10h
      
      // Configuration métier
      corporateTypes: config.corporateTypes || ['PENDING', 'OVERDUE'],
      coverageTypes: config.coverageTypes || ['PENDING', 'OVERDUE'],
      warningDays: config.warningDays || 10,
      
      // Configuration jobs
      maxAttempts: config.maxAttempts || 5,
      concurrency: config.concurrency || 3,
      retryDelays: config.retryDelays || [1000, 5000, 10000, 30000, 60000],
      
      ...config
    };

    // Services externes injectés
    this.reimbursementService = config.reimbursementService;
    this.managerService = config.managerService;
    this.emailService = config.emailService;
    this.alertService = config.alertService;

    // Maps pour les queues, workers et events
    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();
    
    // MongoDB connection
    this.mongoConnected = false;
    
    // Métriques en mémoire
    this.metrics = {
      reminders: { sent: 0, failed: 0, skipped: 0 },
      emails: { sent: 0, failed: 0, processing: 0 },
      jobs: { completed: 0, failed: 0, active: 0 },
      startTime: new Date()
    };

    // Initialisation des modules
    this.jobHandlers = new JobHandlers(this);
    this.emailUtils = EmailUtils; // Classe statique
    this.businessLogic = new BusinessLogic(this);
    this.monitoring = new Monitoring(this);

    this.isInitialized = false;
  }

  /**
   * Initialise le système de reminder et démarre les alertes
   */
  async initialize() {
    try {
      this.log('🚀 Initialisation du ReminderService...');

      // 1. Connexion MongoDB si configurée
      if (this.config.mongo.uri) {
        await this.connectMongoDB();
      }

      // 2. Création des queues
      await this.createQueues();

      // 3. Configuration des handlers via le module
      const handlers = this.jobHandlers.createHandlers();

      // 4. Démarrage des workers
      await this.startWorkers(handlers);

      // 5. Configuration du monitoring et alertes via le module
      this.monitoring.setupMonitoring();

      // 6. Planification des jobs de rappels automatiques
      await this.scheduleReminders();

      this.isInitialized = true;
      this.log('✅ ReminderService initialisé et système d\'alertes démarré');

      return {
        status: 'initialized',
        queues: Array.from(this.queues.keys()),
        mongo: this.mongoConnected,
        startTime: this.metrics.startTime
      };

    } catch (error) {
      this.logError('❌ Erreur initialisation ReminderService:', error);
      throw error;
    }
  }

  /**
   * Connexion MongoDB avec Mongoose
   */
  async connectMongoDB() {
    try {
      await mongoose.connect(this.config.mongo.uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      this.mongoConnected = true;
      this.log('📊 MongoDB connecté pour les logs');
    } catch (error) {
      this.logError('❌ Erreur connexion MongoDB:', error);
    }
  }

  /**
   * Crée toutes les queues nécessaires
   */
  async createQueues() {
    const queueNames = [
      this.config.corporateQueue,
      this.config.coverageQueue,
      this.config.emailQueue
    ];

    const queueOptions = {
      connection: this.config.redis,
      defaultJobOptions: {
        attempts: this.config.maxAttempts,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    };

    for (const queueName of queueNames) {
      const queue = new Queue(queueName, queueOptions);
      this.queues.set(queueName, queue);
      
      // Events pour monitoring
      const queueEvents = new QueueEvents(queueName, { connection: this.config.redis });
      this.queueEvents.set(queueName, queueEvents);
      
      this.log(`✅ Queue "${queueName}" créée`);
    }
  }

  /**
   * Démarre tous les workers
   */
  async startWorkers(handlers) {
    for (const [queueName, queue] of this.queues) {
      const worker = new Worker(queueName, async (job) => {
        const handler = handlers[job.name];
        if (handler) {
          this.metrics.jobs.active++;
          try {
            const result = await handler(job.data, job);
            this.metrics.jobs.active--;
            return result;
          } catch (error) {
            this.metrics.jobs.active--;
            throw error;
          }
        } else {
          throw new Error(`Handler non trouvé pour le job: ${job.name}`);
        }
      }, {
        connection: this.config.redis,
        concurrency: this.config.concurrency
      });

      this.workers.set(queueName, worker);
      this.log(`👷 Worker "${queueName}" démarré`);
    }
  }

  /**
   * Planifie les jobs de rappels automatiques
   */
  async scheduleReminders() {
    const corporateQueue = this.queues.get(this.config.corporateQueue);
    const coverageQueue = this.queues.get(this.config.coverageQueue);

    // Job Corporate automatique
    await corporateQueue.add(
      'process-corporate-reminders',
      { type: 'scheduled', source: 'cron' },
      {
        repeat: { pattern: this.config.corporateCron },
        jobId: 'corporate-reminders-cron'
      }
    );

    // Job Coverage automatique
    await coverageQueue.add(
      'process-coverage-reminders',
      { type: 'scheduled', source: 'cron' },
      {
        repeat: { pattern: this.config.coverageCron },
        jobId: 'coverage-reminders-cron'
      }
    );

    this.log('📅 Rappels automatiques planifiés:');
    this.log(`  - Corporate: ${this.config.corporateCron}`);
    this.log(`  - Coverage: ${this.config.coverageCron}`);
  }

  // === MÉTHODES MÉTIER (DÉLÉGATION AUX MODULES) ===

  /**
   * Traite un remboursement Corporate (délégation)
   */
  async processCorporateReimbursement(reimbursement, currentDate) {
    return await this.businessLogic.processCorporateReimbursement(reimbursement, currentDate);
  }

  /**
   * Traite les remboursements d'une health-coverage (délégation)
   */
  async processCoverageReimbursements(healthCoverageId, reimbursements, currentDate) {
    return await this.businessLogic.processCoverageReimbursements(healthCoverageId, reimbursements, currentDate);
  }

  /**
   * Groupe les remboursements par health-coverage (délégation)
   */
  groupByHealthCoverage(reimbursements) {
    return this.businessLogic.groupByHealthCoverage(reimbursements);
  }

  /**
   * Récupère les destinataires pour un remboursement (délégation)
   */
  async getReimbursementRecipients(reimbursement, type) {
    return await this.businessLogic.getReimbursementRecipients(reimbursement, type);
  }

  /**
   * Retourne le template d'email approprié (délégation)
   */
  getEmailTemplate(emailType, daysInfo) {
    return this.emailUtils.getEmailTemplate(emailType, daysInfo);
  }

  // === MÉTHODES EMAILS GÉNÉRIQUES ===

  /**
   * Envoie un email simple
   */
  async sendEmail(to, subject, content, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const emailData = this.emailUtils.formatEmailData(to, subject, content, options);
    const jobOptions = this.emailUtils.createJobOptions(options);

    return emailQueue.add('send-email', emailData, jobOptions);
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(to, userData, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const emailData = this.emailUtils.prepareWelcomeEmailData(to, userData, options);
    const jobOptions = this.emailUtils.createJobOptions({ priority: 'high', ...options });

    return emailQueue.add('send-welcome', emailData, jobOptions);
  }

  /**
   * Envoie une newsletter
   */
  async sendNewsletter(recipients, newsletterData, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const newsletterEmails = this.emailUtils.prepareNewsletterData(recipients, newsletterData, options);
    const jobs = [];
    
    for (const emailData of newsletterEmails) {
      const jobOptions = this.emailUtils.createJobOptions({ priority: 'low', ...options });
      const job = await emailQueue.add('send-newsletter', emailData, jobOptions);
      jobs.push(job);
    }

    this.log(`📧 Newsletter planifiée pour ${recipients.length} destinataires`);
    return jobs;
  }

  /**
   * Planifie un email récurrent
   */
  async scheduleRecurringEmail(to, subject, content, cronPattern, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const emailData = this.emailUtils.formatEmailData(to, subject, content, options);
    const jobId = this.emailUtils.generateRecurringEmailId(to, subject);

    return emailQueue.add('send-email', emailData, {
      repeat: { pattern: cronPattern },
      jobId: jobId
    });
  }

  /**
   * Rend un template (délégation)
   */
  async renderTemplate(templateName, data) {
    return await this.emailUtils.renderTemplate(templateName, data);
  }

  /**
   * Convertit la priorité en valeur numérique (délégation)
   */
  getPriorityValue(priority) {
    return this.emailUtils.getPriorityValue(priority);
  }

  // === MÉTHODES CONTRÔLE ===

  /**
   * Force l'exécution manuelle des rappels
   */
  async forceReminderExecution(type = 'both') {
    const results = {};

    if (type === 'corporate' || type === 'both') {
      const corporateQueue = this.queues.get(this.config.corporateQueue);
      const job = await corporateQueue.add('process-corporate-reminders', {
        type: 'manual-execution',
        forced: true,
        timestamp: new Date()
      });
      results.corporate = job.id;
    }

    if (type === 'coverage' || type === 'both') {
      const coverageQueue = this.queues.get(this.config.coverageQueue);
      const job = await coverageQueue.add('process-coverage-reminders', {
        type: 'manual-execution',
        forced: true,
        timestamp: new Date()
      });
      results.coverage = job.id;
    }

    this.log(`🔧 Exécution forcée des rappels (${type}):`, results);
    return results;
  }

  /**
   * Récupère les statistiques du service (délégation)
   */
  async getStats() {
    return await this.monitoring.getStats();
  }

  /**
   * Nettoie les anciens jobs (délégation)
   */
  async cleanOldJobs(olderThan = 24 * 60 * 60 * 1000) {
    return await this.monitoring.cleanOldJobs(olderThan);
  }

  /**
   * Vérifie l'état de santé du service (délégation)
   */
  async healthCheck() {
    return await this.monitoring.healthCheck();
  }

  /**
   * Génère un rapport de performance (délégation)
   */
  async generatePerformanceReport(timeframe) {
    return await this.monitoring.generatePerformanceReport(timeframe);
  }

  /**
   * Exporte les métriques Prometheus (délégation)
   */
  getPrometheusMetrics() {
    return this.monitoring.getPrometheusMetrics();
  }

  /**
   * Génère un dashboard HTML (délégation)
   */
  generateDashboardHTML() {
    return this.monitoring.generateDashboardHTML();
  }

  // === MÉTHODES PERSISTANCE (DÉLÉGATION) ===

  /**
   * Sauvegarde les logs d'exécution en MongoDB (délégation)
   */
  async saveExecutionLog(data) {
    return await this.monitoring.saveExecutionLog(data);
  }

  /**
   * Sauvegarde les logs d'emails en MongoDB (délégation)
   */
  async saveEmailLog(emailData) {
    return await this.monitoring.saveEmailLog(emailData);
  }

  // === MÉTHODES UTILITAIRES ===

  /**
   * Logger intelligent selon l'environnement
   */
  log(message, data = null) {
    if (!this.config.isProduction) {
      console.log(message, data || '');
    }
  }

  /**
   * Logger d'erreurs
   */
  logError(message, error) {
    if (!this.config.isProduction) {
      console.error(message, error);
    }
    
    // Toujours logger les erreurs critiques
    if (this.alertService) {
      this.alertService.notifyError(message, error);
    }
  }

  /**
   * Arrêt propre du service
   */
  async shutdown() {
    this.log('🛑 Arrêt du ReminderService...');

    // Arrêt des workers
    for (const [queueName, worker] of this.workers) {
      await worker.close();
      this.log(`✅ Worker "${queueName}" fermé`);
    }

    // Fermeture des queues
    for (const [queueName, queue] of this.queues) {
      await queue.close();
      this.log(`✅ Queue "${queueName}" fermée`);
    }

    // Fermeture des events
    for (const [queueName, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      this.log(`✅ Events "${queueName}" fermés`);
    }

    // Fermeture MongoDB
    if (this.mongoConnected) {
      await mongoose.connection.close();
      this.log('✅ MongoDB déconnecté');
    }

    this.isInitialized = false;
    this.log('✅ ReminderService arrêté proprement');
  }

  // === MÉTHODES AVANCÉES MÉTIER (DÉLÉGATION) ===

  /**
   * Analyse les remboursements par urgence (délégation)
   */
  analyzeReimbursementUrgency(reimbursements, currentDate) {
    return this.businessLogic.analyzeReimbursementUrgency(reimbursements, currentDate);
  }

  /**
   * Calcule les statistiques des remboursements (délégation)
   */
  calculateReimbursementStats(reimbursements, currentDate) {
    return this.businessLogic.calculateReimbursementStats(reimbursements, currentDate);
  }

  /**
   * Génère un résumé exécutif (délégation)
   */
  generateExecutiveSummary(reimbursements, currentDate) {
    return this.businessLogic.generateExecutiveSummary(reimbursements, currentDate);
  }

  /**
   * Filtre les remboursements (délégation)
   */
  filterReimbursements(reimbursements, filters) {
    return this.businessLogic.filterReimbursements(reimbursements, filters);
  }

  /**
   * Trie les remboursements par priorité (délégation)
   */
  sortReimbursementsByPriority(reimbursements, currentDate) {
    return this.businessLogic.sortReimbursementsByPriority(reimbursements, currentDate);
  }

  /**
   * Valide un remboursement (délégation)
   */
  validateReimbursement(reimbursement) {
    return this.businessLogic.validateReimbursement(reimbursement);
  }

  // === MÉTHODES UTILITAIRES EMAIL AVANCÉES (DÉLÉGATION) ===

  /**
   * Valide les données d'email (délégation)
   */
  validateEmailData(emailData) {
    return this.emailUtils.validateEmailData(emailData);
  }

  /**
   * Nettoie et formate les emails (délégation)
   */
  sanitizeEmails(emails) {
    return this.emailUtils.sanitizeEmails(emails);
  }

  /**
   * Génère un rapport d'emails (délégation)
   */
  generateEmailReport(emailResults) {
    return this.emailUtils.generateEmailReport(emailResults);
  }

  /**
   * Calcule le meilleur moment d'envoi (délégation)
   */
  calculateOptimalSendTime(priority, timezone) {
    return this.emailUtils.calculateOptimalSendTime(priority, timezone);
  }
}

module.exports = ReminderService;
