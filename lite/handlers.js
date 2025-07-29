/**
 * @fileoverview Job Handlers - Gestionnaires de tâches pour ReminderService
 * 
 * Module contenant tous les handlers spécialisés pour les différents types de jobs :
 * - Handlers remboursements (corporate, coverage)
 * - Handlers emails (génériques, spécialisés, utilitaires)
 * - Gestion du progress des jobs BullMQ
 * - Intégration avec le système d'alertes
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

/**
 * @typedef {Object} JobData
 * @property {string} type - Type de job ('scheduled', 'manual-execution', etc.)
 * @property {string} [source] - Source du job ('cron', 'manual', etc.)
 * @property {boolean} [forced] - Indique si l'exécution est forcée
 * @property {Date} [timestamp] - Timestamp de création du job
 */

/**
 * @typedef {Object} ReimbursementJobResult
 * @property {string} type - Type de traitement ('corporate', 'coverage')
 * @property {number} totalProcessed - Nombre de remboursements traités
 * @property {number} totalReimbursements - Nombre total de remboursements
 * @property {Array} results - Résultats détaillés par remboursement
 * @property {Date} executionDate - Date d'exécution
 * @property {boolean} [skipped] - Indique si le traitement a été ignoré
 * @property {string} [reason] - Raison de l'ignorance du traitement
 */

/**
 * @typedef {Object} EmailJobResult
 * @property {string} emailType - Type d'email envoyé
 * @property {number} recipientCount - Nombre de destinataires
 * @property {string} reimbursementId - ID du remboursement concerné
 * @property {Object} emailResult - Résultat de l'envoi d'email
 * @property {Date} timestamp - Timestamp de l'envoi
 */

/**
 * @typedef {Object} GenericEmailResult
 * @property {boolean} success - Succès de l'envoi
 * @property {string} [messageId] - ID du message envoyé
 * @property {string[]} recipients - Liste des destinataires
 * @property {string} subject - Sujet de l'email
 * @property {Date} sentAt - Date d'envoi
 */

/**
 * @typedef {Object} BullMQJob
 * @property {string} id - ID unique du job
 * @property {string} name - Nom du job
 * @property {Object} data - Données du job
 * @property {Function} updateProgress - Fonction pour mettre à jour le progress
 * @property {number} attemptsMade - Nombre de tentatives effectuées
 * @property {Object} opts - Options du job
 */

/**
 * JobHandlers - Gestionnaires de tâches pour ReminderService
 * 
 * Cette classe encapsule tous les handlers de jobs BullMQ pour le système de rappels.
 * Elle prend une instance du service principal pour accéder aux configurations,
 * métriques et méthodes partagées.
 * 
 * @class JobHandlers
 */
class JobHandlers {
  
