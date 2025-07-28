const MailManager = require('../core/MailManager');

/**
 * RemboursementMailService - Service spécialisé pour les rappels de remboursements
 * 
 * Sépare la logique métier des remboursements des composants core BullMQ.
 * Gère les envois automatiques de mails pour Corporate et Coverage.
 */
class RemboursementMailService {
  constructor(config = {}) {
    // Configuration avec gestion de l'environnement
    this.config = {
      redis: {
        url: config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379'
      },
      mongo: {
        uri: config.mongo?.uri || process.env.MONGO_URI || null
      },
      isProduction: config.isProduction || process.env.NODE_ENV === 'production',
      defaultOptions: {
        attempts: config.defaultOptions?.attempts || 5,
        backoff: config.defaultOptions?.backoff || { type: 'exponential', delay: 5000 },
        removeOnComplete: config.defaultOptions?.removeOnComplete || 100,
        removeOnFail: config.defaultOptions?.removeOnFail || 20
      },
      ...config
    };

    // Configuration spécifique aux remboursements
    this.corporateConfig = {
      queueName: 'corporate-reminders',
      cronPattern: '0 9 1-10 * *', // Tous les jours de 1 à 10 du mois à 9h
      reminderTypes: ['PENDING', 'OVERDUE'],
      reimbursementType: 'SALARY'
    };

    this.coverageConfig = {
      queueName: 'coverage-reminders', 
      cronPattern: '0 10 * * *', // Tous les jours à 10h
      reminderTypes: ['PENDING', 'OVERDUE'],
      reimbursementType: 'TREASURY',
      warningDays: 10 // Envoyer rappel 10 jours avant échéance
    };

    // Services externes (à injecter)
    this.reimbursementService = config.reimbursementService;
    this.managerService = config.managerService;
    this.emailService = config.emailService;
    this.loggerService = config.loggerService;

    // MailManager avec configuration adaptée
    this.mailManager = new MailManager({
      redis: this.config.redis,
      defaultOptions: this.config.defaultOptions,
      isProduction: this.config.isProduction
    });

    this.isInitialized = false;
  }

  /**
   * Initialise le service de rappels de remboursements
   */
  async initialize() {
    this.log('🏢 Initialisation du service de rappels de remboursements...');
    
    await this.mailManager.initialize();

    // Création des queues spécialisées
    this.mailManager.createQueue(this.corporateConfig.queueName, {
      defaultJobOptions: this.config.defaultOptions
    });

    this.mailManager.createQueue(this.coverageConfig.queueName, {
      defaultJobOptions: this.config.defaultOptions
    });

    // Configuration des handlers spécialisés
    const reminderHandlers = this.createReminderHandlers();
    
    this.mailManager.startWorker(this.corporateConfig.queueName, reminderHandlers, { concurrency: 3 });
    this.mailManager.startWorker(this.coverageConfig.queueName, reminderHandlers, { concurrency: 3 });

    // Configuration du monitoring spécialisé
    this.setupReminderMonitoring();

    // Planification des cron jobs
    await this.scheduleReminderJobs();

    this.isInitialized = true;
    this.log('✅ Service de rappels de remboursements initialisé');
  }

  /**
   * Planifie les jobs de rappels automatiques
   */
  async scheduleReminderJobs() {
    // Job Corporate : 10 premiers jours du mois à 9h
    await this.mailManager.scheduleJob(
      this.corporateConfig.queueName,
      'process-corporate-reminders',
      { type: 'corporate-daily-check' },
      this.corporateConfig.cronPattern,
      { jobId: 'corporate-reminders-daily' }
    );

    // Job Coverage : tous les jours à 10h
    await this.mailManager.scheduleJob(
      this.coverageConfig.queueName,
      'process-coverage-reminders', 
      { type: 'coverage-daily-check' },
      this.coverageConfig.cronPattern,
      { jobId: 'coverage-reminders-daily' }
    );

    this.log('📅 Jobs de rappels planifiés :');
    this.log(`  - Corporate: ${this.corporateConfig.cronPattern}`);
    this.log(`  - Coverage: ${this.coverageConfig.cronPattern}`);
  }

