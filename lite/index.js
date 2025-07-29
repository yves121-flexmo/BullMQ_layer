require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const mongoose = require('mongoose');

// Modules modulaires
const JobHandlers = require('./handlers');
const EmailUtils = require('./email-utils');
const BusinessLogic = require('./business-logic');
const Monitoring = require('./monitoring');

/**
 * @fileoverview ReminderService - Version Lite Modulaire du système de rappels
 * 
 * Service générique couplé au système d'alertes avec architecture modulaire
 * légèrement découplée tout en restant dans l'esprit "lite".
 * 
 * Modules extraits :
 * - JobHandlers : Gestionnaires de tâches BullMQ spécialisés
 * - EmailUtils : Utilitaires emails et templates EJS
 * - BusinessLogic : Logique métier remboursements
 * - Monitoring : Surveillance et métriques avec persistance MongoDB
 * 
 * Fonctionnalités principales :
 * - Traitement automatique des rappels Corporate et Coverage
 * - Système d'emails avec templates EJS professionnels
 * - Intégration MongoDB pour la persistance des logs
 * - Monitoring temps réel avec alertes automatiques
 * - API générique pour l'envoi d'emails divers
 * - Dashboard HTML intégré pour le monitoring visuel
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

/**
 * @typedef {Object} ReminderConfig
 * @property {Object} [redis] - Configuration Redis
 * @property {string} [redis.url] - URL de connexion Redis
 * @property {Object} [mongo] - Configuration MongoDB
 * @property {string} [mongo.uri] - URI de connexion MongoDB
 * @property {boolean} [isProduction] - Indicateur environnement production
 * @property {string} [corporateQueue] - Nom de la queue corporate
 * @property {string} [coverageQueue] - Nom de la queue coverage
 * @property {string} [emailQueue] - Nom de la queue email
 * @property {string} [corporateCron] - Pattern cron pour les rappels corporate
 * @property {string} [coverageCron] - Pattern cron pour les rappels coverage
 * @property {Array<string>} [corporateTypes] - Types de remboursements corporate
 * @property {Array<string>} [coverageTypes] - Types de remboursements coverage
 * @property {number} [warningDays] - Jours d'avertissement avant échéance
 * @property {number} [maxAttempts] - Nombre maximum de tentatives
 * @property {number} [concurrency] - Niveau de concurrence des workers
 * @property {Array<number>} [retryDelays] - Délais de retry en millisecondes
 * @property {Object} [reimbursementService] - Service des remboursements injecté
 * @property {Object} [managerService] - Service des managers injecté
 * @property {Object} [emailService] - Service d'envoi d'emails injecté
 * @property {Object} [alertService] - Service d'alertes injecté
 */

/**
 * @typedef {Object} InitializationResult
 * @property {string} status - Statut d'initialisation ('initialized')
 * @property {Array<string>} queues - Liste des noms de queues créées
 * @property {boolean} mongo - État de la connexion MongoDB
 * @property {Date} startTime - Heure de démarrage du service
 */

/**
 * @typedef {Object} ForceExecutionResult
 * @property {string} [corporate] - ID du job corporate créé
 * @property {string} [coverage] - ID du job coverage créé
 */

/**
 * @typedef {Object} EmailJobOptions
 * @property {string} [priority] - Priorité de l'email ('low', 'normal', 'high', 'urgent')
 * @property {number} [delay] - Délai avant envoi en millisecondes
 * @property {number} [attempts] - Nombre de tentatives
 * @property {Object} [backoff] - Configuration de retry
 * @property {number} [removeOnComplete] - Jobs complétés à conserver
 * @property {number} [removeOnFail] - Jobs échoués à conserver
 */

/**
 * @typedef {Object} NewsletterRecipient
 * @property {string} email - Email du destinataire
 * @property {string} name - Nom du destinataire
 * @property {Object} [metadata] - Métadonnées supplémentaires
 */

