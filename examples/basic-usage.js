const MailManager = require('../core/MailManager');
const WorkerManager = require('../core/WorkerManager');
const FlowManager = require('../core/FlowManager');

/**
 * Exemple d'utilisation basique du système de mail asynchrone
 */
async function basicExample() {
  // Configuration
  const config = {
    redis: {
      host: 'localhost',
      port: 6379
    },
    defaultOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50
    }
  };

  // Initialisation du MailManager
  const mailManager = new MailManager(config);
  await mailManager.initialize();

  console.log('🚀 MailManager initialisé - Exemple basique');

  try {
    // 1. Création d'une queue pour les emails
    mailManager.createQueue('emails', {
      defaultJobOptions: {
        removeOnComplete: 50
      }
    });

    // 2. Démarrage d'un worker avec des handlers
    const emailHandlers = WorkerManager.createEmailHandlers();
    mailManager.startWorker('emails', emailHandlers, {
      concurrency: 3
    });

    // 3. Ajout de jobs simples
    await mailManager.addJob('emails', 'send-welcome', {
      to: 'alice@example.com',
      subject: 'Bienvenue !',
      template: 'welcome'
    });

    await mailManager.addJob('emails', 'send-newsletter', {
      to: 'bob@example.com',
      subject: 'Newsletter hebdomadaire',
      template: 'newsletter'
    });

    // 4. Planification d'un job récurrent (newsletter quotidienne)
    await mailManager.scheduleJob(
      'emails',
      'send-newsletter',
      {
        to: 'subscribers@example.com',
        subject: 'Newsletter quotidienne',
        template: 'daily-newsletter'
      },
      '0 9 * * *' // Tous les jours à 9h
    );

    // 5. Ajout d'un listener d'événements personnalisé
    mailManager.onEvent('emails', 'completed', (data) => {
      console.log(`📧 Email envoyé avec succès: ${data.jobId}`);
    });

    // 6. Vérification de la santé du système
    const health = await mailManager.healthCheck();
    console.log('🏥 État de santé:', health);

    // Attendre un peu pour voir les jobs se traiter
    console.log('⏳ Attente du traitement des jobs...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 7. Récupération des statistiques
    const stats = await mailManager.getQueueStats('emails');
    console.log('📊 Statistiques de la queue emails:', stats);

  } catch (error) {
    console.error('❌ Erreur dans l\'exemple basique:', error);
  } finally {
    // Nettoyage
    await mailManager.shutdown();
  }
}

/**
 * Exemple d'utilisation avancée avec workflows
 */
