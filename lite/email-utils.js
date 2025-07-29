const ejs = require('ejs');
const path = require('path');
const fs = require('fs').promises;

/**
 * @fileoverview Email Utils - Utilitaires pour la gestion des emails avec templates EJS
 * 
 * Module contenant :
 * - Templates d'emails EJS depuis le dossier templates/
 * - Système de rendu de templates avec EJS
 * - Gestion des priorités BullMQ
 * - Validation et formatage des données email
 * - Utilitaires avancés pour l'optimisation des envois
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

/**
 * @typedef {Object} EmailTemplate
 * @property {string} subject - Sujet de l'email
 * @property {string} content - Contenu HTML de l'email
 */

/**
 * @typedef {Object} EmailData
 * @property {string[]} to - Liste des destinataires
 * @property {string} subject - Sujet de l'email
 * @property {string} content - Contenu de l'email
 * @property {string} [template] - Nom du template à utiliser
 * @property {Object} [templateData] - Données pour le template
 * @property {Array} [attachments] - Pièces jointes
 * @property {string} [priority] - Priorité de l'email
 * @property {number} [delay] - Délai avant envoi
 */

/**
 * @typedef {Object} JobOptions
 * @property {number} priority - Priorité numérique pour BullMQ
 * @property {number} delay - Délai en millisecondes
 * @property {number} [attempts] - Nombre de tentatives
 * @property {Object} [backoff] - Configuration de retry
 * @property {number} [removeOnComplete] - Nombre de jobs complétés à conserver
 * @property {number} [removeOnFail] - Nombre de jobs échoués à conserver
 */

/**
 * @typedef {Object} NewsletterData
 * @property {string} subject - Sujet de la newsletter
 * @property {string} [intro] - Introduction de la newsletter
 * @property {Array} [articles] - Articles de la newsletter
 * @property {Object} [stats] - Statistiques du mois
 * @property {Array} [events] - Événements à venir
 * @property {Array} [tips] - Conseils du mois
 * @property {Object} [teamSpotlight] - Équipe à l'honneur
 * @property {Object} [callToAction] - Appel à l'action
 * @property {string} [unsubscribeUrl] - Lien de désabonnement
 * @property {string} [webVersionUrl] - Version web
 */

/**
 * @typedef {Object} EmailReport
 * @property {number} total - Nombre total d'emails
 * @property {number} successful - Nombre d'emails envoyés avec succès
 * @property {number} failed - Nombre d'emails échoués
 * @property {number} successRate - Taux de succès en pourcentage
 * @property {Array} details - Détails des résultats
 */

/**
 * EmailUtils - Classe utilitaire statique pour la gestion des emails avec EJS
 * 
 * Cette classe fournit tous les utilitaires nécessaires pour :
 * - Rendu de templates EJS depuis le dossier templates/
 * - Validation et formatage des données email
 * - Gestion des priorités et options BullMQ
 * - Optimisation des envois d'emails
 * 
 * @class EmailUtils
 */
class EmailUtils {
  
  /**
   * Chemin vers le dossier des templates EJS
   * @type {string}
   * @static
   * @readonly
   */
  static TEMPLATES_DIR = path.join(__dirname, 'templates');

  /**
   * Cache des templates compilés pour optimiser les performances
   * @type {Map<string, Function>}
   * @static
   * @private
   */
  static templateCache = new Map();

  /**
   * Mapping des templates disponibles
   * @type {Object<string, string>}
   * @static
   * @readonly
   */
  static AVAILABLE_TEMPLATES = {
    welcome: 'welcome.ejs',
    newsletter: 'newsletter.ejs',
    'password-reset': 'password-reset.ejs',
    'reminder-before-due': 'reminder-before-due.ejs',
    'reminder-overdue': 'reminder-overdue.ejs'
  };

