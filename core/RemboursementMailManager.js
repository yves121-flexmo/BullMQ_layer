const MailManager = require('./MailManager');
const WorkerManager = require('./WorkerManager');

/**
 * RemboursementMailManager - Système spécialisé pour les rappels de remboursements
 * 
 * Gère les envois automatiques de mails pour :
 * - Remboursements Corporate (SALARY) - 10 premiers jours du mois
 * - Remboursements Coverage (TREASURY) - tous les jours
 */
class RemboursementMailManager extends MailManager {
  constructor(config = {}) {
    super(config);
    
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
  }

  /**
   * Initialise le système de rappels de remboursements
   */
  async initializeReminderSystem() {
    console.log('🏢 Initialisation du système de rappels de remboursements...');
    
    await this.initialize();

    // Création des queues spécialisées
    this.createQueue(this.corporateConfig.queueName, {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 20
      }
    });

    this.createQueue(this.coverageConfig.queueName, {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 20
      }
    });

    // Configuration des handlers spécialisés
    const reminderHandlers = this.createReminderHandlers();
    
    this.startWorker(this.corporateConfig.queueName, reminderHandlers, { concurrency: 3 });
    this.startWorker(this.coverageConfig.queueName, reminderHandlers, { concurrency: 3 });

    // Configuration du monitoring spécialisé
    this.setupReminderMonitoring();

    // Planification des cron jobs
    await this.scheduleReminderJobs();

    console.log('✅ Système de rappels de remboursements initialisé');
  }

  /**
   * Planifie les jobs de rappels automatiques
   */
  async scheduleReminderJobs() {
    // Job Corporate : 10 premiers jours du mois à 9h
    await this.scheduleJob(
      this.corporateConfig.queueName,
      'process-corporate-reminders',
      { type: 'corporate-daily-check' },
      this.corporateConfig.cronPattern,
      { jobId: 'corporate-reminders-daily' }
    );

    // Job Coverage : tous les jours à 10h
    await this.scheduleJob(
      this.coverageConfig.queueName,
      'process-coverage-reminders', 
      { type: 'coverage-daily-check' },
      this.coverageConfig.cronPattern,
      { jobId: 'coverage-reminders-daily' }
    );

    console.log('📅 Jobs de rappels planifiés :');
    console.log(`  - Corporate: ${this.corporateConfig.cronPattern}`);
    console.log(`  - Coverage: ${this.coverageConfig.cronPattern}`);
  }

  /**
   * Crée les handlers spécialisés pour les rappels
   */
  createReminderHandlers() {
    return {
      // Handler principal pour les rappels Corporate
      'process-corporate-reminders': async (data, job) => {
        console.log('🏢 Traitement des rappels Corporate...');
        
        try {
          const currentDate = new Date();
          const dayOfMonth = currentDate.getDate();
          
          // Vérification que nous sommes dans les 10 premiers jours
          if (dayOfMonth > 10) {
            console.log(`⏭️  Jour ${dayOfMonth} > 10, pas de traitement Corporate aujourd'hui`);
            return { skipped: true, reason: 'Hors période (> 10 jours)' };
          }

          await job.updateProgress(10);

          // Récupération des remboursements SALARY en attente
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: this.corporateConfig.reimbursementType,
            statuses: this.corporateConfig.reminderTypes
          });

          console.log(`📋 ${reimbursements.length} remboursements Corporate trouvés`);
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
              console.error(`❌ Erreur traitement remboursement ${reimbursement.id}:`, error);
              results.push({ id: reimbursement.id, error: error.message });
            }
          }

          await job.updateProgress(100);

          return {
            totalProcessed: processedCount,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

        } catch (error) {
          console.error('❌ Erreur dans le traitement Corporate:', error);
          throw error;
        }
      },

      // Handler principal pour les rappels Coverage
      'process-coverage-reminders': async (data, job) => {
        console.log('🏥 Traitement des rappels Coverage...');
        
        try {
          const currentDate = new Date();
          await job.updateProgress(10);

          // Récupération des remboursements TREASURY en attente
          const reimbursements = await this.reimbursementService.getReimbursements({
            type: this.coverageConfig.reimbursementType,
            statuses: this.coverageConfig.reminderTypes
          });

          console.log(`📋 ${reimbursements.length} remboursements Coverage trouvés`);
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
              console.error(`❌ Erreur traitement health-coverage ${healthCoverageId}:`, error);
              results.push({ healthCoverageId, error: error.message });
            }
          }

          await job.updateProgress(100);

          return {
            totalHealthCoverages: totalItems,
            totalReimbursements: reimbursements.length,
            results,
            executionDate: currentDate
          };

        } catch (error) {
          console.error('❌ Erreur dans le traitement Coverage:', error);
          throw error;
        }
      },

      // Handler pour envoi d'email de rappel
      'send-reminder-email': async (data, job) => {
        const { emailType, recipients, reimbursement, daysInfo } = data;
        
        console.log(`📧 Envoi email de rappel ${emailType} à ${recipients.length} destinataires`);
        
        const emailResult = await this.emailService.sendReminderEmail({
          type: emailType,
          recipients,
          reimbursement,
          daysInfo,
          template: this.getEmailTemplate(emailType, daysInfo)
        });

        return {
          emailType,
          recipientCount: recipients.length,
          reimbursementId: reimbursement.id,
          emailResult
        };
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
    const emailJob = await this.addJob(
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
        
        const emailJob = await this.addJob(
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
      console.error(`❌ Erreur récupération destinataires pour ${reimbursement.id}:`, error);
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
    this.onEvent(this.corporateConfig.queueName, 'failed', (data) => {
      console.error(`🚨 [CORPORATE] Job ${data.jobId} échoué: ${data.failedReason}`);
      // TODO: Alerter les administrateurs
    });

    this.onEvent(this.coverageConfig.queueName, 'failed', (data) => {
      console.error(`🚨 [COVERAGE] Job ${data.jobId} échoué: ${data.failedReason}`);
      // TODO: Alerter les administrateurs
    });

    // Monitoring des succès
    this.onEvent(this.corporateConfig.queueName, 'completed', (data) => {
      console.log(`✅ [CORPORATE] Job ${data.jobId} terminé avec succès`);
    });

    this.onEvent(this.coverageConfig.queueName, 'completed', (data) => {
      console.log(`✅ [COVERAGE] Job ${data.jobId} terminé avec succès`);
    });

    console.log('📊 Monitoring des rappels configuré');
  }

  /**
   * Récupère les statistiques des rappels
   */
  async getReminderStats() {
    const corporateStats = await this.getQueueStats(this.corporateConfig.queueName);
    const coverageStats = await this.getQueueStats(this.coverageConfig.queueName);

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
      }
    };
  }

  /**
   * Calcule la prochaine exécution d'un cron pattern
   */
  getNextCronExecution(cronPattern) {
    // Implementation simplifiée - dans un vrai projet, utiliser une librairie comme node-cron
    const now = new Date();
    // Logique basique pour affichage
    return `Prochaine exécution basée sur: ${cronPattern}`;
  }

  /**
   * Force l'exécution manuelle des rappels (pour tests/debug)
   */
  async forceReminderExecution(type = 'both') {
    const results = {};

    if (type === 'corporate' || type === 'both') {
      const corporateJob = await this.addJob(
        this.corporateConfig.queueName,
        'process-corporate-reminders',
        { type: 'manual-execution', forced: true }
      );
      results.corporate = corporateJob.id;
    }

    if (type === 'coverage' || type === 'both') {
      const coverageJob = await this.addJob(
        this.coverageConfig.queueName,
        'process-coverage-reminders',
        { type: 'manual-execution', forced: true }
      );
      results.coverage = coverageJob.id;
    }

    console.log(`🔧 Exécution forcée des rappels (${type}):`, results);
    return results;
  }
}

module.exports = RemboursementMailManager; 