const nodemailer = require('nodemailer');

/**
 * @typedef {Object} EmailConfig
 * @property {string} from - Adresse email d'envoi
 * @property {string} password - Mot de passe d'application Gmail
 * @property {boolean} [isProduction] - Mode production
 */

/**
 * Service d'envoi d'emails utilisant Nodemailer avec Gmail
 */
class EmailService {
    /**
     * Crée une instance du service d'email
     * @param {EmailConfig} config - Configuration du service
     */
    constructor(config) {
        this.config = config;
        this.transporter = null;
        this.initialize();
    }

    /**
     * Initialise le transporteur Nodemailer
     * @private
     */
    initialize() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: this.config.from,
                pass: this.config.password
            }
        });
    }

    /**
     * Envoie un email
     * @param {Object} options - Options d'envoi
     * @param {string|string[]} options.to - Destinataire(s)
     * @param {string} options.subject - Sujet de l'email
     * @param {string} [options.text] - Contenu texte
     * @param {string} [options.html] - Contenu HTML
     * @param {Array} [options.attachments] - Pièces jointes
     * @returns {Promise<Object>} Résultat de l'envoi
     */
    async sendMail(options) {
        try {
            if (!this.config.isProduction) {
                console.log('📧 Mode test - Email qui serait envoyé :', {
                    from: this.config.from,
                    to: options.to,
                    subject: options.subject
                });
            }

            const result = await this.transporter.sendMail({
                from: this.config.from,
                to: Array.isArray(options.to) ? options.to.join(',') : options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
                attachments: options.attachments
            });

            return {
                success: true,
                messageId: result.messageId,
                response: result.response
            };
        } catch (error) {
            console.error('❌ Erreur envoi email:', error);
            throw error;
        }
    }

    /**
     * Vérifie la connexion au serveur SMTP
     * @returns {Promise<boolean>} État de la connexion
     */
    async verifyConnection() {
        try {
            await this.transporter.verify();
            return true;
        } catch (error) {
            console.error('❌ Erreur connexion SMTP:', error);
            return false;
        }
    }
}

module.exports = EmailService;