  /**
   * Rend un template EJS avec les données fournies
   * 
   * @async
   * @static
   * @param {string} templateName - Nom du template (sans extension)
   * @param {Object} data - Données à injecter dans le template
   * @param {Object} [options] - Options de rendu EJS
   * @param {boolean} [options.cache=true] - Utiliser le cache des templates
   * @param {boolean} [options.async=true] - Rendu asynchrone
   * @returns {Promise<string>} Contenu HTML rendu
   * @throws {Error} Si le template n'existe pas ou si le rendu échoue
   * 
   * @example
   * // Rendu d'un email de bienvenue
   * const html = await EmailUtils.renderTemplate('welcome', {
   *   name: 'Alice',
   *   userData: { role: 'Manager', department: 'Finance' }
   * });
   * 
   * @example
   * // Rendu d'un rappel avec données complètes
   * const html = await EmailUtils.renderTemplate('reminder-before-due', {
   *   recipient: { name: 'Bob', email: 'bob@company.com' },
   *   reimbursement: { id: 'RBT-001', amount: 1500, dueDate: '2025-02-15' },
   *   daysInfo: { remainingDays: 5 }
   * });
   */
  static async renderTemplate(templateName, data, options = {}) {
    try {
      const templateFile = this.AVAILABLE_TEMPLATES[templateName];
      if (!templateFile) {
        throw new Error(`Template "${templateName}" non trouvé. Templates disponibles: ${Object.keys(this.AVAILABLE_TEMPLATES).join(', ')}`);
      }

      const templatePath = path.join(this.TEMPLATES_DIR, templateFile);
      const cacheKey = `${templateName}_${options.cache !== false}`;

      // Vérification du cache si activé
      if (options.cache !== false && this.templateCache.has(cacheKey)) {
        const compiledTemplate = this.templateCache.get(cacheKey);
        return compiledTemplate(data);
      }

      // Lecture et compilation du template
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      const ejsOptions = {
        async: options.async !== false,
        filename: templatePath,
        cache: options.cache !== false,
        ...options
      };

      // Rendu du template
      const renderedContent = await ejs.render(templateContent, data, ejsOptions);

      // Mise en cache si activé
      if (options.cache !== false) {
        const compiledTemplate = ejs.compile(templateContent, ejsOptions);
        this.templateCache.set(cacheKey, compiledTemplate);
      }

      return renderedContent;

    } catch (error) {
      throw new Error(`Erreur lors du rendu du template "${templateName}": ${error.message}`);
    }
  }

  /**
   * Convertit la priorité textuelle en valeur numérique pour BullMQ
   * 
   * @static
   * @param {string} priority - Priorité textuelle ('low', 'normal', 'high', 'urgent')
   * @returns {number} Valeur numérique de priorité (1-15)
   * 
   * @example
   * const priority = EmailUtils.getPriorityValue('high'); // Retourne 10
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
   * Retourne les informations de template appropriées pour les rappels
   * 
   * @static
   * @param {string} emailType - Type d'email ('payment-reminder', 'payment-overdue')
   * @param {Object} daysInfo - Informations sur les jours restants/en retard
   * @param {number} [daysInfo.remainingDays] - Jours restants avant échéance
   * @param {number} [daysInfo.overdueDays] - Jours de retard
   * @param {boolean} [daysInfo.isOverdue] - Indicateur de retard
   * @returns {Object} Objet contenant le sujet et le nom du template
   * 
   * @example
   * const templateInfo = EmailUtils.getEmailTemplate('payment-reminder', { remainingDays: 3 });
   * // Retourne: { subject: 'Rappel : Échéance...', template: 'reminder-before-due' }
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
        subject: `URGENT : Paiement de remboursement en retard${daysInfo.overdueDays ? ` (${daysInfo.overdueDays} jours)` : ''}`,
        template: 'reminder-overdue'
      }
    };

    return templates[emailType] || templates['payment-reminder'];
  }

  /**
   * Valide les données d'email avant envoi
   * 
   * @static
   * @param {EmailData} emailData - Données d'email à valider
   * @returns {string[]} Tableau des erreurs de validation (vide si valide)
   * 
   * @example
   * const errors = EmailUtils.validateEmailData({
   *   to: ['invalid-email'],
   *   subject: '',
   *   content: 'Test'
   * });
   * // Retourne: ['Sujet requis', 'Emails invalides : invalid-email']
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

    // Validation du template si spécifié
    if (emailData.template && !this.AVAILABLE_TEMPLATES[emailData.template]) {
      errors.push(`Template "${emailData.template}" non disponible. Templates disponibles: ${Object.keys(this.AVAILABLE_TEMPLATES).join(', ')}`);
    }

    return errors;
  }

  /**
   * Formate les données d'email pour l'envoi
   * 
   * @static
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @param {string} content - Contenu de l'email
   * @param {Object} [options={}] - Options supplémentaires
   * @param {string} [options.template] - Template à utiliser
   * @param {Object} [options.templateData] - Données pour le template
   * @param {Array} [options.attachments] - Pièces jointes
   * @param {string} [options.priority='normal'] - Priorité de l'email
   * @param {number} [options.delay=0] - Délai avant envoi
   * @returns {EmailData} Données d'email formatées
   * 
   * @example
   * const emailData = EmailUtils.formatEmailData(
   *   'user@example.com',
   *   'Test Subject',
   *   'Test Content',
   *   { priority: 'high', template: 'welcome' }
   * );
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
   * 
   * @static
   * @param {Object} [options={}] - Options d'email
   * @param {string} [options.priority='normal'] - Priorité de l'email
   * @param {number} [options.delay=0] - Délai avant envoi
   * @param {number} [options.attempts] - Nombre de tentatives
   * @param {Object} [options.backoff] - Configuration de retry
   * @param {number} [options.removeOnComplete] - Jobs complétés à conserver
   * @param {number} [options.removeOnFail] - Jobs échoués à conserver
   * @param {Object} [options.jobOptions] - Options BullMQ supplémentaires
   * @returns {JobOptions} Options formatées pour BullMQ
   * 
   * @example
   * const jobOptions = EmailUtils.createJobOptions({
   *   priority: 'high',
   *   delay: 5000,
   *   attempts: 3
   * });
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
   * 
   * @static
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @returns {string} ID unique pour l'email récurrent
   * 
   * @example
   * const id = EmailUtils.generateRecurringEmailId('user@example.com', 'Weekly Report');
   * // Retourne: 'recurring-email-weekly-report-1643723400000'
   */
  static generateRecurringEmailId(to, subject) {
    const recipients = Array.isArray(to) ? to.join('-') : to;
    const cleanSubject = subject.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const hash = recipients.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `recurring-email-${cleanSubject}-${hash}-${Date.now()}`;
  }

