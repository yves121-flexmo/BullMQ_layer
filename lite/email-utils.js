/**
 * @fileoverview Utilitaires pour les emails et templates EJS
 * 
 * Module contenant les utilitaires pour :
 * - Gestion des templates EJS
 * - Formatage des données d'email
 * - Validation des emails
 * - Gestion des priorités
 * - Génération de rapports
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

const ejs = require('ejs');
const path = require('path');
const fs = require('fs').promises;

// Cache des templates compilés
const templateCache = new Map();

// Templates disponibles
const AVAILABLE_TEMPLATES = {
  'reminder-before-due': {
    template: 'reminder-before-due',
    subject: 'Rappel : Paiement à venir'
  },
  'reminder-overdue': {
    template: 'reminder-overdue',
    subject: 'URGENT : Paiement en retard'
  },
  'newsletter': {
    template: 'newsletter',
    subject: 'Newsletter mensuelle'
  }
};

/**
 * @typedef {Object} EmailData
 * @property {string|string[]} to - Destinataire(s)
 * @property {string} subject - Sujet de l'email
 * @property {string} [content] - Contenu de l'email (optionnel si template)
 * @property {string} [template] - Nom du template EJS à utiliser
 * @property {Object} [templateData] - Données pour le template
 * @property {Array} [attachments] - Pièces jointes
 * @property {string} [priority] - Priorité de l'email
 */

/**
 * @typedef {Object} EmailJobOptions
 * @property {string} [priority] - Priorité de l'email
 * @property {number} [delay] - Délai avant envoi
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
 * @typedef {Object} NewsletterData
 * @property {string} subject - Sujet de la newsletter
 * @property {string} [intro] - Introduction
 * @property {Array} [articles] - Articles
 * @property {Object} [stats] - Statistiques
 * @property {Array} [events] - Événements
 * @property {Array} [tips] - Conseils
 */

/**
 * @typedef {Object} EmailReport
 * @property {number} total - Nombre total d'emails
 * @property {number} sent - Nombre d'emails envoyés
 * @property {number} failed - Nombre d'échecs
 * @property {number} bounced - Nombre de bounces
 * @property {number} opened - Nombre d'ouvertures
 * @property {number} clicked - Nombre de clics
 * @property {number} successRate - Taux de succès en pourcentage
 * @property {Object} byType - Statistiques par type d'email
 */

/**
 * Utilitaires pour les emails et templates EJS
 * 
 * Cette classe statique fournit des méthodes utilitaires pour :
 * - La gestion des templates EJS
 * - Le formatage des données d'email
 * - La validation des emails
 * - La gestion des priorités
 * - La génération de rapports
 * 
 * @class EmailUtils
 */
class EmailUtils {

  /**
   * Retourne le template approprié selon le type d'email
   * 
   * @param {string} emailType - Type d'email ('payment-reminder', 'payment-overdue', 'newsletter')
   * @param {Object} [daysInfo] - Informations sur les jours pour les rappels
   * @returns {Object} Template et sujet
   * 
   * @example
   * const template = EmailUtils.getEmailTemplate('payment-reminder', { remainingDays: 5 });
   * console.log(`Template: ${template.template}, Sujet: ${template.subject}`);
   */
  static getEmailTemplate(emailType, daysInfo) {
    const template = AVAILABLE_TEMPLATES[emailType];
    if (!template) {
      throw new Error(`Template non trouvé pour le type: ${emailType}`);
    }
    return template;
  }