/**
 * ReminderService - Version Lite Modulaire du système de rappels
 * 
 * Service générique couplé au système d'alertes avec architecture modulaire
 * légèrement découplée tout en restant dans l'esprit "lite".
 * 
 * Cette classe orchestre tous les modules spécialisés :
 * - JobHandlers pour les gestionnaires de tâches BullMQ
 * - EmailUtils pour les utilitaires et templates EJS
 * - BusinessLogic pour la logique métier des remboursements
 * - Monitoring pour la surveillance et les métriques
 * 
 * @class ReminderService
 */
class ReminderService {
  
  /**
   * Crée une instance de ReminderService
   * 
   * @param {ReminderConfig} [config={}] - Configuration du service
   * 
   * @example
   * // Configuration minimale
   * const service = new ReminderService({
   *   redis: { url: 'redis://localhost:6379' },
   *   reimbursementService: mockReimbursementService,
   *   managerService: mockManagerService,
   *   emailService: mockEmailService
   * });
   * 
   * @example
   * // Configuration complète
   * const service = new ReminderService({
   *   redis: { url: process.env.REDIS_URL },
   *   mongo: { uri: process.env.MONGO_URI },
   *   isProduction: process.env.NODE_ENV === 'production',
   *   corporateQueue: 'corporate-reminders',
   *   coverageQueue: 'coverage-reminders',
   *   emailQueue: 'email-reminders',
   *   corporateCron: '0 9 1-10 * *',
   *   coverageCron: '0 10 * * *',
   *   warningDays: 10,
   *   maxAttempts: 5,
   *   concurrency: 3,
   *   reimbursementService: injectedReimbursementService,
   *   managerService: injectedManagerService,
   *   emailService: injectedEmailService,
   *   alertService: injectedAlertService
   * });
   */
  constructor(config = {}) {
    // Configuration avec variables d'environnement par défaut
    /**
     * Configuration complète du service
     * @type {ReminderConfig}
     * @private
     */
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
    /**
     * Service de gestion des remboursements
     * @type {Object}
     * @private
     */
    this.reimbursementService = config.reimbursementService;
    
    /**
     * Service de gestion des managers
     * @type {Object}
     * @private
     */
    this.managerService = config.managerService;
    
    /**
     * Service d'envoi d'emails
     * @type {Object}
     * @private
     */
    this.emailService = config.emailService;
    
    /**
     * Service d'alertes (optionnel)
     * @type {Object|null}
     * @private
     */
    this.alertService = config.alertService;

    // Maps pour les queues, workers et events
    /**
     * Map des queues BullMQ par nom
     * @type {Map<string, Queue>}
     * @private
     */
    this.queues = new Map();
    
    /**
     * Map des workers BullMQ par nom de queue
     * @type {Map<string, Worker>}
     * @private
     */
    this.workers = new Map();
    
    /**
     * Map des événements de queues par nom
     * @type {Map<string, QueueEvents>}
     * @private
     */
    this.queueEvents = new Map();
    
    // MongoDB connection
    /**
     * État de la connexion MongoDB
     * @type {boolean}
     * @private
     */
    this.mongoConnected = false;
    
    // Métriques en mémoire
    /**
     * Métriques en temps réel du service
     * @type {Object}
     * @private
     */
    this.metrics = {
      reminders: { sent: 0, failed: 0, skipped: 0 },
      emails: { sent: 0, failed: 0, processing: 0 },
      jobs: { completed: 0, failed: 0, active: 0 },
      startTime: new Date()
    };

    // Initialisation des modules
    /**
     * Gestionnaire des tâches BullMQ
     * @type {JobHandlers}
     * @private
     */
    this.jobHandlers = new JobHandlers(this);
    
    /**
     * Utilitaires email et templates EJS
     * @type {EmailUtils}
     * @private
     */
    this.emailUtils = EmailUtils; // Classe statique
    
    /**
     * Logique métier des remboursements
     * @type {BusinessLogic}
     * @private
     */
    this.businessLogic = new BusinessLogic(this);
    
    /**
     * Module de monitoring et métriques
     * @type {Monitoring}
     * @private
     */
    this.monitoring = new Monitoring(this);

    /**
     * État d'initialisation du service
     * @type {boolean}
     * @private
     */
    this.isInitialized = false;
  }