  /**
   * Prépare les données pour un email de newsletter
   * 
   * @static
   * @param {Array} recipients - Liste des destinataires avec email et nom
   * @param {NewsletterData} newsletterData - Données de la newsletter
   * @param {Object} [options={}] - Options supplémentaires
   * @param {string} [options.month] - Mois de la newsletter
   * @returns {EmailData[]} Tableau de données d'email pour chaque destinataire
   * 
   * @example
   * const emailsData = EmailUtils.prepareNewsletterData(
   *   [{ email: 'user1@example.com', name: 'Alice' }],
   *   { subject: 'Newsletter Janvier', intro: 'Voici les nouvelles...' },
   *   { month: 'janvier' }
   * );
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
   * 
   * @static
   * @param {string|string[]} to - Destinataire(s)
   * @param {Object} userData - Données utilisateur
   * @param {string} userData.name - Nom de l'utilisateur
   * @param {string} [userData.role] - Rôle de l'utilisateur
   * @param {string} [userData.department] - Département
   * @param {string} [userData.loginUrl] - URL de connexion
   * @param {Object} [options={}] - Options supplémentaires
   * @param {string} [options.subject] - Sujet personnalisé
   * @returns {EmailData} Données d'email de bienvenue
   * 
   * @example
   * const welcomeData = EmailUtils.prepareWelcomeEmailData(
   *   'newuser@example.com',
   *   { name: 'Alice', role: 'Manager', department: 'Finance' }
   * );
   */
  static prepareWelcomeEmailData(to, userData, options = {}) {
    return {
      to: Array.isArray(to) ? to : [to],
      subject: options.subject || `Bienvenue ${userData.name || ''} !`,
      content: null,
      template: 'welcome',
      templateData: {
        name: userData.name || 'Cher utilisateur',
        userData,
        ...userData
      },
      priority: 'high',
      ...options
    };
  }

