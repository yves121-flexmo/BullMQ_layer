const BullMQManager = require('../core/BullMQManager');

/**
 * MailManager - Gestionnaire métier spécialisé pour les emails
 * 
 * Construit au-dessus de BullMQManager pour fournir une interface
 * dédiée à la gestion des emails asynchrones.
 */
class MailManager extends BullMQManager {
  constructor(config = {}) {
    super(config);
    
    // Configuration spécifique aux emails
    this.emailConfig = {
      defaultQueue: config.emailConfig?.defaultQueue || 'emails',
      retryDelays: config.emailConfig?.retryDelays || [1000, 5000, 10000, 30000, 60000],
      templates: config.emailConfig?.templates || {},
      ...config.emailConfig
    };

    // Service email externe (à injecter)
    this.emailService = config.emailService;
  }

  /**
   * Initialise le système de mail
   */
  async initialize() {
    await super.initialize();
    
    // Création de la queue par défaut pour les emails
    this.createQueue(this.emailConfig.defaultQueue, {
      defaultJobOptions: {
        ...this.config.defaultOptions,
        attempts: this.emailConfig.retryDelays.length,
        backoff: {
          type: 'custom',
          delay: (attemptsMade) => {
            return this.emailConfig.retryDelays[attemptsMade - 1] || 60000;
          }
        }
      }
    });

    // Configuration des handlers par défaut
    const emailHandlers = this.createEmailHandlers();
    this.startWorker(this.emailConfig.defaultQueue, emailHandlers, { 
      concurrency: this.emailConfig.concurrency || 3 
    });

    this.log('✅ MailManager initialisé avec la queue emails');
  }