  /**
   * Initialise le système de reminder et démarre les alertes
   * 
   * Effectue toutes les étapes d'initialisation nécessaires :
   * - Connexion MongoDB si configurée
   * - Création des queues BullMQ
   * - Configuration des handlers de jobs
   * - Démarrage des workers
   * - Configuration du monitoring et alertes
   * - Planification des jobs automatiques
   * 
   * @async
   * @returns {Promise<InitializationResult>} Résultat de l'initialisation
   * @throws {Error} Si l'initialisation échoue
   * 
   * @example
   * const service = new ReminderService(config);
   * const result = await service.initialize();
   * console.log(`Service initialisé avec ${result.queues.length} queues`);
   * console.log(`MongoDB: ${result.mongo ? 'Connecté' : 'Non configuré'}`);
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
   * 
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Si la connexion échoue
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
   * Crée toutes les queues nécessaires avec leurs options
   * 
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Si la création des queues échoue
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
   * Démarre tous les workers avec les handlers configurés
   * 
   * @private
   * @async
   * @param {Object<string, Function>} handlers - Map des handlers par nom de job
   * @returns {Promise<void>}
   * @throws {Error} Si le démarrage des workers échoue
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
   * Planifie les jobs de rappels automatiques avec cron
   * 
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Si la planification échoue
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
   * Traite un remboursement Corporate (délégation vers BusinessLogic)
   * 
   * @async
   * @param {Object} reimbursement - Remboursement à traiter
   * @param {Date} currentDate - Date actuelle pour les calculs
   * @returns {Promise<Object>} Résultat du traitement
   * 
   * @example
   * const result = await service.processCorporateReimbursement(reimbursement);
   * console.log(`Email ${result.emailType} envoyé à ${result.recipientCount} destinataires`);
   */
  async processCorporateReimbursement(reimbursement, currentDate) {
    return await this.businessLogic.processCorporateReimbursement(reimbursement, currentDate);
  }

  /**
   * Traite les remboursements d'une health-coverage (délégation vers BusinessLogic)
   * 
   * @async
   * @param {string} healthCoverageId - ID de la couverture santé
   * @param {Array} reimbursements - Remboursements à traiter
   * @param {Date} currentDate - Date actuelle pour les calculs
   * @returns {Promise<Object>} Résultat du traitement
   * 
   * @example
   * const result = await service.processCoverageReimbursements('HC-001', reimbursements);
   * console.log(`${result.emailsSent} emails envoyés sur ${result.totalReimbursements}`);
   */
  async processCoverageReimbursements(healthCoverageId, reimbursements, currentDate) {
    return await this.businessLogic.processCoverageReimbursements(healthCoverageId, reimbursements, currentDate);
  }

  /**
   * Groupe les remboursements par health-coverage (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @returns {Object} Remboursements groupés par health-coverage
   * 
   * @example
   * const grouped = service.groupByHealthCoverage(reimbursements);
   * console.log(`${Object.keys(grouped).length} health coverages trouvées`);
   */
  groupByHealthCoverage(reimbursements) {
    return this.businessLogic.groupByHealthCoverage(reimbursements);
  }

  /**
   * Récupère les destinataires pour un remboursement (délégation vers BusinessLogic)
   * 
   * @async
   * @param {Object} reimbursement - Remboursement concerné
   * @param {string} type - Type de traitement ('corporate', 'coverage')
   * @returns {Promise<Array>} Liste des destinataires
   * 
   * @example
   * const recipients = await service.getReimbursementRecipients(reimbursement, 'corporate');
   * console.log(`Envoi à ${recipients.length} destinataires`);
   */
  async getReimbursementRecipients(reimbursement, type) {
    return await this.businessLogic.getReimbursementRecipients(reimbursement, type);
  }

  /**
   * Retourne le template d'email approprié (délégation vers EmailUtils)
   * 
   * @param {string} emailType - Type d'email
   * @param {Object} daysInfo - Informations sur les jours
   * @returns {Object} Template d'email avec sujet et nom de template
   * 
   * @example
   * const template = service.getEmailTemplate('payment-reminder', { remainingDays: 5 });
   * console.log(`Template: ${template.template}, Sujet: ${template.subject}`);
   */
  getEmailTemplate(emailType, daysInfo) {
    return this.emailUtils.getEmailTemplate(emailType, daysInfo);
  }