async function advancedExample() {
  const config = {
    redis: { host: 'localhost', port: 6379 }
  };

  const mailManager = new MailManager(config);
  await mailManager.initialize();

  console.log('🚀 MailManager initialisé - Exemple avancé');

  try {
    // 1. Création de plusieurs queues
    mailManager.createQueue('email-processing');
    mailManager.createQueue('newsletter-processing');
    mailManager.createQueue('notifications');

    // 2. Configuration des workers avec handlers personnalisés
    const emailHandlers = {
      ...WorkerManager.createEmailHandlers(),
      ...FlowManager.createFlowHandlers()
    };

    mailManager.startWorker('email-processing', emailHandlers, { concurrency: 5 });
    mailManager.startWorker('newsletter-processing', emailHandlers, { concurrency: 3 });

    // 3. Configuration du monitoring
    mailManager.eventManager.setupMonitoringListeners();
    mailManager.eventManager.setupAuditListeners();

    // 4. Création d'un workflow d'email avec validation
    const emailFlow = await mailManager.addFlow({
      name: 'email-workflow',
      queueName: 'email-processing',
      data: { type: 'workflow-email' },
      children: [
        {
          name: 'validate-email',
          queueName: 'email-processing',
          data: { to: 'test@example.com', step: 'validation' }
        },
        {
          name: 'prepare-template',
          queueName: 'email-processing',
          data: { template: 'welcome', step: 'preparation' },
          children: [
            {
              name: 'send-welcome',
              queueName: 'email-processing',
              data: { to: 'test@example.com', step: 'sending' }
            }
          ]
        }
      ]
    });

    console.log('🌊 Workflow créé:', emailFlow.flowId);

    // 5. Création d'un flow de newsletter avec multiple destinataires
    const newsletterFlow = await mailManager.flowManager.createNewsletterFlow({
      campaignId: 'campaign-001',
      template: 'monthly-newsletter',
      recipients: [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' },
        { email: 'user3@example.com', name: 'User 3' }
      ]
    });

    console.log('📰 Newsletter flow créé:', newsletterFlow.flowId);

    // 6. Planification de jobs avec différents patterns
    await mailManager.scheduleJob(
      'notifications',
      'send-notification',
      { type: 'daily-report' },
      '0 18 * * *' // Tous les jours à 18h
    );

    await mailManager.scheduleJob(
      'email-processing',
      'send-welcome',
      { to: 'weekly@example.com' },
      '0 9 * * 1' // Tous les lundis à 9h
    );

    // 7. Attente et monitoring
    console.log('⏳ Traitement des workflows...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 8. Récupération des métriques complètes
    const allStats = await mailManager.queueManager.getAllQueueMetrics();
    console.log('📊 Métriques complètes:', allStats);

    const flowMetrics = mailManager.flowManager.getFlowMetrics();
    console.log('🌊 Métriques des flows:', flowMetrics);

    const eventStats = mailManager.eventManager.getEventStats();
    console.log('📡 Statistiques des événements:', eventStats);

    // 9. Récupération de l'audit log
    if (mailManager.eventManager.getAuditLog) {
      const auditLog = mailManager.eventManager.getAuditLog(10);
      console.log('📋 Audit log (10 dernières entrées):', auditLog);
    }

  } catch (error) {
    console.error('❌ Erreur dans l\'exemple avancé:', error);
  } finally {
    // Nettoyage
    await mailManager.shutdown();
  }
}

/**
 * Exemple de gestion d'erreurs et retry
 */
async function errorHandlingExample() {
  const config = {
    redis: { host: 'localhost', port: 6379 },
    defaultOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 }
    }
  };

  const mailManager = new MailManager(config);
  await mailManager.initialize();

  console.log('🚀 MailManager initialisé - Exemple gestion d\'erreurs');

  try {
    mailManager.createQueue('error-testing');

    // Handlers avec échecs simulés
    const errorHandlers = {
      'failing-job': async (data, job) => {
        console.log(`🔄 Tentative ${job.attemptsMade + 1}/${job.opts.attempts} pour le job ${job.id}`);
        
        if (Math.random() < 0.7) { // 70% de chance d'échec
          throw new Error('Échec simulé du job');
        }
        
        return { success: true, attempt: job.attemptsMade + 1 };
      },

      'always-fail': async (data, job) => {
        throw new Error('Ce job échoue toujours');
      }
    };

    mailManager.startWorker('error-testing', errorHandlers);

    // Ajout de listeners pour monitoring des échecs
    mailManager.onEvent('error-testing', 'failed', (data) => {
      console.error(`💥 Job ${data.jobId} échoué après ${data.attemptsMade} tentatives`);
    });

    mailManager.onEvent('error-testing', 'completed', (data) => {
      console.log(`✅ Job ${data.jobId} finalement réussi !`);
    });

    // Ajout de jobs qui peuvent échouer
    for (let i = 0; i < 5; i++) {
      await mailManager.addJob('error-testing', 'failing-job', { id: i });
    }

    // Job qui échouera toujours
    await mailManager.addJob('error-testing', 'always-fail', { id: 'doom' });

    // Attente du traitement
    console.log('⏳ Traitement des jobs avec gestion d\'erreurs...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const stats = await mailManager.getQueueStats('error-testing');
    console.log('📊 Statistiques finales:', stats);

  } catch (error) {
    console.error('❌ Erreur dans l\'exemple de gestion d\'erreurs:', error);
  } finally {
    await mailManager.shutdown();
  }
}

// Exécution des exemples
async function runAllExamples() {
  console.log('🎯 Démarrage des exemples MailManager\n');
  
  try {
    await basicExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await advancedExample();
    console.log('\n' + '='.repeat(50) + '\n');
    
    await errorHandlingExample();
  } catch (error) {
    console.error('❌ Erreur globale:', error);
  }
  
  console.log('\n🎉 Tous les exemples terminés !');
}

// Exécution si le script est lancé directement
if (require.main === module) {
  runAllExamples().catch(console.error);
}

module.exports = {
  basicExample,
  advancedExample,
  errorHandlingExample,
  runAllExamples
}; 