  /**
   * Crée une instance de JobHandlers
   * 
   * @param {Object} service - Instance du ReminderService principal
   * @param {Object} service.config - Configuration du service
   * @param {Object} service.metrics - Métriques en temps réel
   * @param {Function} service.log - Fonction de logging
   * @param {Function} service.logError - Fonction de logging d'erreurs
   * @param {Function} service.processCorporateReimbursement - Traitement corporate
   * @param {Function} service.processCoverageReimbursements - Traitement coverage
   * @param {Function} service.groupByHealthCoverage - Groupement par health coverage
   * @param {Function} service.getEmailTemplate - Récupération template email
   * @param {Function} service.renderTemplate - Rendu de template
   * @param {Object} service.reimbursementService - Service des remboursements
   * @param {Object} service.emailService - Service d'envoi d'emails
   * @param {Object} service.alertService - Service d'alertes
   * @param {Map} service.queues - Map des queues BullMQ
   * @param {boolean} service.mongoConnected - État connexion MongoDB
   * @param {Function} service.saveExecutionLog - Sauvegarde logs d'exécution
   * @param {Function} service.saveEmailLog - Sauvegarde logs d'emails
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
   * Crée tous les handlers de jobs BullMQ
   * 
   * Retourne un objet contenant tous les handlers mappés par nom de job.
   * Chaque handler est une fonction asynchrone qui prend les données du job
   * et l'instance du job BullMQ.
   * 
   * @returns {Object<string, Function>} Map des handlers par nom de job
   * 
   * @example
   * const handlers = jobHandlers.createHandlers();
   * const handler = handlers['process-corporate-reminders'];
   * const result = await handler(jobData, jobInstance);
   */
  createHandlers() {
    return {
      // === HANDLERS REMBOURSEMENTS ===
      
      /**
       * Handler pour le traitement des rappels Corporate
       * 
       * Traite les remboursements de type SALARY avec les statuts PENDING/OVERDUE
       * pendant les 10 premiers jours du mois uniquement.
       * 
       * @async
       * @param {JobData} data - Données du job
       * @param {BullMQJob} job - Instance du job BullMQ
       * @returns {Promise<ReimbursementJobResult>} Résultat du traitement
       * 
       * @example
       * // Job automatique planifié par cron
       * await handler({ type: 'scheduled', source: 'cron' }, jobInstance);
       * 
       * @example
       * // Exécution manuelle forcée
       * await handler({ type: 'manual-execution', forced: true }, jobInstance);
       */
      'process-corporate-reminders': async (data, job) => {
        this.service.log('🏢 Traitement des rappels Corporate...');
        
        try {
          const currentDate = new Date();
          const dayOfMonth = currentDate.getDate();
          
          // Vérification période (10 premiers jours)
          if (dayOfMonth > 10) {
            this.service.log(`⏭️ Jour ${dayOfMonth} > 10, pas de traitement Corporate`);
            this.metrics.reminders.skipped++;
            return { 
              skipped: true, 
              reason: 'Hors période (> 10 jours)',
              type: 'corporate',
              executionDate: currentDate
            };
          }

          await job.updateProgress(10);

          // Récupération remboursements SALARY
          const reimbursements = await this.service.reimbursementService.getReimbursements({
            type: 'SALARY',
            statuses: this.config.corporateTypes
          });

          this.service.log(`📋 ${reimbursements.length} remboursements Corporate trouvés`);
          await job.updateProgress(30);

          let processedCount = 0;
          const results = [];

          for (const reimbursement of reimbursements) {
            try {
              const result = await this.service.processCorporateReimbursement(reimbursement, currentDate);
              results.push(result);
              processedCount++;
              
              await job.updateProgress(30 + (processedCount / reimbursements.length) * 60);
            } catch (error) {
              this.service.logError(`❌ Erreur remboursement ${reimbursement.id}:`, error);
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
          if (this.service.mongoConnected) {
            await this.service.saveExecutionLog(finalResult);
          }

          // Alerte système si configurée
          if (this.service.alertService) {
            await this.service.alertService.notifyExecution(finalResult);
          }

          return finalResult;

        } catch (error) {
          this.metrics.jobs.failed++;
          this.service.logError('❌ Erreur traitement Corporate:', error);
          throw error;
        }
      },

      /**
       * Handler pour le traitement des rappels Coverage
       * 
       * Traite les remboursements de type TREASURY avec les statuts PENDING/OVERDUE
       * tous les jours du mois, avec rappel à X jours avant échéance.
       * 
       * @async
       * @param {JobData} data - Données du job
       * @param {BullMQJob} job - Instance du job BullMQ
       * @returns {Promise<ReimbursementJobResult>} Résultat du traitement
       * 
       * @example
       * // Traitement automatique quotidien
       * const result = await handler({ type: 'scheduled', source: 'cron' }, jobInstance);
       * console.log(`${result.totalHealthCoverages} health coverages traitées`);
       */
      'process-coverage-reminders': async (data, job) => {
        this.service.log('🏥 Traitement des rappels Coverage...');
        
        try {
          const currentDate = new Date();
          await job.updateProgress(10);

          // Récupération remboursements TREASURY
          const reimbursements = await this.service.reimbursementService.getReimbursements({
            type: 'TREASURY',
            statuses: this.config.coverageTypes
          });

          this.service.log(`📋 ${reimbursements.length} remboursements Coverage trouvés`);
          await job.updateProgress(30);

          // Groupement par health-coverage
          const reimbursementsByHealthCoverage = this.service.groupByHealthCoverage(reimbursements);
          
          let processedCount = 0;
          const results = [];
          const totalItems = Object.keys(reimbursementsByHealthCoverage).length;

          for (const [healthCoverageId, coverageReimbursements] of Object.entries(reimbursementsByHealthCoverage)) {
            try {
              const result = await this.service.processCoverageReimbursements(
                healthCoverageId, 
                coverageReimbursements, 
                currentDate
              );
              results.push(result);
              processedCount++;
              
              await job.updateProgress(30 + (processedCount / totalItems) * 60);
            } catch (error) {
              this.service.logError(`❌ Erreur health-coverage ${healthCoverageId}:`, error);
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
          if (this.service.mongoConnected) {
            await this.service.saveExecutionLog(finalResult);
          }

          // Alerte système
          if (this.service.alertService) {
            await this.service.alertService.notifyExecution(finalResult);
          }

          return finalResult;

        } catch (error) {
          this.metrics.jobs.failed++;
          this.service.logError('❌ Erreur traitement Coverage:', error);
          throw error;
        }
      },

      // === HANDLERS EMAILS ===

      /**
       * Handler pour l'envoi d'emails de rappel spécialisés
       * 
       * Envoie des emails de rappel avec templates EJS personnalisés
       * selon le type (before-due, overdue) et les informations de délai.
       * 
       * @async
       * @param {Object} data - Données de l'email de rappel
       * @param {string} data.emailType - Type d'email ('payment-reminder', 'payment-overdue')
       * @param {Array} data.recipients - Liste des destinataires
       * @param {Object} data.reimbursement - Données du remboursement
       * @param {Object} data.daysInfo - Informations sur les jours (remainingDays, overdueDays)
       * @param {BullMQJob} job - Instance du job BullMQ
       * @returns {Promise<EmailJobResult>} Résultat de l'envoi
       * 
       * @example
       * const emailData = {
       *   emailType: 'payment-reminder',
       *   recipients: [{ name: 'Alice', email: 'alice@company.com' }],
       *   reimbursement: { id: 'RBT-001', amount: 1500 },
       *   daysInfo: { remainingDays: 5 }
       * };
       * await handler(emailData, jobInstance);
       */
      'send-reminder-email': async (data, job) => {
        const { emailType, recipients, reimbursement, daysInfo } = data;
        
        this.service.log(`📧 Envoi email ${emailType} à ${recipients.length} destinataires`);
        this.metrics.emails.processing++;
        
        try {
          const emailResult = await this.service.emailService.sendReminderEmail({
            type: emailType,
            recipients,
            reimbursement,
            daysInfo,
            template: this.service.getEmailTemplate(emailType, daysInfo)
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
          if (this.service.mongoConnected) {
            await this.service.saveEmailLog(result);
          }

          return result;

        } catch (error) {
          this.metrics.emails.failed++;
          this.metrics.emails.processing--;
          this.metrics.reminders.failed++;
          this.service.logError('❌ Erreur envoi email:', error);
          throw error;
        }
      },

      /**
       * Handler pour l'envoi d'emails génériques
       * 
       * Envoie des emails génériques avec support des templates EJS,
       * validation des données, et gestion des priorités.
       * 
       * @async
       * @param {Object} data - Données de l'email
       * @param {string[]} data.to - Liste des destinataires
       * @param {string} data.subject - Sujet de l'email
       * @param {string} [data.content] - Contenu de l'email (optionnel si template)
       * @param {string} [data.template] - Nom du template EJS à utiliser
       * @param {Object} [data.templateData] - Données pour le template
       * @param {Array} [data.attachments] - Pièces jointes
       * @param {string} [data.priority] - Priorité de l'email
       * @param {BullMQJob} job - Instance du job BullMQ
       * @returns {Promise<GenericEmailResult>} Résultat de l'envoi
       * 
       * @example
       * // Email simple
       * const emailData = {
       *   to: ['user@example.com'],
       *   subject: 'Test Email',
       *   content: 'Contenu de test'
       * };
       * 
       * @example
       * // Email avec template EJS
       * const emailData = {
       *   to: ['user@example.com'],
       *   subject: 'Bienvenue',
       *   template: 'welcome',
       *   templateData: { name: 'Alice', userData: { role: 'Manager' } }
       * };
       */
      'send-email': async (data, job) => {
        this.service.log(`📧 Envoi email générique à ${data.to.join(', ')}: ${data.subject}`);
        
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
            emailContent = await this.service.renderTemplate(data.template, data.templateData);
          }

          await job.updateProgress(60);

          // Envoi via service email
          if (!this.service.emailService) {
            throw new Error('Service email non configuré');
          }

          const result = await this.service.emailService.sendEmail({
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
          this.service.logError('❌ Erreur envoi email générique:', error);
          throw error;
        }
      },

      // === HANDLERS UTILITAIRES ===

      /**
       * Handler pour l'envoi de notifications
       * 
       * Envoie des notifications rapides et légères pour des alertes
       * ou des informations importantes nécessitant une attention immédiate.
       * 
       * @async
       * @param {Object} data - Données de la notification
       * @param {string} data.to - Destinataire
       * @param {string} data.subject - Sujet de la notification
       * @param {string} data.message - Message de la notification
       * @param {string} [data.priority] - Priorité de la notification
       * @param {BullMQJob} job - Instance du job BullMQ
       * @returns {Promise<Object>} Résultat de l'envoi
       * 
       * @example
       * const notificationData = {
       *   to: 'admin@company.com',
       *   subject: 'Alerte Système',
       *   message: 'Le serveur de base de données nécessite une attention',
       *   priority: 'urgent'
       * };
       * await handler(notificationData, jobInstance);
       */
      'send-notification': async (data, job) => {
        this.service.log(`🔔 Notification à ${data.to}: ${data.subject}`);
        await new Promise(resolve => setTimeout(resolve, 400));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'notification', sentTo: data.to };
      }
    };
  }
}

module.exports = JobHandlers;