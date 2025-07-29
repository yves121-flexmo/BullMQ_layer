require('dotenv').config();
const JobLogger = require('./utils/JobLogger');
const { createLoggerAdapter } = require('./utils/LoggerAdapter');
const ReimbursementService = require('./services/ReimbursementService');
const ManagerService = require('./services/ManagerService');
const EmailService = require('./services/EmailService');
const AlertService = require('./services/AlertService');

async function testServicesWithLogger() {
    console.log('🚀 Test d\'intégration des services avec JobLogger...\n');

    // Initialisation du JobLogger
    const jobLogger = new JobLogger({
        isProduction: true, // Pour forcer la sauvegarde en MongoDB
        mongo: {
            uri: process.env.MONGO_URI || 'mongodb://localhost:27017/bullmq-reminders'
        },
        logLevel: 'debug'
    });

    // Création de l'adaptateur
    const loggerAdapter = createLoggerAdapter(jobLogger);

    // Test ReimbursementService
    console.log('📋 Test ReimbursementService...');
    const reimbursementService = new ReimbursementService({
        isProduction: true,
        loggerService: loggerAdapter
    });

    try {
        const reimbursements = await reimbursementService.getReimbursements({
            type: 'SALARY',
            statuses: ['PENDING', 'OVERDUE']
        });
        console.log(`✅ ${reimbursements.length} remboursements récupérés\n`);
    } catch (error) {
        console.error('❌ Erreur ReimbursementService:', error.message);
    }

    // Test ManagerService
    console.log('👥 Test ManagerService...');
    const managerService = new ManagerService({
        isProduction: true,
        loggerService: loggerAdapter
    });

    try {
        const managers = await managerService.getOldestManagers('corporate', 3);
        console.log(`✅ ${managers.length} managers récupérés\n`);
    } catch (error) {
        console.error('❌ Erreur ManagerService:', error.message);
    }

    // Test EmailService
    console.log('📧 Test EmailService...');
    const emailService = new EmailService({
        email: process.env.GMAIL_USER || 'contact@flexmo.app',
        password: process.env.GMAIL_APP_PASSWORD || 'fake-password',
        isProduction: true,
        loggerService: loggerAdapter
    });

    try {
        // Test de connexion (peut échouer si pas de vraies credentials)
        const connected = await emailService.verifyConnection();
        console.log(`📧 Connexion email: ${connected ? '✅ Connecté' : '❌ Non connecté'}\n`);
    } catch (error) {
        console.log('📧 Test de connexion email (erreur attendue si pas de credentials)\n');
    }

    // Test AlertService
    console.log('🚨 Test AlertService...');
    const alertService = new AlertService({
        isProduction: true,
        notificationChannels: ['console', 'log'],
        loggerService: loggerAdapter
    });

    try {
        await alertService.notifyEvent('TEST_EVENT', { message: 'Test d\'intégration du logger' });
        await alertService.notifyError('Test d\'erreur', new Error('Erreur de test'));
        console.log('✅ Alertes envoyées\n');
    } catch (error) {
        console.error('❌ Erreur AlertService:', error.message);
    }

    // Vérification des logs dans MongoDB
    console.log('📊 Vérification des logs dans MongoDB...');
    try {
        // Attendre un peu pour que les logs soient sauvegardés
        await new Promise(resolve => setTimeout(resolve, 2000));

        const stats = await jobLogger.getMongoDBStats(1);
        if (stats) {
            console.log('✅ Statistiques MongoDB récupérées:');
            console.log(`   - Total des logs: ${stats.totalLogsCount}`);
            console.log(`   - Performance: ${JSON.stringify(stats.performance, null, 2)}`);
            console.log(`   - Erreurs: ${JSON.stringify(stats.errors, null, 2)}`);
        } else {
            console.log('⚠️  Pas de connexion MongoDB ou pas de logs');
        }
    } catch (error) {
        console.error('❌ Erreur récupération stats MongoDB:', error.message);
    }

    console.log('\n✅ Test d\'intégration terminé !');
}

// Exécution du test
testServicesWithLogger().catch(console.error);