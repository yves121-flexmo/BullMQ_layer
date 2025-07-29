/**
 * Email Utils - Utilitaires pour la gestion des emails
 * 
 * Module contenant :
 * - Templates d'emails par défaut
 * - Système de rendu de templates
 * - Gestion des priorités
 * - Templates de rappels spécialisés
 */

class EmailUtils {
  /**
   * Templates d'emails par défaut
   */
  static getEmailTemplates() {
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
      },
      'reminder-before-due': {
        subject: 'Rappel : Échéance de remboursement',
        content: `
          Bonjour {{recipient.name}},
          
          Votre remboursement {{reimbursement.id}} arrive à échéance dans {{daysInfo.remainingDays}} jours.
          
          Montant : {{reimbursement.amount}}€
          Date d'échéance : {{reimbursement.dueDate}}
          
          Merci de procéder au règlement dans les délais.
          
          Cordialement,
          L'équipe Finance
        `
      },
      'reminder-overdue': {
        subject: 'URGENT : Paiement en retard',
        content: `
          Bonjour {{recipient.name}},
          
          ATTENTION : Votre remboursement {{reimbursement.id}} est en retard de {{daysInfo.overdueDays}} jours.
          
          Montant : {{reimbursement.amount}}€
          Date d'échéance dépassée : {{reimbursement.dueDate}}
          
          Merci de régulariser la situation rapidement.
          
          Cordialement,
          L'équipe Finance
        `
      }
    };
  }

  /**
   * Rend un template avec les données fournies
   */
  static async renderTemplate(templateName, data) {
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
      
      // Support pour les objets imbriqués (ex: {{recipient.name}})
      content = content.replace(/{{(\w+)\.(\w+)}}/g, (match, obj, prop) => {
        return data[obj] && data[obj][prop] ? data[obj][prop] : match;
      });
    }

    return content;
  }

  /**
   * Convertit la priorité en valeur numérique pour BullMQ
   */
  static getPriorityValue(priority) {
    const priorities = {
      'low': 1,
      'normal': 5,
      'high': 10,
      'urgent': 15
    };
    return priorities[priority] || 5;
  }

  /**
   * Retourne le template d'email approprié pour les rappels
   */
  static getEmailTemplate(emailType, daysInfo) {
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
   * Valide les données d'email
   */
  static validateEmailData(emailData) {
    const errors = [];

    if (!emailData.to || emailData.to.length === 0) {
      errors.push('Destinataire requis');
    }

    if (!emailData.subject) {
      errors.push('Sujet requis');
    }

    // Validation des emails
    if (emailData.to) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = emailData.to.filter(email => !emailRegex.test(email));
      if (invalidEmails.length > 0) {
        errors.push(`Emails invalides : ${invalidEmails.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Formatage des données d'email pour l'envoi
   */
  static formatEmailData(to, subject, content, options = {}) {
    return {
      to: Array.isArray(to) ? to : [to],
      subject,
      content,
      template: options.template,
      templateData: options.templateData,
      attachments: options.attachments,
      priority: options.priority || 'normal',
      delay: options.delay || 0,
      ...options
    };
  }

  /**
   * Crée les options de job pour BullMQ
   */
  static createJobOptions(options = {}) {
    return {
      priority: this.getPriorityValue(options.priority),
      delay: options.delay || 0,
      attempts: options.attempts,
      backoff: options.backoff,
      removeOnComplete: options.removeOnComplete,
      removeOnFail: options.removeOnFail,
      ...options.jobOptions
    };
  }

  /**
   * Génère un ID unique pour les emails récurrents
   */
  static generateRecurringEmailId(to, subject) {
    const recipients = Array.isArray(to) ? to.join('-') : to;
    const cleanSubject = subject.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `recurring-email-${cleanSubject}-${Date.now()}`;
  }

  /**
   * Prépare les données pour un email de newsletter
   */
  static prepareNewsletterData(recipients, newsletterData, options = {}) {
    return recipients.map(recipient => ({
      to: recipient.email,
      subject: newsletterData.subject,
      content: null,
      template: 'newsletter',
      templateData: {
        ...newsletterData,
        recipient,
        month: options.month || new Date().toLocaleDateString('fr-FR', { month: 'long' })
      },
      priority: 'low',
      ...options
    }));
  }

  /**
   * Crée les données pour un email de bienvenue
   */
  static prepareWelcomeEmailData(to, userData, options = {}) {
    return {
      to: Array.isArray(to) ? to : [to],
      subject: options.subject || `Bienvenue ${userData.name || ''} !`,
      content: null,
      template: 'welcome',
      templateData: {
        name: userData.name || 'Cher utilisateur',
        ...userData
      },
      priority: 'high',
      ...options
    };
  }

  /**
   * Utilitaire pour nettoyer et formater les emails
   */
  static sanitizeEmails(emails) {
    if (!emails) return [];
    
    const emailArray = Array.isArray(emails) ? emails : [emails];
    
    return emailArray
      .map(email => email.trim().toLowerCase())
      .filter(email => email && email.includes('@'))
      .filter((email, index, self) => self.indexOf(email) === index); // Déduplication
  }

  /**
   * Génère un rapport de statut d'email
   */
  static generateEmailReport(emailResults) {
    const successful = emailResults.filter(r => r.success).length;
    const failed = emailResults.filter(r => !r.success).length;
    const total = emailResults.length;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      details: emailResults
    };
  }

  /**
   * Calcule le meilleur moment pour envoyer un email
   */
  static calculateOptimalSendTime(priority = 'normal', timezone = 'Europe/Paris') {
    const now = new Date();
    const hour = now.getHours();

    // Logique simple d'optimisation
    let delay = 0;

    if (priority === 'urgent') {
      delay = 0; // Envoi immédiat
    } else if (priority === 'high') {
      // Si c'est en dehors des heures ouvrables, attendre 8h
      if (hour < 8 || hour > 18) {
        const tomorrow8am = new Date(now);
        tomorrow8am.setDate(tomorrow8am.getDate() + (hour >= 18 ? 1 : 0));
        tomorrow8am.setHours(8, 0, 0, 0);
        delay = tomorrow8am.getTime() - now.getTime();
      }
    } else if (priority === 'low') {
      // Envoyer à 10h le lendemain si après 15h
      if (hour >= 15) {
        const tomorrow10am = new Date(now);
        tomorrow10am.setDate(tomorrow10am.getDate() + 1);
        tomorrow10am.setHours(10, 0, 0, 0);
        delay = tomorrow10am.getTime() - now.getTime();
      }
    }

    return Math.max(0, delay);
  }
}

module.exports = EmailUtils;