  // === MÉTHODES EMAILS GÉNÉRIQUES ===

  /**
   * Envoie un email simple avec contenu direct ou template EJS
   * 
   * @async
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @param {string} content - Contenu de l'email
   * @param {EmailJobOptions} [options={}] - Options d'envoi
   * @returns {Promise<Object>} Job BullMQ créé
   * @throws {Error} Si l'envoi échoue
   * 
   * @example
   * // Email simple
   * await service.sendEmail('user@example.com', 'Test', 'Contenu de test');
   * 
   * @example
   * // Email avec template EJS
   * await service.sendEmail('user@example.com', 'Newsletter', null, {
   *   template: 'newsletter',
   *   templateData: { articles: [{ title: 'Article 1' }] },
   *   priority: 'high'
   * });
   */
  async sendEmail(to, subject, content, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const emailData = this.emailUtils.formatEmailData(to, subject, content, options);
    const jobOptions = this.emailUtils.createJobOptions(options);

    return emailQueue.add('send-email', emailData, jobOptions);
  }

  /**
   * Envoie une newsletter à plusieurs destinataires avec template EJS
   * 
   * @async
   * @param {Array<NewsletterRecipient>} recipients - Liste des destinataires
   * @param {Object} newsletterData - Contenu de la newsletter
   * @param {string} newsletterData.subject - Sujet de la newsletter
   * @param {string} [newsletterData.intro] - Introduction
   * @param {Array} [newsletterData.articles] - Articles de la newsletter
   * @param {Object} [newsletterData.stats] - Statistiques du mois
   * @param {Array} [newsletterData.events] - Événements à venir
   * @param {Array} [newsletterData.tips] - Conseils du mois
   * @param {EmailJobOptions} [options={}] - Options d'envoi
   * @returns {Promise<Array<Object>>} Jobs BullMQ créés
   * @throws {Error} Si l'envoi échoue
   * 
   * @example
   * const recipients = [
   *   { email: 'user1@company.com', name: 'Alice' },
   *   { email: 'user2@company.com', name: 'Bob' }
   * ];
   * 
   * const newsletterData = {
   *   subject: 'Newsletter Janvier 2025',
   *   intro: 'Voici les actualités du mois !',
   *   articles: [
   *     { title: 'Nouvelle fonctionnalité', summary: 'Description...' }
   *   ],
   *   stats: { newUsers: 250, activeProjects: 45 }
   * };
   * 
   * const jobs = await service.sendNewsletter(recipients, newsletterData);
   * console.log(`${jobs.length} newsletters planifiées`);
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
   * Planifie un email récurrent avec pattern cron
   * 
   * @async
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @param {string} content - Contenu de l'email
   * @param {string} cronPattern - Pattern cron pour la récurrence
   * @param {EmailJobOptions} [options={}] - Options d'envoi
   * @returns {Promise<Object>} Job BullMQ récurrent créé
   * @throws {Error} Si la planification échoue
   * 
   * @example
   * // Email hebdomadaire tous les lundis à 9h
   * await service.scheduleRecurringEmail(
   *   'team@company.com',
   *   'Rapport hebdomadaire',
   *   'Voici le rapport de la semaine',
   *   '0 9 * * 1'
   * );
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
   * Rend un template EJS avec les données fournies (délégation vers EmailUtils)
   * 
   * @async
   * @param {string} templateName - Nom du template
   * @param {Object} data - Données pour le template
   * @returns {Promise<string>} Contenu HTML rendu
   * @throws {Error} Si le rendu échoue
   * 
   * @example
   * const html = await service.renderTemplate('welcome', {
   *   name: 'Alice',
   *   userData: { role: 'Manager' }
   * });
   * console.log(`HTML généré: ${html.length} caractères`);
   */
  async renderTemplate(templateName, data) {
    return await this.emailUtils.renderTemplate(templateName, data);
  }