  /**
   * Formate les données d'email pour BullMQ
   * 
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @param {string} content - Contenu de l'email
   * @param {Object} [options={}] - Options supplémentaires
   * @returns {EmailData} Données formatées
   * 
   * @example
   * const emailData = EmailUtils.formatEmailData(
   *   'user@example.com',
   *   'Test',
   *   'Contenu',
   *   { priority: 'high' }
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
      priority: options.priority
    };
  }

  /**
   * Prépare les données pour l'envoi de newsletter
   * 
   * @param {Array<NewsletterRecipient>} recipients - Liste des destinataires
   * @param {NewsletterData} newsletterData - Contenu de la newsletter
   * @param {Object} [options={}] - Options supplémentaires
   * @returns {Array<EmailData>} Données d'emails formatées
   * 
   * @example
   * const recipients = [
   *   { email: 'user1@example.com', name: 'Alice' },
   *   { email: 'user2@example.com', name: 'Bob' }
   * ];
   * const newsletterData = {
   *   subject: 'Newsletter Janvier',
   *   intro: 'Voici les actualités...'
   * };
   * const emailsData = EmailUtils.prepareNewsletterData(recipients, newsletterData);
   */
  static prepareNewsletterData(recipients, newsletterData, options = {}) {
    return recipients.map(recipient => ({
      to: recipient.email,
      subject: newsletterData.subject,
      template: 'newsletter',
      templateData: {
        recipient,
        ...newsletterData,
        month: new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })
      },
      priority: options.priority || 'low'
    }));
  }

  /**
   * Crée les options de job BullMQ
   * 
   * @param {EmailJobOptions} options - Options pour le job
   * @returns {Object} Options formatées pour BullMQ
   * 
   * @example
   * const jobOptions = EmailUtils.createJobOptions({
   *   priority: 'high',
   *   delay: 5000
   * });
   */
  static createJobOptions(options = {}) {
    return {
      priority: this.getPriorityValue(options.priority),
      delay: options.delay,
      attempts: options.attempts,
      backoff: options.backoff,
      removeOnComplete: options.removeOnComplete,
      removeOnFail: options.removeOnFail
    };
  }

  /**
   * Convertit la priorité en valeur numérique
   * 
   * @param {string} priority - Priorité textuelle
   * @returns {number} Valeur numérique pour BullMQ
   * 
   * @example
   * const value = EmailUtils.getPriorityValue('high'); // Retourne 10
   */
  static getPriorityValue(priority) {
    const priorities = {
      low: 1,
      normal: 5,
      high: 10,
      urgent: 15
    };
    return priorities[priority] || priorities.normal;
  }

  /**
   * Rend un template EJS avec les données fournies
   * 
   * @async
   * @param {string} templateName - Nom du template
   * @param {Object} data - Données pour le template
   * @returns {Promise<string>} Contenu HTML rendu
   * @throws {Error} Si le template n'existe pas ou si le rendu échoue
   * 
   * @example
   * const html = await EmailUtils.renderTemplate('newsletter', {
   *   recipient: { name: 'Alice' },
   *   articles: [{ title: 'Article 1' }]
   * });
   */
  static async renderTemplate(templateName, data) {
    try {
      // Vérifier le cache
      if (templateCache.has(templateName)) {
        return templateCache.get(templateName)(data);
      }

      // Charger et compiler le template
      const templatePath = path.join(__dirname, 'templates', `${templateName}.ejs`);
      const template = await fs.readFile(templatePath, 'utf-8');
      const compiledTemplate = ejs.compile(template, {
        filename: templatePath,
        cache: true,
        async: false
      });

      // Mettre en cache
      templateCache.set(templateName, compiledTemplate);

      // Rendre
      return compiledTemplate(data);
    } catch (error) {
      throw new Error(`Erreur rendu template ${templateName}: ${error.message}`);
    }
  }

  /**
   * Valide les données d'email
   * 
   * @param {EmailData} emailData - Données d'email à valider
   * @returns {Array<string>} Liste des erreurs (vide si valide)
   * 
   * @example
   * const errors = EmailUtils.validateEmailData({
   *   to: 'invalid-email',
   *   subject: ''
   * });
   * if (errors.length > 0) console.error('Erreurs:', errors);
   */
  static validateEmailData(emailData) {
    const errors = [];

    if (!emailData.to || (Array.isArray(emailData.to) && emailData.to.length === 0)) {
      errors.push('Destinataire requis');
    }

    if (!emailData.subject) {
      errors.push('Sujet requis');
    }

    if (!emailData.content && !emailData.template) {
      errors.push('Contenu ou template requis');
    }

    if (emailData.template && !AVAILABLE_TEMPLATES[emailData.template]) {
      errors.push(`Template invalide: ${emailData.template}`);
    }

    return errors;
  }

  /**
   * Nettoie et valide les adresses email
   * 
   * @param {string|string[]} emails - Email(s) à nettoyer
   * @returns {string[]} Emails valides et nettoyés
   * 
   * @example
   * const clean = EmailUtils.sanitizeEmails([
   *   ' User@Example.COM ',
   *   'invalid-email',
   *   'user2@domain.com'
   * ]);
   */
  static sanitizeEmails(emails) {
    const emailList = Array.isArray(emails) ? emails : [emails];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return [...new Set(
      emailList
        .map(email => email.trim().toLowerCase())
        .filter(email => emailRegex.test(email))
    )];
  }

  /**
   * Génère un ID unique pour les emails récurrents
   * 
   * @param {string|string[]} to - Destinataire(s)
   * @param {string} subject - Sujet de l'email
   * @returns {string} ID unique
   * 
   * @example
   * const jobId = EmailUtils.generateRecurringEmailId(
   *   'team@company.com',
   *   'Daily Report'
   * );
   */
  static generateRecurringEmailId(to, subject) {
    const recipients = Array.isArray(to) ? to.join(',') : to;
    const base = `${recipients}:${subject}`;
    return `recurring-${Buffer.from(base).toString('base64')}`;
  }

  /**
   * Génère un rapport sur les envois d'emails
   * 
   * @param {Array} emailResults - Résultats des envois
   * @returns {EmailReport} Rapport détaillé
   * 
   * @example
   * const report = EmailUtils.generateEmailReport(results);
   * console.log(`Taux de succès: ${report.successRate}%`);
   * console.log('Par type:', report.byType);
   */
  static generateEmailReport(emailResults) {
    const report = {
      total: emailResults.length,
      sent: 0,
      failed: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      byType: {}
    };

    for (const result of emailResults) {
      // Stats par statut
      if (result.status === 'sent') report.sent++;
      if (result.status === 'failed') report.failed++;
      if (result.status === 'bounced') report.bounced++;
      if (result.opened) report.opened++;
      if (result.clicked) report.clicked++;

      // Stats par type
      const type = result.type || 'unknown';
      report.byType[type] = report.byType[type] || { total: 0, success: 0 };
      report.byType[type].total++;
      if (result.status === 'sent') {
        report.byType[type].success++;
      }
    }

    // Calcul taux de succès
    report.successRate = report.total > 0
      ? Math.round((report.sent / report.total) * 100)
      : 100;

    return report;
  }

  /**
   * Calcule le meilleur moment d'envoi selon la priorité
   * 
   * @param {string} priority - Priorité de l'email
   * @param {string} [timezone='UTC'] - Fuseau horaire du destinataire
   * @returns {number} Délai optimal en millisecondes
   * 
   * @example
   * const delay = EmailUtils.calculateOptimalSendTime('high', 'Europe/Paris');
   * console.log(`Envoi dans ${delay}ms`);
   */
  static calculateOptimalSendTime(priority, timezone = 'UTC') {
    const now = new Date();
    const hour = now.getHours();

    // Délai de base selon priorité
    const baseDelay = {
      urgent: 0,
      high: 5 * 60 * 1000,      // 5 minutes
      normal: 15 * 60 * 1000,   // 15 minutes
      low: 60 * 60 * 1000       // 1 heure
    }[priority] || 15 * 60 * 1000;

    // Ajustement selon l'heure
    if (hour < 8 || hour > 20) {
      // Hors heures de bureau, ajouter délai
      return baseDelay + (2 * 60 * 60 * 1000); // +2h
    }

    return baseDelay;
  }
}

module.exports = EmailUtils;