  /**
   * Crée les handlers spécialisés pour les rappels
   */
  createReminderHandlers() {
    return {
      // Handler principal pour les rappels Corporate
      'process-corporate-reminders': async (data, job) => {
        this.log('🏢 Traitement des rappels Corporate...');
        
        try {
          const currentDate = new Date();
          const dayOfMonth = currentDate.getDate();
          
          // Vérification que nous sommes dans les 10 premiers jours
          if (dayOfMonth > 10) {
            this.log(`⏭️  Jour ${dayOfMonth} > 10, pas de traitement Corporate aujourd'hui`);
            return { skipped: true, reason: 'Hors période (> 10 jours)' };
          }

          await job.updateProgress(10);

          // Récupération des remboursements SALARY en attente
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: this.corporateConfig.reimbursementType,
            statuses: this.corporateConfig.reminderTypes
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
              this.logError(`❌ Erreur traitement remboursement ${reimbursement.id}:`, error);
              results.push({ id: reimbursement.id, error: error.message });
            }
          }

          await job.updateProgress(100);

          const finalResult = {
            totalProcessed: processedCount,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

          // Sauvegarde en base si production
          if (this.config.isProduction && this.config.mongo.uri) {
            await this.saveExecutionLog('corporate', finalResult);
          }

          return finalResult;

        } catch (error) {
          this.logError('❌ Erreur dans le traitement Corporate:', error);
          throw error;
        }
      },

      // Handler principal pour les rappels Coverage
      'process-coverage-reminders': async (data, job) => {
        this.log('🏥 Traitement des rappels Coverage...');
        
        try {
          const currentDate = new Date();
          await job.updateProgress(10);

          // Récupération des remboursements TREASURY en attente
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: this.coverageConfig.reimbursementType,
            statuses: this.coverageConfig.reminderTypes
          });

          this.log(`📋 ${reimbursements.length} remboursements Coverage trouvés`);
          await job.updateProgress(30);

          // Organisation par health-coverage comme demandé
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
              this.logError(`❌ Erreur traitement health-coverage ${healthCoverageId}:`, error);
              results.push({ healthCoverageId, error: error.message });
            }
          }

          await job.updateProgress(100);

          const finalResult = {
            totalHealthCoverages: totalItems,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

          // Sauvegarde en base si production
          if (this.config.isProduction && this.config.mongo.uri) {
            await this.saveExecutionLog('coverage', finalResult);
          }

          return finalResult;

        } catch (error) {
          this.logError('❌ Erreur dans le traitement Coverage:', error);
          throw error;
        }
      },

      // Handler pour envoi d'email de rappel
      'send-reminder-email': async (data, job) => {
        const { emailType, recipients, reimbursement, daysInfo } = data;
        
        this.log(`📧 Envoi email de rappel ${emailType} à ${recipients.length} destinataires`);
        
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
          emailResult
        };

        // Sauvegarde de l'email en base si production
        if (this.config.isProduction && this.config.mongo.uri) {
          await this.saveEmailLog(result);
        }

        return result;
      }
    };
  }

  /**
   * Traite un remboursement Corporate
   */
  async processCorporateReimbursement(reimbursement, currentDate) {
    const dueDate = new Date(reimbursement.dueDate);
    const timeDiff = dueDate.getTime() - currentDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    let emailType;
    let daysInfo = { daysDiff, isOverdue: false };

    // Logique de détermination du type d'email
    if (daysDiff <= 0) {
      // Date dépassée - paiement en retard
      emailType = 'payment-overdue';
      daysInfo.isOverdue = true;
      daysInfo.overdueDays = Math.abs(daysDiff);
    } else {
      // Rappel normal avant échéance
      emailType = 'payment-reminder';
      daysInfo.remainingDays = daysDiff;
    }

    // Récupération des destinataires (owner + 3 plus vieux managers)
    const recipients = await this.getReimbursementRecipients(reimbursement, 'corporate');

    // Envoi de l'email via un job séparé pour meilleure gestion des erreurs
    const emailJob = await this.mailManager.addJob(
      this.corporateConfig.queueName,
      'send-reminder-email',
      {
        emailType,
        recipients,
        reimbursement,
        daysInfo
      }
    );

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

      // Logique Coverage : rappel à 10 jours OU si négatif (en retard)
      if (daysDiff <= 0) {
        // Paiement en retard
        shouldSendEmail = true;
        emailType = 'payment-overdue';
        daysInfo.isOverdue = true;
        daysInfo.overdueDays = Math.abs(daysDiff);
      } else if (daysDiff <= this.coverageConfig.warningDays) {
        // Rappel 10 jours avant échéance
        shouldSendEmail = true;
        emailType = 'payment-reminder';
        daysInfo.remainingDays = daysDiff;
      }

      if (shouldSendEmail) {
        const recipients = await this.getReimbursementRecipients(reimbursement, 'coverage');
        
        const emailJob = await this.mailManager.addJob(
          this.coverageConfig.queueName,
          'send-reminder-email',
          {
            emailType,
            recipients,
            reimbursement,
            daysInfo
          }
        );

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
      // Récupération de l'owner
      const owner = await this.managerService.getReimbursementOwner(reimbursement.id);
      
      // Récupération des 3 plus vieux managers selon le type
      const oldestManagers = await this.managerService.getOldestManagers(type, 3);
      
      // Combinaison des destinataires
      const recipients = [owner, ...oldestManagers].filter(Boolean);
      
      // Dédoublonnage par email
      const uniqueRecipients = recipients.filter((recipient, index, self) => 
        index === self.findIndex(r => r.email === recipient.email)
      );

      return uniqueRecipients;
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

  /**
   * Configure le monitoring spécialisé pour les rappels
   */
  setupReminderMonitoring() {
    // Monitoring des erreurs critiques
    this.mailManager.onEvent(this.corporateConfig.queueName, 'failed', (data) => {
      this.logError(`🚨 [CORPORATE] Job ${data.jobId} échoué: ${data.failedReason}`);
      // TODO: Alerter les administrateurs
    });

    this.mailManager.onEvent(this.coverageConfig.queueName, 'failed', (data) => {
      this.logError(`🚨 [COVERAGE] Job ${data.jobId} échoué: ${data.failedReason}`);
      // TODO: Alerter les administrateurs
    });

    // Monitoring des succès
    this.mailManager.onEvent(this.corporateConfig.queueName, 'completed', (data) => {
      this.log(`✅ [CORPORATE] Job ${data.jobId} terminé avec succès`);
    });

    this.mailManager.onEvent(this.coverageConfig.queueName, 'completed', (data) => {
      this.log(`✅ [COVERAGE] Job ${data.jobId} terminé avec succès`);
    });

    this.log('📊 Monitoring des rappels configuré');
  }

  /**
   * Récupère les statistiques des rappels
   */
  async getReminderStats() {
    const corporateStats = await this.mailManager.getQueueStats(this.corporateConfig.queueName);
    const coverageStats = await this.mailManager.getQueueStats(this.coverageConfig.queueName);

    return {
      corporate: {
        ...corporateStats,
        nextExecution: this.getNextCronExecution(this.corporateConfig.cronPattern)
      },
      coverage: {
        ...coverageStats,
        nextExecution: this.getNextCronExecution(this.coverageConfig.cronPattern)
      },
      summary: {
        totalWaiting: corporateStats.waiting + coverageStats.waiting,
        totalActive: corporateStats.active + coverageStats.active,
        totalCompleted: corporateStats.completed + coverageStats.completed,
        totalFailed: corporateStats.failed + coverageStats.failed
      },
      environment: {
        isProduction: this.config.isProduction,
        hasMongoUri: !!this.config.mongo.uri,
        redisUrl: this.config.redis.url.replace(/\/\/.*@/, '//***@') // Masquer les credentials
      }
    };
  }

  /**
   * Calcule la prochaine exécution d'un cron pattern
   */
  getNextCronExecution(cronPattern) {
    // Implementation simplifiée - dans un vrai projet, utiliser une librairie comme node-cron
    const now = new Date();
    return `Prochaine exécution basée sur: ${cronPattern}`;
  }

  /**
   * Force l'exécution manuelle des rappels (pour tests/debug)
   */
  async forceReminderExecution(type = 'both') {
    const results = {};

    if (type === 'corporate' || type === 'both') {
      const corporateJob = await this.mailManager.addJob(
        this.corporateConfig.queueName,
        'process-corporate-reminders',
        { type: 'manual-execution', forced: true }
      );
      results.corporate = corporateJob.id;
    }

    if (type === 'coverage' || type === 'both') {
      const coverageJob = await this.mailManager.addJob(
        this.coverageConfig.queueName,
        'process-coverage-reminders',
        { type: 'manual-execution', forced: true }
      );
      results.coverage = coverageJob.id;
    }

    this.log(`🔧 Exécution forcée des rappels (${type}):`, results);
    return results;
  }

  /**
   * Sauvegarde les logs d'exécution en base de données
   */
  async saveExecutionLog(type, data) {
    if (!this.config.mongo.uri) return;

    try {
      // TODO: Implémenter la sauvegarde MongoDB
      // const mongoose = require('mongoose');
      // await ExecutionLog.create({
      //   type,
      //   data,
      //   timestamp: new Date(),
      //   environment: this.config.isProduction ? 'production' : 'development'
      // });
      
      this.log(`💾 Log d'exécution ${type} sauvegardé en base`);
    } catch (error) {
      this.logError('❌ Erreur sauvegarde log d\'exécution:', error);
    }
  }

  /**
   * Sauvegarde les logs d'emails en base de données
   */
  async saveEmailLog(emailData) {
    if (!this.config.mongo.uri) return;

    try {
      // TODO: Implémenter la sauvegarde MongoDB
      // await EmailLog.create({
      //   ...emailData,
      //   timestamp: new Date(),
      //   environment: this.config.isProduction ? 'production' : 'development'
      // });
      
      this.log(`💾 Log d'email sauvegardé en base`);
    } catch (error) {
      this.logError('❌ Erreur sauvegarde log d\'email:', error);
    }
  }

  /**
   * Logger intelligent selon l'environnement
   */
  log(message, data = null) {
    if (!this.config.isProduction) {
      console.log(message, data || '');
    } else if (this.loggerService) {
      this.loggerService.info(message, data);
    }
  }

  /**
   * Logger d'erreurs
   */
  logError(message, error) {
    if (!this.config.isProduction) {
      console.error(message, error);
    } else if (this.loggerService) {
      this.loggerService.error(message, { error: error.message, stack: error.stack });
    }
  }

  /**
   * Arrêt propre du service
   */
  async shutdown() {
    this.log('🛑 Arrêt du RemboursementMailService...');
    await this.mailManager.shutdown();
    this.isInitialized = false;
    this.log('✅ RemboursementMailService arrêté proprement');
  }
}

module.exports = RemboursementMailService; 