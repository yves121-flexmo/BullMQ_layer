const nodemailer = require('nodemailer');
const path = require('path');
const ejs = require('ejs');

/**
 * Service d'envoi d'emails
 * Fournit les fonctionnalités pour envoyer des emails via Nodemailer
 */
class EmailService {
    constructor(config = {}) {
        this.config = {
            isProduction: config.isProduction || process.env.NODE_ENV === 'production',
            loggerService: config.loggerService,
            email: config.email || process.env.GMAIL_USER || 'contact@flexmo.app',
            password: config.password || process.env.GMAIL_APP_PASSWORD,
            templatesDir: config.templatesDir || path.join(process.cwd(), 'lite', 'templates'),
            defaultFrom: 'Flexmo <contact@flexmo.app>'
        };

        // Métriques en mémoire
        this.metrics = {
            emails: {
                sent: 0,
                failed: 0,
                byTemplate: {}
            },
            startTime: new Date()
        };

        this.initializeTransporter();
    }

    /**
     * Initialise le transporteur Nodemailer
     * @private
     */
    initializeTransporter() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: this.config.email,
                pass: this.config.password
            }
        });
    }

    /**
     * Vérifie la connexion au serveur SMTP
     * @returns {Promise<boolean>} État de la connexion
     */
    async verifyConnection() {
        try {
            await this.transporter.verify();
            this.log('✅ Connexion SMTP vérifiée');
            return true;
        } catch (error) {
            this.logError('❌ Erreur connexion SMTP:', error);
            return false;
        }
    }

    /**
     * Envoie un email de rappel
     * @param {Object} options - Options d'envoi
     * @param {string} options.type - Type d'email ('payment-reminder' ou 'payment-overdue')
     * @param {Array} options.recipients - Liste des destinataires
     * @param {Object} options.reimbursement - Données du remboursement
     * @param {Object} options.daysInfo - Informations sur les jours
     * @param {Object} options.template - Configuration du template
     * @returns {Promise<Object>} Résultat de l'envoi
     */
    async sendReminderEmail(options) {
        const { type, recipients, reimbursement, daysInfo, template } = options;
        
        try {
            // Rendu du template
            const templatePath = path.join(this.config.templatesDir, `${template.template}.ejs`);
            const html = await ejs.renderFile(templatePath, {
                reimbursement,
                daysInfo,
                recipient: recipients[0], // Premier destinataire pour personnalisation
                supportContact: {
                    email: 'contact@flexmo.app',
                    phone: '+225 07 47 51 00 00'
                }
            });

            // Configuration de l'email
            const mailOptions = {
                from: this.config.defaultFrom,
                to: recipients.map(r => r.email).join(', '),
                subject: template.subject,
                html
            };

            // Envoi
            const result = await this.sendMail(mailOptions);
            
            // Mise à jour des métriques
            this.updateMetrics(type, true);
            
            return {
                success: true,
                messageId: result.messageId,
                type,
                recipientCount: recipients.length
            };

        } catch (error) {
            this.logError(`❌ Erreur envoi email ${type}:`, error);
            this.updateMetrics(type, false);
            throw error;
        }
    }

    /**
     * Envoie un email
     * @param {Object} options - Options d'envoi Nodemailer
     * @returns {Promise<Object>} Résultat de l'envoi
     */
    async sendMail(options) {
        this.log('📧 Envoi email:', { to: options.to, subject: options.subject });

        try {
            const result = await this.transporter.sendMail({
                ...options,
                from: options.from || this.config.defaultFrom
            });

            this.log('✅ Email envoyé:', result.messageId);
            return result;
        } catch (error) {
            this.logError('❌ Erreur envoi email:', error);
            throw error;
        }
    }

    /**
     * Met à jour les métriques
     * @private
     * @param {string} type - Type d'email
     * @param {boolean} success - Si l'envoi a réussi
     */
    updateMetrics(type, success) {
        if (success) {
            this.metrics.emails.sent++;
        } else {
            this.metrics.emails.failed++;
        }

        if (!this.metrics.emails.byTemplate[type]) {
            this.metrics.emails.byTemplate[type] = { sent: 0, failed: 0 };
        }

        if (success) {
            this.metrics.emails.byTemplate[type].sent++;
        } else {
            this.metrics.emails.byTemplate[type].failed++;
        }
    }

    /**
     * Récupère les métriques d'envoi
     * @returns {Object} Métriques
     */
    getMetrics() {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.startTime.getTime(),
            successRate: this.calculateSuccessRate()
        };
    }

    /**
     * Calcule le taux de succès des envois
     * @private
     * @returns {number} Taux de succès en pourcentage
     */
    calculateSuccessRate() {
        const total = this.metrics.emails.sent + this.metrics.emails.failed;
        if (total === 0) return 100;
        return (this.metrics.emails.sent / total) * 100;
    }

    /**
     * Logger intelligent selon l'environnement
     * @param {string} message - Message à logger
     * @param {*} data - Données additionnelles
     */
    log(message, data = null) {
        if (!this.config.isProduction) {
            console.log(message, data || '');
        } else if (this.config.loggerService) {
            this.config.loggerService.info(message, data);
        }
    }

    /**
     * Logger d'erreurs
     * @param {string} message - Message d'erreur
     * @param {Error} error - Erreur
     */
    logError(message, error) {
        if (!this.config.isProduction) {
            console.error(message, error);
        } else if (this.config.loggerService) {
            this.config.loggerService.error(message, { error: error.message, stack: error.stack });
        }
    }
}

module.exports = EmailService;