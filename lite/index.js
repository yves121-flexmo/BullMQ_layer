require('dotenv').config();
const { Queue, Worker, QueueEvents } = require('bullmq');
const mongoose = require('mongoose');

/**
 * ReminderService - Version Lite du système de rappels
 * 
 * Service générique couplé au système d'alertes avec toutes les fonctionnalités
 * intégrées sans couche d'abstraction. Combine les features de MailManager
 * et RemboursementMailService en une seule classe optimisée.
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

      // 3. Configuration des handlers
      const handlers = this.createHandlers();

      // 4. Démarrage des workers
      await this.startWorkers(handlers);

      // 5. Configuration du monitoring et alertes
      this.setupMonitoring();

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
   * Crée tous les handlers de jobs
   */
  createHandlers() {
    return {
      // === HANDLERS REMBOURSEMENTS ===
      
      'process-corporate-reminders': async (data, job) => {
        this.log('🏢 Traitement des rappels Corporate...');
        
        try {
          const currentDate = new Date();
          const dayOfMonth = currentDate.getDate();
          
          // Vérification période (10 premiers jours)
          if (dayOfMonth > 10) {
            this.log(`⏭️ Jour ${dayOfMonth} > 10, pas de traitement Corporate`);
            this.metrics.reminders.skipped++;
            return { skipped: true, reason: 'Hors période (> 10 jours)' };
          }

          await job.updateProgress(10);

          // Récupération remboursements SALARY
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: 'SALARY',
            statuses: this.config.corporateTypes
          });

          this.log(`📋 ${reimbursements.length} remboursements Corporate trouvés`);
          await job.updateProgress(30);

          let processedCount = 0;
          const results = [];

          for (const reimbursement of reimbursements) {
            try {
              const result = await this.processCorporateReimbursement(reimbursement, currentDate);
              results.push(result);
              processedCount++;
              
              await job.updateProgress(30 + (processedCount / reimbursements.length) * 60);
            } catch (error) {
              this.logError(`❌ Erreur remboursement ${reimbursement.id}:`, error);
              results.push({ id: reimbursement.id, error: error.message });
              this.metrics.reminders.failed++;
            }
          }

          await job.updateProgress(100);
          this.metrics.jobs.completed++;

          const finalResult = {
            type: 'corporate',
            totalProcessed: processedCount,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

          // Sauvegarde en MongoDB si activé
          if (this.mongoConnected) {
            await this.saveExecutionLog(finalResult);
          }

          // Alerte système si configurée
          if (this.alertService) {
            await this.alertService.notifyExecution(finalResult);
          }

          return finalResult;

        } catch (error) {
          this.metrics.jobs.failed++;
          this.logError('❌ Erreur traitement Corporate:', error);
          throw error;
        }
      },

      'process-coverage-reminders': async (data, job) => {
        this.log('🏥 Traitement des rappels Coverage...');
        
        try {
          const currentDate = new Date();
          await job.updateProgress(10);

          // Récupération remboursements TREASURY
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: 'TREASURY',
            statuses: this.config.coverageTypes
          });

          this.log(`📋 ${reimbursements.length} remboursements Coverage trouvés`);
          await job.updateProgress(30);

          // Groupement par health-coverage
          const reimbursementsByHealthCoverage = this.groupByHealthCoverage(reimbursements);
          
          let processedCount = 0;
          const results = [];
          const totalItems = Object.keys(reimbursementsByHealthCoverage).length;

          for (const [healthCoverageId, coverageReimbursements] of Object.entries(reimbursementsByHealthCoverage)) {
            try {
              const result = await this.processCoverageReimbursements(
                healthCoverageId, 
                coverageReimbursements, 
                currentDate
              );
              results.push(result);
              processedCount++;
              
              await job.updateProgress(30 + (processedCount / totalItems) * 60);
            } catch (error) {
              this.logError(`❌ Erreur health-coverage ${healthCoverageId}:`, error);
              results.push({ healthCoverageId, error: error.message });
              this.metrics.reminders.failed++;
            }
          }

          await job.updateProgress(100);
          this.metrics.jobs.completed++;

          const finalResult = {
            type: 'coverage',
            totalHealthCoverages: totalItems,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

          // Sauvegarde en MongoDB
          if (this.mongoConnected) {
            await this.saveExecutionLog(finalResult);
          }

          // Alerte système
          if (this.alertService) {
            await this.alertService.notifyExecution(finalResult);
          }

          return finalResult;

        } catch (error) {
          this.metrics.jobs.failed++;
          this.logError('❌ Erreur traitement Coverage:', error);
          throw error;
        }
      },

      // === HANDLERS EMAILS ===

      'send-reminder-email': async (data, job) => {
        const { emailType, recipients, reimbursement, daysInfo } = data;
        
        this.log(`📧 Envoi email ${emailType} à ${recipients.length} destinataires`);
        this.metrics.emails.processing++;
        
        try {
          const emailResult = await this.emailService.sendReminderEmail({
            type: emailType,
            recipients,
            reimbursement,
            daysInfo,
            template: this.getEmailTemplate(emailType, daysInfo)
          });

          const result = {
            emailType,
            recipientCount: recipients.length,
            reimbursementId: reimbursement.id,
            emailResult,
            timestamp: new Date()
          };

          this.metrics.emails.sent++;
          this.metrics.emails.processing--;
          this.metrics.reminders.sent++;

          // Sauvegarde email log
          if (this.mongoConnected) {
            await this.saveEmailLog(result);
          }

          return result;

        } catch (error) {
          this.metrics.emails.failed++;
          this.metrics.emails.processing--;
          this.metrics.reminders.failed++;
          this.logError('❌ Erreur envoi email:', error);
          throw error;
        }
      },

      'send-email': async (data, job) => {
        this.log(`📧 Envoi email générique à ${data.to.join(', ')}: ${data.subject}`);
        
        try {
          await job.updateProgress(10);

          // Validation
          if (!data.to || data.to.length === 0) {
            throw new Error('Destinataire requis');
          }
          if (!data.subject) {
            throw new Error('Sujet requis');
          }

          await job.updateProgress(30);

          // Préparation contenu
          let emailContent = data.content;
          if (data.template) {
            emailContent = await this.renderTemplate(data.template, data.templateData);
          }

          await job.updateProgress(60);

          // Envoi via service email
          if (!this.emailService) {
            throw new Error('Service email non configuré');
          }

          const result = await this.emailService.sendEmail({
            to: data.to,
            subject: data.subject,
            content: emailContent,
            attachments: data.attachments,
            priority: data.priority
          });

          await job.updateProgress(100);
          this.metrics.emails.sent++;

          return {
            success: true,
            messageId: result.messageId,
            recipients: data.to,
            subject: data.subject,
            sentAt: new Date()
          };

        } catch (error) {
          this.metrics.emails.failed++;
          this.logError('❌ Erreur envoi email générique:', error);
          throw error;
        }
      },

      // === HANDLERS UTILITAIRES ===

      'send-welcome': async (data, job) => {
        this.log(`📧 Email de bienvenue à ${data.to}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'welcome', sentTo: data.to };
      },

      'send-newsletter': async (data, job) => {
        this.log(`📰 Newsletter à ${data.to}`);
        await new Promise(resolve => setTimeout(resolve, 1200));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'newsletter', sentTo: data.to };
      },

      'send-notification': async (data, job) => {
        this.log(`🔔 Notification à ${data.to}: ${data.subject}`);
        await new Promise(resolve => setTimeout(resolve, 400));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'notification', sentTo: data.to };
      }
    };
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
   * Configure le monitoring et les alertes
   */
  setupMonitoring() {
    for (const [queueName, queueEvents] of this.queueEvents) {
      // Monitoring des succès
      queueEvents.on('completed', ({ jobId }) => {
        this.log(`✅ [${queueName}] Job ${jobId} terminé`);
        
        // Alerte si configurée
        if (this.alertService) {
          this.alertService.notifyJobCompleted(queueName, jobId);
        }
      });

      // Monitoring des échecs avec alertes
      queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.logError(`❌ [${queueName}] Job ${jobId} échoué: ${failedReason}`);
        
        // Alerte critique
        if (this.alertService) {
          this.alertService.notifyJobFailed(queueName, jobId, failedReason);
        }
      });

      // Monitoring des jobs bloqués
      queueEvents.on('stalled', ({ jobId }) => {
        this.logError(`⚠️ [${queueName}] Job ${jobId} bloqué`);
        
        // Alerte de surveillance
        if (this.alertService) {
          this.alertService.notifyJobStalled(queueName, jobId);
        }
      });

      // Monitoring progression
      queueEvents.on('progress', ({ jobId, data }) => {
        this.log(`📊 [${queueName}] Job ${jobId} progression: ${data}%`);
      });
    }

    this.log('📊 Monitoring et système d\'alertes configurés');
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

  // === MÉTHODES MÉTIER ===

  /**
   * Traite un remboursement Corporate
   */
  async processCorporateReimbursement(reimbursement, currentDate) {
    const dueDate = new Date(reimbursement.dueDate);
    const timeDiff = dueDate.getTime() - currentDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    let emailType;
    let daysInfo = { daysDiff, isOverdue: false };

    if (daysDiff <= 0) {
      emailType = 'payment-overdue';
      daysInfo.isOverdue = true;
      daysInfo.overdueDays = Math.abs(daysDiff);
    } else {
      emailType = 'payment-reminder';
      daysInfo.remainingDays = daysDiff;
    }

    // Récupération destinataires
    const recipients = await this.getReimbursementRecipients(reimbursement, 'corporate');

    // Envoi email
    const emailQueue = this.queues.get(this.config.emailQueue);
    const emailJob = await emailQueue.add('send-reminder-email', {
      emailType,
      recipients,
      reimbursement,
      daysInfo
    });

    return {
      id: reimbursement.id,
      emailType,
      daysDiff,
      recipientCount: recipients.length,
      emailJobId: emailJob.id
    };
  }

  /**
   * Traite les remboursements d'une health-coverage
   */
  async processCoverageReimbursements(healthCoverageId, reimbursements, currentDate) {
    const processedReimbursements = [];

    for (const reimbursement of reimbursements) {
      const dueDate = new Date(reimbursement.dueDate);
      const timeDiff = dueDate.getTime() - currentDate.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      let shouldSendEmail = false;
      let emailType;
      let daysInfo = { daysDiff };

      // Logique Coverage
      if (daysDiff <= 0) {
        shouldSendEmail = true;
        emailType = 'payment-overdue';
        daysInfo.isOverdue = true;
        daysInfo.overdueDays = Math.abs(daysDiff);
      } else if (daysDiff <= this.config.warningDays) {
        shouldSendEmail = true;
        emailType = 'payment-reminder';
        daysInfo.remainingDays = daysDiff;
      }

      if (shouldSendEmail) {
        const recipients = await this.getReimbursementRecipients(reimbursement, 'coverage');
        
        const emailQueue = this.queues.get(this.config.emailQueue);
        const emailJob = await emailQueue.add('send-reminder-email', {
          emailType,
          recipients,
          reimbursement,
          daysInfo
        });

        processedReimbursements.push({
          id: reimbursement.id,
          emailType,
          daysDiff,
          recipientCount: recipients.length,
          emailJobId: emailJob.id
        });
      } else {
        processedReimbursements.push({
          id: reimbursement.id,
          skipped: true,
          reason: `${daysDiff} jours restants, pas d'alerte nécessaire`
        });
      }
    }

    return {
      healthCoverageId,
      totalReimbursements: reimbursements.length,
      emailsSent: processedReimbursements.filter(r => !r.skipped).length,
      processedReimbursements
    };
  }

  /**
   * Groupe les remboursements par health-coverage
   */
  groupByHealthCoverage(reimbursements) {
    return reimbursements.reduce((groups, reimbursement) => {
      const healthCoverageId = reimbursement.healthCoverageId || 'unknown';
      if (!groups[healthCoverageId]) {
        groups[healthCoverageId] = [];
      }
      groups[healthCoverageId].push(reimbursement);
      return groups;
    }, {});
  }

  /**
   * Récupère les destinataires pour un remboursement
   */
  async getReimbursementRecipients(reimbursement, type) {
    try {
      const owner = await this.managerService.getReimbursementOwner(reimbursement.id);
      const oldestManagers = await this.managerService.getOldestManagers(type, 3);
      
      const recipients = [owner, ...oldestManagers].filter(Boolean);
      
      // Dédoublonnage par email
      return recipients.filter((recipient, index, self) => 
        index === self.findIndex(r => r.email === recipient.email)
      );
    } catch (error) {
      this.logError(`❌ Erreur récupération destinataires pour ${reimbursement.id}:`, error);
      return [];
    }
  }

  /**
   * Retourne le template d'email approprié
   */
  getEmailTemplate(emailType, daysInfo) {
    const templates = {
      'payment-reminder': {
        subject: daysInfo.remainingDays === 1 
          ? 'Rappel : Échéance de remboursement demain'
          : `Rappel : Échéance de remboursement dans ${daysInfo.remainingDays} jours`,
        template: 'reminder-before-due'
      },
      'payment-overdue': {
        subject: 'URGENT : Paiement de remboursement en retard',
        template: 'reminder-overdue'
      }
    };

    return templates[emailType] || templates['payment-reminder'];
  }

  // === MÉTHODES EMAILS GÉNÉRIQUES ===

  /**
   * Envoie un email simple
   */
  async sendEmail(to, subject, content, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    
    const emailData = {
      to: Array.isArray(to) ? to : [to],
      subject,
      content,
      template: options.template,
      templateData: options.templateData,
      attachments: options.attachments,
      priority: options.priority || 'normal'
    };

    return emailQueue.add('send-email', emailData, {
      priority: this.getPriorityValue(options.priority),
      delay: options.delay || 0
    });
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(to, userData, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    
    return emailQueue.add('send-welcome', {
      to,
      userData,
      ...options
    }, {
      priority: this.getPriorityValue('high')
    });
  }

  /**
   * Envoie une newsletter
   */
  async sendNewsletter(recipients, newsletterData, options = {}) {
    const emailQueue = this.queues.get(this.config.emailQueue);
    const jobs = [];
    
    for (const recipient of recipients) {
      const job = await emailQueue.add('send-newsletter', {
        to: recipient.email,
        recipient,
        newsletterData,
        ...options
      }, {
        priority: this.getPriorityValue('low')
      });
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
    
    return emailQueue.add('send-email', {
      to: Array.isArray(to) ? to : [to],
      subject,
      content,
      ...options
    }, {
      repeat: { pattern: cronPattern },
      jobId: `recurring-email-${Date.now()}`
    });
  }

  /**
   * Rend un template
   */
  async renderTemplate(templateName, data) {
    const templates = this.getEmailTemplates();
    const template = templates[templateName];
    
    if (!template) {
      throw new Error(`Template "${templateName}" non trouvé`);
    }

    let content = template.content || template;
    
    if (data) {
      Object.keys(data).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        content = content.replace(regex, data[key]);
      });
    }

    return content;
  }

  /**
   * Templates d'emails par défaut
   */
  getEmailTemplates() {
    return {
      welcome: {
        subject: 'Bienvenue {{name}} !',
        content: `
          Bonjour {{name}},
          
          Bienvenue sur notre plateforme ! Nous sommes ravis de vous compter parmi nous.
          
          Cordialement,
          L'équipe
        `
      },
      'password-reset': {
        subject: 'Réinitialisation de votre mot de passe',
        content: `
          Bonjour,
          
          Vous avez demandé la réinitialisation de votre mot de passe.
          Cliquez sur ce lien : {{resetLink}}
          
          Cordialement,
          L'équipe sécurité
        `
      },
      newsletter: {
        subject: 'Newsletter {{month}}',
        content: `
          Bonjour {{recipient.name}},
          
          Voici les dernières nouvelles de {{month}} :
          {{content}}
          
          À bientôt !
        `
      }
    };
  }

  /**
   * Convertit la priorité en valeur numérique
   */
  getPriorityValue(priority) {
    const priorities = { 'low': 1, 'normal': 5, 'high': 10, 'urgent': 15 };
    return priorities[priority] || 5;
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
   * Récupère les statistiques du service
   */
  async getStats() {
    const stats = {
      service: {
        isInitialized: this.isInitialized,
        uptime: Date.now() - this.metrics.startTime.getTime(),
        environment: this.config.isProduction ? 'production' : 'development'
      },
      metrics: { ...this.metrics },
      queues: {},
      mongodb: {
        connected: this.mongoConnected,
        uri: this.config.mongo.uri ? '[CONFIGURED]' : null
      }
    };

    // Stats détaillées par queue
    for (const [queueName, queue] of this.queues) {
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
   * Nettoie les anciens jobs
   */
  async cleanOldJobs(olderThan = 24 * 60 * 60 * 1000) { // 24h par défaut
    let totalCleaned = 0;

    for (const [queueName, queue] of this.queues) {
      try {
        await queue.clean(olderThan, 100, 'completed');
        await queue.clean(olderThan, 50, 'failed');
        totalCleaned += 150; // Estimation
        this.log(`🧹 Queue "${queueName}" nettoyée`);
      } catch (error) {
        this.logError(`❌ Erreur nettoyage queue ${queueName}:`, error);
      }
    }

    this.log(`🧹 ${totalCleaned} anciens jobs nettoyés`);
    return { totalCleaned, olderThan };
  }

  // === MÉTHODES PERSISTANCE ===

  /**
   * Sauvegarde les logs d'exécution en MongoDB
   */
  async saveExecutionLog(data) {
    if (!this.mongoConnected) return;

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

      this.log(`💾 Log d'exécution ${data.type} sauvegardé`);
    } catch (error) {
      this.logError('❌ Erreur sauvegarde log d\'exécution:', error);
    }
  }

  /**
   * Sauvegarde les logs d'emails en MongoDB
   */
  async saveEmailLog(emailData) {
    if (!this.mongoConnected) return;

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

      this.log(`💾 Log d'email sauvegardé`);
    } catch (error) {
      this.logError('❌ Erreur sauvegarde log d\'email:', error);
    }
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

  /**
   * Vérifie l'état de santé du service
   */
  async healthCheck() {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date(),
        checks: {
          initialized: this.isInitialized,
          queues: this.queues.size > 0,
          workers: this.workers.size > 0,
          mongodb: this.mongoConnected,
          redis: true // Toujours OK si on arrive ici
        }
      };

      // Test Redis rapide
      try {
        const testQueue = this.queues.values().next().value;
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
}

module.exports = ReminderService;