  /**
   * Nettoie et formate les adresses email
   * 
   * @static
   * @param {string|string[]} emails - Email(s) à nettoyer
   * @returns {string[]} Tableau d'emails nettoyés et dédoublonnés
   * 
   * @example
   * const clean = EmailUtils.sanitizeEmails([' User@Example.COM ', 'user@example.com', 'invalid']);
   * // Retourne: ['user@example.com']
   */
  static sanitizeEmails(emails) {
    if (!emails) return [];
    
    const emailArray = Array.isArray(emails) ? emails : [emails];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    return emailArray
      .map(email => email.trim().toLowerCase())
      .filter(email => email && emailRegex.test(email))
      .filter((email, index, self) => self.indexOf(email) === index); // Déduplication
  }

  /**
   * Génère un rapport de statut d'email
   * 
   * @static
   * @param {Array} emailResults - Résultats des envois d'emails
   * @returns {EmailReport} Rapport détaillé des envois
   * 
   * @example
   * const report = EmailUtils.generateEmailReport([
   *   { success: true, messageId: '123' },
   *   { success: false, error: 'Invalid email' }
   * ]);
   * // Retourne: { total: 2, successful: 1, failed: 1, successRate: 50, details: [...] }
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
   * 
   * @static
   * @param {string} [priority='normal'] - Priorité de l'email
   * @param {string} [timezone='Europe/Paris'] - Fuseau horaire
   * @returns {number} Délai en millisecondes avant l'envoi optimal
   * 
   * @example
   * const delay = EmailUtils.calculateOptimalSendTime('high');
   * // Retourne le délai pour envoyer aux heures ouvrables si nécessaire
   */
  static calculateOptimalSendTime(priority = 'normal', timezone = 'Europe/Paris') {
    const now = new Date();
    const hour = now.getHours();

    // Logique d'optimisation basée sur la priorité
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

  /**
   * Vérifie la disponibilité d'un template
   * 
   * @static
   * @param {string} templateName - Nom du template à vérifier
   * @returns {boolean} True si le template existe
   * 
   * @example
   * const exists = EmailUtils.templateExists('welcome'); // true
   * const notExists = EmailUtils.templateExists('unknown'); // false
   */
  static templateExists(templateName) {
    return Object.hasOwnProperty.call(this.AVAILABLE_TEMPLATES, templateName);
  }

  /**
   * Liste tous les templates disponibles
   * 
   * @static
   * @returns {string[]} Tableau des noms de templates disponibles
   * 
   * @example
   * const templates = EmailUtils.getAvailableTemplates();
   * // Retourne: ['welcome', 'newsletter', 'password-reset', ...]
   */
  static getAvailableTemplates() {
    return Object.keys(this.AVAILABLE_TEMPLATES);
  }

  /**
   * Vide le cache des templates compilés
   * 
   * @static
   * @returns {void}
   * 
   * @example
   * EmailUtils.clearTemplateCache(); // Vide le cache pour forcer la recompilation
   */
  static clearTemplateCache() {
    this.templateCache.clear();
  }

  /**
   * Obtient les statistiques du cache des templates
   * 
   * @static
   * @returns {Object} Statistiques du cache
   * 
   * @example
   * const stats = EmailUtils.getCacheStats();
   * // Retourne: { size: 5, templates: ['welcome', 'newsletter', ...] }
   */
  static getCacheStats() {
    return {
      size: this.templateCache.size,
      templates: Array.from(this.templateCache.keys())
    };
  }

  /**
   * Précompile tous les templates disponibles pour optimiser les performances
   * 
   * @static
   * @async
   * @returns {Promise<void>}
   * @throws {Error} Si la précompilation échoue
   * 
   * @example
   * await EmailUtils.precompileTemplates(); // Précompile tous les templates
   */
  static async precompileTemplates() {
    try {
      const templates = Object.keys(this.AVAILABLE_TEMPLATES);
      const precompilePromises = templates.map(async (templateName) => {
        try {
          // Rendu avec des données vides pour compiler le template
          await this.renderTemplate(templateName, {}, { cache: true });
        } catch (error) {
          console.warn(`Avertissement: Impossible de précompiler le template "${templateName}": ${error.message}`);
        }
      });

      await Promise.all(precompilePromises);
      console.log(`Templates précompilés: ${this.templateCache.size}/${templates.length}`);
    } catch (error) {
      throw new Error(`Erreur lors de la précompilation des templates: ${error.message}`);
    }
  }
}

module.exports = EmailUtils;