  /**
   * Convertit la priorité en valeur numérique (délégation vers EmailUtils)
   * 
   * @param {string} priority - Priorité textuelle
   * @returns {number} Valeur numérique pour BullMQ
   * 
   * @example
   * const priorityValue = service.getPriorityValue('high'); // Retourne 10
   */
  getPriorityValue(priority) {
    return this.emailUtils.getPriorityValue(priority);
  }

  // === MÉTHODES CONTRÔLE ===

  /**
   * Force l'exécution manuelle des rappels
   * 
   * Déclenche immédiatement l'exécution des jobs de rappels sans attendre
   * les planifications cron, utile pour les tests ou les exécutions d'urgence.
   * 
   * @async
   * @param {string} [type='both'] - Type de rappels à exécuter ('corporate', 'coverage', 'both')
   * @returns {Promise<ForceExecutionResult>} IDs des jobs créés
   * @throws {Error} Si l'exécution forcée échoue
   * 
   * @example
   * // Exécuter tous les rappels
   * const result = await service.forceReminderExecution();
   * console.log(`Jobs créés: Corporate=${result.corporate}, Coverage=${result.coverage}`);
   * 
   * @example
   * // Exécuter seulement les rappels corporate
   * const result = await service.forceReminderExecution('corporate');
   * console.log(`Job corporate créé: ${result.corporate}`);
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
   * Récupère les statistiques du service (délégation vers Monitoring)
   * 
   * @async
   * @returns {Promise<Object>} Statistiques complètes du service
   * 
   * @example
   * const stats = await service.getStats();
   * console.log(`Uptime: ${stats.service.uptime}ms`);
   * console.log(`Jobs complétés: ${stats.metrics.jobs.completed}`);
   * Object.entries(stats.queues).forEach(([name, queueStats]) => {
   *   console.log(`${name}: ${queueStats.active} jobs actifs`);
   * });
   */
  async getStats() {
    return await this.monitoring.getStats();
  }

  /**
   * Nettoie les anciens jobs (délégation vers Monitoring)
   * 
   * @async
   * @param {number} [olderThan] - Seuil d'âge en millisecondes
   * @returns {Promise<Object>} Résultat du nettoyage
   * 
   * @example
   * // Nettoyer les jobs de plus de 1 heure
   * const result = await service.cleanOldJobs(60 * 60 * 1000);
   * console.log(`${result.totalCleaned} jobs nettoyés`);
   */
  async cleanOldJobs(olderThan = 24 * 60 * 60 * 1000) {
    return await this.monitoring.cleanOldJobs(olderThan);
  }

  /**
   * Vérifie l'état de santé du service (délégation vers Monitoring)
   * 
   * @async
   * @returns {Promise<Object>} Rapport de santé du système
   * 
   * @example
   * const health = await service.healthCheck();
   * console.log(`Statut: ${health.status}`);
   * if (health.status !== 'healthy') {
   *   console.log('Problèmes:', Object.entries(health.checks)
   *     .filter(([, status]) => !status)
   *     .map(([check]) => check));
   * }
   */
  async healthCheck() {
    return await this.monitoring.healthCheck();
  }

  /**
   * Génère un rapport de performance (délégation vers Monitoring)
   * 
   * @async
   * @param {number} [timeframe] - Période d'analyse en millisecondes
   * @returns {Promise<Object>} Rapport de performance détaillé
   * 
   * @example
   * // Rapport sur les dernières 6 heures
   * const report = await service.generatePerformanceReport(6 * 60 * 60 * 1000);
   * console.log(`Période: ${report.timeframe.durationHours}h`);
   * console.log(`Taux de succès: ${report.metrics.successRate}%`);
   */
  async generatePerformanceReport(timeframe) {
    return await this.monitoring.generatePerformanceReport(timeframe);
  }

  /**
   * Exporte les métriques Prometheus (délégation vers Monitoring)
   * 
   * @returns {string} Métriques formatées pour Prometheus
   * 
   * @example
   * const metrics = service.getPrometheusMetrics();
   * console.log(metrics);
   * // # HELP reminder_service_uptime_seconds Uptime du service en secondes
   * // # TYPE reminder_service_uptime_seconds gauge
   * // reminder_service_uptime_seconds 3600
   */
  getPrometheusMetrics() {
    return this.monitoring.getPrometheusMetrics();
  }

