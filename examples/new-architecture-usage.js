const { 
  BullMQManager, 
  MailManager, 
  RemboursementMailService, 
  JobLogger 
} = require('../index');

/**
 * Exemple démontrant la nouvelle architecture organisée
 */

async function exempleArchitectureCore() {
  console.log('🎯 === EXEMPLE ARCHITECTURE CORE ===\n');

  // 1. BullMQManager - Core BullMQ pur (utilisable pour tout type de jobs)
  const bullMQ = new BullMQManager({
    redis: { url: 'redis://localhost:6379' },
    isProduction: false
  });

  await bullMQ.initialize();

  // 2. JobLogger - Métriques globales tous types de jobs
  const jobLogger = new JobLogger({
    isProduction: false,
    logLevel: 'info',
    enableMetrics: true
  });

  // 3. Créer une queue générique et workers
  bullMQ.createQueue('data-processing');
  
  // Attachment aux événements BullMQ (après création des queues)
  jobLogger.attachToBullMQManager(bullMQ);
  jobLogger.attachToNewQueue('data-processing');
  
  const genericHandlers = {
    'process-csv': async (data, job) => {
      console.log(`📊 Traitement CSV: ${data.filename}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await job.updateProgress(100);
      return { success: true, rowsProcessed: 1500 };
    },
    'generate-report': async (data, job) => {
      console.log(`📋 Génération rapport: ${data.type}`);
      await new Promise(resolve => setTimeout(resolve, 800));
      await job.updateProgress(100);
      return { success: true, reportId: 'RPT-001' };
    }
  };

  bullMQ.startWorker('data-processing', genericHandlers);

  // 4. Ajouter quelques jobs pour tester
  await bullMQ.addJob('data-processing', 'process-csv', { filename: 'users.csv' });
  await bullMQ.addJob('data-processing', 'generate-report', { type: 'monthly' });

  // Attendre un peu que les jobs se terminent
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 5. Afficher les métriques globales
  console.log('\n📊 Métriques globales du JobLogger:');
  const stats = jobLogger.getDetailedStats();
  console.log(`- Total jobs: ${stats.global.totalJobs}`);
  console.log(`- Taux de succès: ${stats.global.successRate}`);
  console.log(`- Temps moyen: ${stats.global.averageExecutionTime}`);
  
  console.log('\n📋 Jobs les plus rapides:');
  stats.performance.fastestJobs.forEach(job => {
    console.log(`  - ${job.jobType}: ${job.averageTime}ms (${job.completedJobs} jobs)`);
  });

  await bullMQ.shutdown();
  console.log('\n✅ Core BullMQ exemple terminé\n');
}

async function exempleMailManager() {
  console.log('📧 === EXEMPLE MAIL MANAGER MÉTIER ===\n');

  // MailManager - Spécialisé pour les emails
  const mailManager = new MailManager({
    redis: { url: 'redis://localhost:6379' },
    isProduction: false,
    emailService: {
      sendEmail: async (emailData) => {
        console.log(`  → Envoi réel email à: ${emailData.to.join(', ')}`);
        await new Promise(resolve => setTimeout(resolve, 300));
        return { messageId: `MSG-${Date.now()}`, success: true };
      }
    },
    emailConfig: {
      templates: MailManager.createSampleTemplates()
    }
  });

  await mailManager.initialize();

  // JobLogger dédié aux emails
  const emailLogger = new JobLogger({
    isProduction: false,
    logLevel: 'info'
  });
  
  emailLogger.attachToBullMQManager(mailManager);

  // Envoi d'emails via l'interface métier
  await mailManager.sendWelcomeEmail('user@example.com', { name: 'Alice' });
  await mailManager.sendPasswordResetEmail('user@example.com', 'token123');
  
  // Email personnalisé
  await mailManager.sendEmail(
    ['admin@example.com'], 
    'Test Email', 
    'Contenu du test'
  );

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Statistiques spécifiques aux emails
  console.log('\n📊 Statistiques du MailManager:');
  const emailStats = await mailManager.getEmailStats();
  console.log(`- Queue emails: ${emailStats.emailQueue}`);
  console.log(`- Templates disponibles: ${emailStats.templatesCount}`);
  console.log(`- Service email configuré: ${emailStats.hasEmailService}`);

  const emailMetrics = emailLogger.getDetailedStats();
  console.log(`- Emails traités: ${emailMetrics.global.totalJobs}`);
  console.log(`- Succès: ${emailMetrics.global.successRate}`);

  await mailManager.shutdown();
  console.log('\n✅ MailManager exemple terminé\n');
}

async function exempleRemboursementService() {
  console.log('🏢 === EXEMPLE SERVICE REMBOURSEMENTS ===\n');

  // Services mock
  const mockServices = {
    reimbursementService: {
      getReimbursements: async ({ type, statuses }) => {
        console.log(`  → Récupération remboursements ${type}: ${statuses.join(', ')}`);
        return [
          { id: 'REIMB-001', type, globalStatus: 'PENDING', dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
          { id: 'REIMB-002', type, globalStatus: 'OVERDUE', dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }
        ];
      }
    },
    managerService: {
      getReimbursementOwner: async (id) => ({ email: 'owner@company.com', name: 'Owner' }),
      getOldestManagers: async (type, limit) => [
        { email: 'manager1@company.com', name: 'Manager 1' },
        { email: 'manager2@company.com', name: 'Manager 2' }
      ]
    },
    emailService: {
      sendReminderEmail: async (data) => {
        console.log(`  → Email rappel ${data.type} envoyé à ${data.recipients.length} personnes`);
        return { messageId: `MSG-${Date.now()}`, success: true };
      }
    }
  };

  // Service de remboursements
  const reminderService = new RemboursementMailService({
    redis: { url: 'redis://localhost:6379' },
    isProduction: false,
    logLevel: 'info',
    ...mockServices
  });

  await reminderService.initialize();

  // Test d'exécution manuelle
  console.log('🔧 Test exécution manuelle des rappels...\n');
  await reminderService.forceReminderExecution('coverage');

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Statistiques complètes avec métriques globales
  console.log('📊 Statistiques complètes du service:');
  const fullStats = await reminderService.getReminderStats();
  
  console.log('\n📋 Métriques globales:');
  console.log(`- Total jobs: ${fullStats.globalMetrics.global.totalJobs}`);
  console.log(`- Succès: ${fullStats.globalMetrics.global.successRate}`);
  console.log(`- Jobs par type:`);
  Object.entries(fullStats.globalMetrics.jobTypes).forEach(([type, metrics]) => {
    console.log(`  - ${type}: ${metrics.completed}/${metrics.total} (${Math.round(metrics.averageTime)}ms)`);
  });

  console.log('\n📋 Erreurs fréquentes:');
  fullStats.globalMetrics.topErrors.forEach(error => {
    console.log(`  - ${error.error}: ${error.count} fois`);
  });

  await reminderService.shutdown();
  console.log('\n✅ RemboursementService exemple terminé\n');
}

// Démonstration de l'architecture complète
async function demonstrationComplete() {
  console.log('🚀 DÉMONSTRATION ARCHITECTURE RÉORGANISÉE\n');
  console.log('📁 Structure:');
  console.log('├── core/        → BullMQ pur (Queue, Worker, Event, Flow)');
  console.log('├── managers/    → Métier spécialisé (MailManager)');
  console.log('├── services/    → Logique applicative (RemboursementService)');
  console.log('└── utils/       → Transversaux (JobLogger)');
  console.log('');

  try {
    await exempleArchitectureCore();
    await exempleMailManager();
    await exempleRemboursementService();

    console.log('🎉 === DÉMONSTRATION TERMINÉE ===');
    console.log('✅ Architecture claire et séparée');
    console.log('✅ Logs globaux indépendants du métier');
    console.log('✅ Métriques détaillées de performance');
    console.log('✅ Composants réutilisables');

  } catch (error) {
    console.error('❌ Erreur:', error);
  }
}

// Exécution selon l'argument
if (require.main === module) {
  const arg = process.argv[2];
  
  switch(arg) {
    case 'core':
      exempleArchitectureCore().catch(console.error);
      break;
    case 'mail':
      exempleMailManager().catch(console.error);
      break;
    case 'remboursement':
      exempleRemboursementService().catch(console.error);
      break;
    default:
      demonstrationComplete().catch(console.error);
  }
}

module.exports = {
  exempleArchitectureCore,
  exempleMailManager,
  exempleRemboursementService,
  demonstrationComplete
}; 