/**
 * Job Handlers - Gestionnaires de tâches pour ReminderService
 * 
 * Module contenant tous les handlers spécialisés pour les différents types de jobs :
 * - Handlers remboursements (corporate, coverage)
 * - Handlers emails (génériques, spécialisés, utilitaires)
 */

class JobHandlers {
  constructor(service) {
    this.service = service;
    this.config = service.config;
    this.metrics = service.metrics;
  }

  /**
   * Crée tous les handlers de jobs
   */
  createHandlers() {
    return {
      // === HANDLERS REMBOURSEMENTS ===
      
      'process-corporate-reminders': async (data, job) => {
        this.service.log('🏢 Traitement des rappels Corporate...');
        
        try {
          const currentDate = new Date();
          const dayOfMonth = currentDate.getDate();
          
          // Vérification période (10 premiers jours)
          if (dayOfMonth > 10) {
            this.service.log(`⏭️ Jour ${dayOfMonth} > 10, pas de traitement Corporate`);
            this.metrics.reminders.skipped++;
            return { skipped: true, reason: 'Hors période (> 10 jours)' };
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

      'send-welcome': async (data, job) => {
        this.service.log(`📧 Email de bienvenue à ${data.to}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'welcome', sentTo: data.to };
      },

      'send-newsletter': async (data, job) => {
        this.service.log(`📰 Newsletter à ${data.to}`);
        await new Promise(resolve => setTimeout(resolve, 1200));
        await job.updateProgress(100);
        this.metrics.emails.sent++;
        return { success: true, type: 'newsletter', sentTo: data.to };
      },

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