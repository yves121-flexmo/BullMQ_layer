require('dotenv').config();
const ReminderService = require('./lite/index');
const ReimbursementService = require('./services/ReimbursementService');
const ManagerService = require('./services/ManagerService');
const EmailService = require('./services/EmailService');
const AlertService = require('./services/AlertService');
const JobLogger = require('./utils/JobLogger');
const { createLoggerAdapter } = require('./utils/LoggerAdapter');

// Initialisation du JobLogger global
const jobLogger = new JobLogger({
    isProduction: process.env.NODE_ENV === 'prod',
    mongo: {
        uri: process.env.MONGO_URI
    },
    logLevel: process.env.NODE_ENV === 'prod' ? 'info' : 'debug'
});

// Création de l'adaptateur de logger pour tous les services
const loggerAdapter = createLoggerAdapter(jobLogger);

// Création des instances des services avec le logger intégré
const reimbursementService = new ReimbursementService({
    isProduction: process.env.NODE_ENV === 'prod',
    loggerService: loggerAdapter
});

const managerService = new ManagerService({
    isProduction: process.env.NODE_ENV === 'prod',
    loggerService: loggerAdapter
});

const emailService = new EmailService({
    email: process.env.GMAIL_USER || 'contact@flexmo.app',
    password: process.env.GMAIL_APP_PASSWORD,
    isProduction: process.env.NODE_ENV === 'prod',
    loggerService: loggerAdapter
});

const alertService = new AlertService({
    isProduction: process.env.NODE_ENV === 'prod',
    notificationChannels: ['console', 'log'],
    loggerService: loggerAdapter
});

// Initialisation du ReminderService avec tous les services et le logger
const reminderService = new ReminderService({
    redis: {
        host: 'localhost',
        port: 6379
    },
    mongo: {
        uri: process.env.MONGO_URI
    },
    isProduction: process.env.NODE_ENV === 'prod',
    reimbursementService,
    managerService,
    emailService,
    alertService,
    loggerService: loggerAdapter
});

// Démarrage du service
async function start() {
    try {
        // Log de démarrage
        jobLogger.log('info', '🚀 Démarrage de l\'application de rappels de remboursement');

        // Vérification de la connexion email
        const emailConnected = await emailService.verifyConnection();
        if (!emailConnected) {
            throw new Error('Impossible de se connecter au serveur SMTP');
        }

        // Initialisation du service de rappels
        await reminderService.initialize();

        jobLogger.log('info', '✅ Application démarrée avec succès');

        // Gestion de l'arrêt gracieux
        process.on('SIGTERM', async () => {
            jobLogger.log('info', '🛑 Signal d\'arrêt reçu, arrêt gracieux...');
            await reminderService.shutdown();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            jobLogger.log('info', '🛑 Signal d\'interruption reçu, arrêt gracieux...');
            await reminderService.shutdown();
            process.exit(0);
        });

    } catch (error) {
        jobLogger.log('error', '❌ Erreur de démarrage de l\'application', error);
        process.exit(1);
    }
}

// Lancement
start();