  /**
   * Génère un dashboard HTML (délégation vers Monitoring)
   * 
   * @returns {string} Code HTML du dashboard
   * 
   * @example
   * const html = service.generateDashboardHTML();
   * // Servir via Express
   * app.get('/dashboard', (req, res) => res.send(html));
   */
  generateDashboardHTML() {
    return this.monitoring.generateDashboardHTML();
  }

  // === MÉTHODES PERSISTANCE (DÉLÉGATION) ===

  /**
   * Sauvegarde les logs d'exécution en MongoDB (délégation vers Monitoring)
   * 
   * @async
   * @param {Object} data - Données d'exécution à sauvegarder
   * @returns {Promise<void>}
   * 
   * @example
   * await service.saveExecutionLog({
   *   type: 'corporate',
   *   totalProcessed: 15,
   *   results: [...],
   *   executionDate: new Date()
   * });
   */
  async saveExecutionLog(data) {
    return await this.monitoring.saveExecutionLog(data);
  }

  /**
   * Sauvegarde les logs d'emails en MongoDB (délégation vers Monitoring)
   * 
   * @async
   * @param {Object} emailData - Données d'email à sauvegarder
   * @returns {Promise<void>}
   * 
   * @example
   * await service.saveEmailLog({
   *   emailType: 'payment-reminder',
   *   recipientCount: 3,
   *   reimbursementId: 'RBT-001',
   *   timestamp: new Date()
   * });
   */
  async saveEmailLog(emailData) {
    return await this.monitoring.saveEmailLog(emailData);
  }

  // === MÉTHODES UTILITAIRES ===

  /**
   * Logger intelligent selon l'environnement
   * 
   * N'affiche les logs que si on n'est pas en production, sauf pour les erreurs critiques.
   * 
   * @param {string} message - Message à logger
   * @param {*} [data=null] - Données supplémentaires à afficher
   * @returns {void}
   * 
   * @example
   * service.log('Traitement en cours...', { count: 5 });
   * // Affiché seulement en développement
   */
  log(message, data = null) {
    if (!this.config.isProduction) {
      console.log(message, data || '');
    }
  }

  /**
   * Logger d'erreurs avec alertes automatiques
   * 
   * Affiche toujours les erreurs et déclenche les alertes si configurées.
   * 
   * @param {string} message - Message d'erreur
   * @param {Error} error - Objet erreur
   * @returns {void}
   * 
   * @example
   * service.logError('Erreur lors du traitement:', error);
   * // Toujours affiché + alerte si service configuré
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
   * 
   * Ferme proprement toutes les connexions (workers, queues, events, MongoDB)
   * pour éviter les fuites de ressources.
   * 
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Si l'arrêt échoue
   * 
   * @example
   * // Arrêt gracieux au signal SIGTERM
   * process.on('SIGTERM', async () => {
   *   console.log('Arrêt demandé...');
   *   await service.shutdown();
   *   process.exit(0);
   * });
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
   * Analyse les remboursements par urgence (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Date} currentDate - Date de référence
   * @returns {Object} Analyse d'urgence avec remboursements classés
   * 
   * @example
   * const analysis = service.analyzeReimbursementUrgency(reimbursements);
   * console.log(`${analysis.critical.length} remboursements critiques`);
   */
  analyzeReimbursementUrgency(reimbursements, currentDate) {
    return this.businessLogic.analyzeReimbursementUrgency(reimbursements, currentDate);
  }

  /**
   * Calcule les statistiques des remboursements (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Date} currentDate - Date de référence
   * @returns {Object} Statistiques complètes
   * 
   * @example
   * const stats = service.calculateReimbursementStats(reimbursements);
   * console.log(`Total: ${stats.total}, Montant moyen: ${stats.amounts.average}€`);
   */
  calculateReimbursementStats(reimbursements, currentDate) {
    return this.businessLogic.calculateReimbursementStats(reimbursements, currentDate);
  }