  /**
   * Envoie un email simple
   */
  async sendEmail(to, subject, content, options = {}) {
    const emailData = {
      to: Array.isArray(to) ? to : [to],
      subject,
      content,
      template: options.template,
      templateData: options.templateData,
      attachments: options.attachments,
      priority: options.priority || 'normal',
      ...options
    };

    return this.addJob(
      this.emailConfig.defaultQueue,
      'send-email',
      emailData,
      {
        priority: this.getPriorityValue(options.priority),
        delay: options.delay || 0,
        ...options.jobOptions
      }
    );
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(to, userData, options = {}) {
    return this.sendEmail(
      to,
      options.subject || 'Bienvenue !',
      null,
      {
        template: 'welcome',
        templateData: userData,
        priority: 'high',
        ...options
      }
    );
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   */
  async sendPasswordResetEmail(to, resetToken, options = {}) {
    return this.sendEmail(
      to,
      options.subject || 'Réinitialisation de votre mot de passe',
      null,
      {
        template: 'password-reset',
        templateData: { resetToken, ...options.templateData },
        priority: 'high',
        ...options
      }
    );
  }

  /**
   * Envoie une newsletter
   */
  async sendNewsletter(recipients, newsletterData, options = {}) {
    const jobs = [];
    
    for (const recipient of recipients) {
      const job = await this.sendEmail(
        recipient.email,
        newsletterData.subject,
        null,
        {
          template: 'newsletter',
          templateData: { ...newsletterData, recipient },
          priority: 'low',
          ...options
        }
      );
      jobs.push(job);
    }

    this.log(`📧 Newsletter envoyée à ${recipients.length} destinataires`);
    return jobs;
  }

  /**
   * Envoie des emails en lot
   */
  async sendBulkEmails(emails, options = {}) {
    const jobs = [];
    
    for (const email of emails) {
      const job = await this.sendEmail(
        email.to,
        email.subject,
        email.content,
        {
          ...email,
          ...options
        }
      );
      jobs.push(job);
    }

    this.log(`📧 ${emails.length} emails envoyés en lot`);
    return jobs;
  }

  /**
   * Planifie un email récurrent
   */
  async scheduleRecurringEmail(to, subject, content, cronPattern, options = {}) {
    return this.scheduleJob(
      this.emailConfig.defaultQueue,
      'send-email',
      {
        to: Array.isArray(to) ? to : [to],
        subject,
        content,
        ...options
      },
      cronPattern,
      {
        jobId: `recurring-email-${Date.now()}`,
        ...options.jobOptions
      }
    );
  }

  /**
   * Crée les handlers spécialisés pour les emails
   */
  createEmailHandlers() {
    return {
      'send-email': async (data, job) => {
        this.log(`📧 Envoi email à ${data.to.join(', ')}: ${data.subject}`);
        
        try {
          await job.updateProgress(10);

          // Validation des données
          if (!data.to || data.to.length === 0) {
            throw new Error('Destinataire requis');
          }
          if (!data.subject) {
            throw new Error('Sujet requis');
          }

          await job.updateProgress(30);

          // Préparation du contenu
          let emailContent = data.content;
          if (data.template && this.emailConfig.templates[data.template]) {
            emailContent = await this.renderTemplate(data.template, data.templateData);
          }

          await job.updateProgress(60);

          // Envoi via le service email
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

          const finalResult = {
            success: true,
            messageId: result.messageId,
            recipients: data.to,
            subject: data.subject,
            sentAt: new Date(),
            emailService: result
          };

          this.log(`✅ Email envoyé avec succès (ID: ${result.messageId})`);
          return finalResult;

        } catch (error) {
          this.logError(`❌ Erreur envoi email:`, error);
          throw error;
        }
      },

      'send-welcome': async (data, job) => {
        this.log(`📧 Envoi email de bienvenue à ${data.to}`);
        
        // Simulation de l'envoi d'email de bienvenue
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (job.updateProgress) {
          await job.updateProgress(50);
        }
        
        // Simulation de la finalisation
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        this.log(`✅ Email de bienvenue envoyé à ${data.to}`);
        return { success: true, sentTo: data.to, type: 'welcome' };
      },

      'send-newsletter': async (data, job) => {
        this.log(`📰 Envoi newsletter à ${data.to}`);
        
        // Simulation de la préparation
        await new Promise(resolve => setTimeout(resolve, 800));
        
        if (job.updateProgress) {
          await job.updateProgress(70);
        }
        
        // Simulation de l'envoi
        await new Promise(resolve => setTimeout(resolve, 1200));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        this.log(`✅ Newsletter envoyée à ${data.to}`);
        return { success: true, sentTo: data.to, type: 'newsletter' };
      },

      'send-reset-password': async (data, job) => {
        this.log(`🔐 Envoi email de réinitialisation à ${data.to}`);
        
        // Validation des données
        if (!data.resetToken) {
          throw new Error('Token de réinitialisation manquant');
        }
        
        await new Promise(resolve => setTimeout(resolve, 600));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        this.log(`✅ Email de réinitialisation envoyé à ${data.to}`);
        return { success: true, sentTo: data.to, type: 'reset-password' };
      },

      'send-notification': async (data, job) => {
        this.log(`🔔 Envoi notification à ${data.to}: ${data.subject}`);
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        this.log(`✅ Notification envoyée à ${data.to}`);
        return { success: true, sentTo: data.to, type: 'notification' };
      },

      // Handlers pour workflows email
      'validate-email': async (data, job) => {
        this.log(`✅ Validation email pour ${data.to}`);
        
        if (!data.to || !data.to.includes('@')) {
          throw new Error('Email invalide');
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        return { valid: true, email: data.to };
      },

      'prepare-template': async (data, job) => {
        this.log(`📝 Préparation template ${data.template || 'default'}`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (job.updateProgress) {
          await job.updateProgress(100);
        }
        
        return { 
          template: data.template || 'default',
          prepared: true,
          preparationTime: new Date()
        };
      },

      'log-email': async (data, job) => {
        this.log(`📝 Log email ${data.step} pour ${data.to || 'destinataire'}`);
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        return {
          logged: true,
          step: data.step,
          timestamp: new Date()
        };
      },

      'send-personalized-email': async (data, job) => {
        this.log(`📧 Envoi email personnalisé à ${data.recipient.email}`);
        
        // Simulation de personnalisation
        const personalizedContent = data.template.replace('{{name}}', data.recipient.name || 'Cher client');
        
        await new Promise(resolve => setTimeout(resolve, 600));
        
        return {
          success: true,
          recipient: data.recipient.email,
          campaignId: data.campaignId,
          personalizedContent
        };
      },

      'prepare-campaign': async (data, job) => {
        this.log(`📋 Préparation campagne newsletter`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
          campaignPrepared: true,
          template: data.template,
          preparationTime: new Date()
        };
      }
    };
  }

  /**
   * Rend un template d'email
   */
  async renderTemplate(templateName, data) {
    const template = this.emailConfig.templates[templateName];
    if (!template) {
      throw new Error(`Template "${templateName}" non trouvé`);
    }

    // Rendu simple de template (à remplacer par un vrai moteur de template)
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
   * Convertit la priorité en valeur numérique
   */
  getPriorityValue(priority) {
    const priorities = {
      'low': 1,
      'normal': 5,
      'high': 10,
      'urgent': 15
    };
    return priorities[priority] || 5;
  }

  /**
   * Récupère les statistiques spécifiques aux emails
   */
  async getEmailStats() {
    const baseStats = await this.getQueueStats(this.emailConfig.defaultQueue);
    
    return {
      ...baseStats,
      emailQueue: this.emailConfig.defaultQueue,
      retryDelaysCount: this.emailConfig.retryDelays.length,
      templatesCount: Object.keys(this.emailConfig.templates).length,
      hasEmailService: !!this.emailService
    };
  }

  /**
   * Crée un flow d'envoi d'email avec validation
   */
  async createEmailFlow(emailData) {
    const flowDefinition = {
      id: `email-flow-${Date.now()}`,
      name: 'email-workflow',
      queueName: this.emailConfig.defaultQueue,
      data: { emailId: emailData.id, type: 'email-flow' },
      children: [
        {
          name: 'validate-email',
          queueName: this.emailConfig.defaultQueue,
          data: { ...emailData, step: 'validation' }
        },
        {
          name: 'prepare-template',
          queueName: this.emailConfig.defaultQueue,
          data: { ...emailData, step: 'preparation' },
          children: [
            {
              name: 'send-email',
              queueName: this.emailConfig.defaultQueue,
              data: { ...emailData, step: 'sending' }
            },
            {
              name: 'log-email',
              queueName: this.emailConfig.defaultQueue,
              data: { ...emailData, step: 'logging' }
            }
          ]
        }
      ]
    };

    return await this.addFlow(flowDefinition);
  }

  /**
   * Crée un flow de newsletter avec personnalisation
   */
  async createNewsletterFlow(newsletterData) {
    const { recipients, template } = newsletterData;
    
    const flowDefinition = {
      id: `newsletter-flow-${Date.now()}`,
      name: 'newsletter-workflow',
      queueName: this.emailConfig.defaultQueue,
      data: { campaignId: newsletterData.campaignId, type: 'newsletter-flow' },
      children: [
        {
          name: 'prepare-campaign',
          queueName: this.emailConfig.defaultQueue,
          data: { template, step: 'preparation' },
          children: recipients.map(recipient => ({
            name: 'send-personalized-email',
            queueName: this.emailConfig.defaultQueue,
            data: { 
              recipient, 
              template, 
              step: 'personalized-sending',
              campaignId: newsletterData.campaignId
            }
          }))
        },
        {
          name: 'generate-report',
          queueName: this.emailConfig.defaultQueue,
          data: { 
            campaignId: newsletterData.campaignId, 
            recipientCount: recipients.length,
            step: 'reporting'
          }
        }
      ]
    };

    return await this.addFlow(flowDefinition);
  }

  /**
   * Méthodes statiques pour créer des templates d'exemple
   */
  static createSampleTemplates() {
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
          Cliquez sur ce lien pour le réinitialiser : {{resetLink}}
          
          Si vous n'avez pas fait cette demande, ignorez cet email.
          
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
}

module.exports = MailManager; 