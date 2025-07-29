/**
 * Adaptateur de logger pour uniformiser l'interface entre JobLogger et les services
 * Convertit les appels info/error/warn/debug vers l'interface log(level, message, data) du JobLogger
 */
class LoggerAdapter {
    constructor(jobLogger) {
        this.jobLogger = jobLogger;
    }

    /**
     * Log de niveau info
     * @param {string} message - Message à logger
     * @param {*} data - Données additionnelles
     */
    info(message, data) {
        this.jobLogger.log('info', message, data);
    }

    /**
     * Log de niveau error
     * @param {string} message - Message d'erreur
     * @param {Error|Object} error - Erreur ou données d'erreur
     */
    error(message, error) {
        this.jobLogger.log('error', message, error);
    }

    /**
     * Log de niveau warning
     * @param {string} message - Message d'avertissement
     * @param {*} data - Données additionnelles
     */
    warn(message, data) {
        this.jobLogger.log('warn', message, data);
    }

    /**
     * Log de niveau debug
     * @param {string} message - Message de debug
     * @param {*} data - Données additionnelles
     */
    debug(message, data) {
        this.jobLogger.log('debug', message, data);
    }
}

/**
 * Factory pour créer un adaptateur de logger
 * @param {JobLogger} jobLogger - Instance du JobLogger
 * @returns {LoggerAdapter} Adaptateur de logger
 */
function createLoggerAdapter(jobLogger) {
    return new LoggerAdapter(jobLogger);
}

module.exports = { LoggerAdapter, createLoggerAdapter };