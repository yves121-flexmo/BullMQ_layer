require('dotenv').config();
const JobLogger = require('./utils/JobLogger');

async function testJobLogger() {
    // Création du logger avec connexion MongoDB
    const jobLogger = new JobLogger({
        isProduction: true, // Pour forcer la sauvegarde en base
        mongo: {
            uri: process.env.MONGO_URI || 'mongodb://localhost:27017/bullmq-reminders'
        },
        logLevel: 'debug' // Pour voir tous les logs
    });

    console.log('🚀 Test du JobLogger...');

    // Simulation d'un job réussi
    const successJob = {
        id: 'test-job-1',
        queueName: 'test-queue',
        name: 'process-data',
        data: {
            type: 'test',
            payload: { message: 'Test data' }
        },
        opts: { priority: 1 }
    };

    // Simulation d'un job échoué
    const failedJob = {
        id: 'test-job-2',
        queueName: 'test-queue',
        name: 'process-data',
        data: {
            type: 'test',
            payload: { message: 'Test data that will fail' }
        },
        opts: { priority: 2, attempts: 3 }
    };

    try {
        // Test du job réussi
        console.log('\n📝 Test d\'un job réussi...');
        const startLog = await jobLogger.logJobStarted(successJob);
        console.log('✅ Log de démarrage créé:', startLog.jobId);

        // Simulation du traitement
        await new Promise(resolve => setTimeout(resolve, 1000));

        const completeLog = await jobLogger.logJobCompleted(successJob, { status: 'success', processedItems: 10 });
        console.log('✅ Log de complétion créé:', completeLog.jobId);

        // Test du job échoué
        console.log('\n📝 Test d\'un job échoué...');
        const startLog2 = await jobLogger.logJobStarted(failedJob);
        console.log('✅ Log de démarrage créé:', startLog2.jobId);

        // Simulation du traitement
        await new Promise(resolve => setTimeout(resolve, 500));

        const failLog = await jobLogger.logJobFailed(failedJob, new Error('Test error'));
        console.log('✅ Log d\'échec créé:', failLog.jobId);

        // Récupération des statistiques
        console.log('\n📊 Récupération des statistiques...');
        const stats = await jobLogger.getMongoDBStats(1); // Stats sur 1 jour
        console.log('Statistiques MongoDB:', JSON.stringify(stats, null, 2));

        // Récupération des stats de queue
        console.log('\n📊 Récupération des stats de queue...');
        const queueStats = await jobLogger.getQueueStatsFromMongoDB('test-queue', 1);
        console.log('Stats de queue:', JSON.stringify(queueStats, null, 2));

        console.log('\n✅ Test terminé avec succès !');

    } catch (error) {
        console.error('❌ Erreur pendant le test:', error);
    }
}

// Exécution du test
testJobLogger();