  /**
   * Génère un résumé exécutif (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Date} currentDate - Date de référence
   * @returns {Object} Résumé exécutif avec recommandations
   * 
   * @example
   * const summary = service.generateExecutiveSummary(reimbursements);
   * console.log(`Actions urgentes: ${summary.urgency.totalRequiringAttention}`);
   * summary.recommendations.forEach(r => console.log(`- ${r.message}`));
   */
  generateExecutiveSummary(reimbursements, currentDate) {
    return this.businessLogic.generateExecutiveSummary(reimbursements, currentDate);
  }

  /**
   * Filtre les remboursements (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Object} filters - Critères de filtrage
   * @returns {Array} Remboursements filtrés
   * 
   * @example
   * const filtered = service.filterReimbursements(reimbursements, {
   *   types: ['SALARY'],
   *   minAmount: 1000
   * });
   */
  filterReimbursements(reimbursements, filters) {
    return this.businessLogic.filterReimbursements(reimbursements, filters);
  }

  /**
   * Trie les remboursements par priorité (délégation vers BusinessLogic)
   * 
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Date} currentDate - Date de référence
   * @returns {Array} Remboursements triés par priorité
   * 
   * @example
   * const sorted = service.sortReimbursementsByPriority(reimbursements);
   * console.log('Ordre de traitement:', sorted.map(r => r.id));
   */
  sortReimbursementsByPriority(reimbursements, currentDate) {
    return this.businessLogic.sortReimbursementsByPriority(reimbursements, currentDate);
  }

  /**
   * Valide un remboursement (délégation vers BusinessLogic)
   * 
   * @param {Object} reimbursement - Remboursement à valider
   * @returns {Array<string>} Liste des erreurs de validation
   * 
   * @example
   * const errors = service.validateReimbursement(reimbursement);
   * if (errors.length > 0) console.error('Erreurs:', errors);
   */
  validateReimbursement(reimbursement) {
    return this.businessLogic.validateReimbursement(reimbursement);
  }

  // === MÉTHODES UTILITAIRES EMAIL AVANCÉES (DÉLÉGATION) ===

  /**
   * Valide les données d'email (délégation vers EmailUtils)
   * 
   * @param {Object} emailData - Données d'email à valider
   * @returns {Array<string>} Liste des erreurs de validation
   * 
   * @example
   * const errors = service.validateEmailData(emailData);
   * if (errors.length === 0) console.log('Email valide');
   */
  validateEmailData(emailData) {
    return this.emailUtils.validateEmailData(emailData);
  }

  /**
   * Nettoie et formate les emails (délégation vers EmailUtils)
   * 
   * @param {string|string[]} emails - Email(s) à nettoyer
   * @returns {string[]} Emails nettoyés et dédoublonnés
   * 
   * @example
   * const clean = service.sanitizeEmails([' User@Example.COM ', 'invalid']);
   * console.log('Emails valides:', clean);
   */
  sanitizeEmails(emails) {
    return this.emailUtils.sanitizeEmails(emails);
  }

  /**
   * Génère un rapport d'emails (délégation vers EmailUtils)
   * 
   * @param {Array} emailResults - Résultats des envois
   * @returns {Object} Rapport détaillé
   * 
   * @example
   * const report = service.generateEmailReport(results);
   * console.log(`Taux de succès: ${report.successRate}%`);
   */
  generateEmailReport(emailResults) {
    return this.emailUtils.generateEmailReport(emailResults);
  }

  /**
   * Calcule le meilleur moment d'envoi (délégation vers EmailUtils)
   * 
   * @param {string} priority - Priorité de l'email
   * @param {string} timezone - Fuseau horaire
   * @returns {number} Délai optimal en millisecondes
   * 
   * @example
   * const delay = service.calculateOptimalSendTime('high');
   * console.log(`Délai optimal: ${delay}ms`);
   */
  calculateOptimalSendTime(priority, timezone) {
    return this.emailUtils.calculateOptimalSendTime(priority, timezone);
  }
}

module.exports = ReminderService;
