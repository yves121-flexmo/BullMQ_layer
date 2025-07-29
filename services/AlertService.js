/**
 * Service de gestion des alertes
 * Fournit les fonctionnalités pour gérer les alertes et notifications
 */
class AlertService {
    constructor(config = {}) {
        this.config = {
            isProduction: config.isProduction || process.env.NODE_ENV === 'production',
            loggerService: config.loggerService,
            notificationChannels: config.notificationChannels || ['console', 'log'],
            alertLevels: {
                INFO: 'info',
                WARNING: 'warning',
                ERROR: 'error',
                CRITICAL: 'critical'
            }
        };

        // Métriques en mémoire
        this.metrics = {
            alerts: {
                total: 0,
                byLevel: {
                    info: 0,
                    warning: 0,
                    error: 0,
                    critical: 0
                }
            },
            notifications: {
                sent: 0,
                failed: 0
            },
            startTime: new Date()
        };
    }

    /**
     * Notifie une erreur
     * @param {string} message - Message d'erreur
     * @param {Error} error - Objet erreur
     * @returns {Promise<void>}
     */
    async notifyError(message, error) {
        this.log('🚨 ALERTE ERREUR:', message);
        
        const alertData = {
            level: this.config.alertLevels.ERROR,
            message,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            timestamp: new Date()
        };

        await this.processAlert(alertData);
        this.updateMetrics('error');
    }

    /**
     * Notifie une alerte critique
     * @param {string} message - Message d'alerte
     * @param {Object} data - Données additionnelles
     * @returns {Promise<void>}
     */
    async notifyCritical(message, data) {
        this.log('⚠️ ALERTE CRITIQUE:', message);
        
        const alertData = {
            level: this.config.alertLevels.CRITICAL,
            message,
            data,
            timestamp: new Date()
        };

        await this.processAlert(alertData);
        this.updateMetrics('critical');
    }

    /**
     * Notifie un événement
     * @param {string} type - Type d'événement
     * @param {Object} data - Données de l'événement
     * @returns {Promise<void>}
     */
    async notifyEvent(type, data) {
        this.log('📢 ÉVÉNEMENT:', type);
        
        const alertData = {
            level: this.config.alertLevels.INFO,
            type,
            data,
            timestamp: new Date()
        };

        await this.processAlert(alertData);
        this.updateMetrics('info');
    }

    /**
     * Traite une alerte selon les canaux configurés
     * @private
     * @param {Object} alertData - Données de l'alerte
     * @returns {Promise<void>}
     */
    async processAlert(alertData) {
        try {
            for (const channel of this.config.notificationChannels) {
                switch (channel) {
                    case 'console':
                        this.sendToConsole(alertData);
                        break;
                    case 'log':
                        await this.sendToLog(alertData);
                        break;
                    // Autres canaux possibles : email, slack, webhook, etc.
                }
            }
            this.metrics.notifications.sent++;
        } catch (error) {
            this.metrics.notifications.failed++;
            this.logError('❌ Erreur traitement alerte:', error);
        }
    }

    /**
     * Envoie une alerte à la console
     * @private
     * @param {Object} alertData - Données de l'alerte
     */
    sendToConsole(alertData) {
        const { level, message, data } = alertData;
        const timestamp = new Date().toISOString();
        
        switch (level) {
            case this.config.alertLevels.ERROR:
            case this.config.alertLevels.CRITICAL:
                console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
                break;
            case this.config.alertLevels.WARNING:
                console.warn(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
                break;
            default:
                console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
        }
    }

    /**
     * Envoie une alerte au système de logs
     * @private
     * @param {Object} alertData - Données de l'alerte
     * @returns {Promise<void>}
     */
    async sendToLog(alertData) {
        if (this.config.loggerService) {
            const { level, message, data } = alertData;
            await this.config.loggerService[level](message, data);
        }
    }

    /**
     * Met à jour les métriques
     * @private
     * @param {string} level - Niveau d'alerte
     */
    updateMetrics(level) {
        this.metrics.alerts.total++;
        this.metrics.alerts.byLevel[level]++;
    }

    /**
     * Récupère les métriques d'alertes
     * @returns {Object} Métriques
     */
    getMetrics() {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.startTime.getTime()
        };
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

module.exports = AlertService;