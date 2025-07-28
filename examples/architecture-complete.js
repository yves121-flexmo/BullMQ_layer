/**
 * Exemple complet de l'architecture organisée BullMQ
 * 
 * Démontre la séparation claire des responsabilités :
 * - Core BullMQ : Composants réutilisables
 * - Managers : Logique métier spécialisée
 * - Services : Applications business
 * - Utils : Utilitaires transversaux (logs, etc.)
 */

const { 
  BullMQManager,      // Core BullMQ pur
  MailManager,        // Manager métier email
  RemboursementMailService, // Service applicatif
  JobLogger           // Utils transversaux
} = require('../index');

/**
 * 1. CORE BULLMQ - Interface universelle
 * Utilisable pour tout type de jobs (data processing, exports, etc.)
 */
async function exempleCoreBullMQ() {
  console.log('🏗️ === CORE BULLMQ (Réutilisable universellement) ===\n');

  const bullMQ = new BullMQManager({
    redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    isProduction: false
  });

  const jobLogger = new JobLogger({
    mongo: { uri: process.env.MONGO_URI },
    isProduction: false
  });

  await bullMQ.initialize();

  // Jobs génériques de traitement de données
  bullMQ.createQueue('data-processing');
  
  const genericHandlers = {
    'process-images': async (data, job) => {
      console.log(`🖼️ Traitement de ${data.imageCount} images`);
      await new Promise(resolve => setTimeout(resolve, 800));
      return { success: true, processedImages: data.imageCount };
    },
    'export-database': async (data, job) => {
      console.log(`📤 Export base de données ${data.database}`);
      await new Promise(resolve => setTimeout(resolve, 1200));
      return { success: true, exportPath: `/exports/${data.database}.sql` };
    },
    'cleanup-files': async (data, job) => {
      console.log(`🧹 Nettoyage ${data.path}`);
      await new Promise(resolve => setTimeout(resolve, 600));
      return { success: true, filesRemoved: 15 };
    }
  };

  bullMQ.startWorker('data-processing', genericHandlers);
  jobLogger.attachToBullMQManager(bullMQ);

  // Ajout de jobs variés
  await bullMQ.addJob('data-processing', 'process-images', { imageCount: 50 });
  await bullMQ.addJob('data-processing', 'export-database', { database: 'users' });
  await bullMQ.addJob('data-processing', 'cleanup-files', { path: '/tmp' });

  await new Promise(resolve => setTimeout(resolve, 2000));

  const stats = jobLogger.getDetailedStats();
  console.log(`📊 Core stats: ${stats.global.totalJobs} jobs, ${stats.global.successRate} succès\n`);

  await bullMQ.shutdown();
}

/**
 * 2. MANAGER MÉTIER - Spécialisé par domaine
 * Hérite du core mais ajoute la logique spécifique
 */
async function exempleManagerMetier() {
  console.log('🏢 === MANAGER MÉTIER (Spécialisé emails) ===\n');

  const mailManager = new MailManager({
    redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    isProduction: false,
    emailService: {
      sendEmail: async (emailData) => {
        console.log(`📧 Envoi email à: ${emailData.to.join(', ')}`);
        return { messageId: `MSG-${Date.now()}`, success: true };
      }
    },
    emailConfig: {
      templates: MailManager.createSampleTemplates()
    }
  });

  await mailManager.initialize();

  // Utilisation de l'interface métier spécialisée
  await mailManager.sendWelcomeEmail('alice@example.com', { name: 'Alice' });
  await mailManager.sendPasswordResetEmail('bob@example.com', 'reset-token-123');
  
  // Newsletter en lot
  const subscribers = [
    { email: 'user1@example.com', name: 'User 1' },
    { email: 'user2@example.com', name: 'User 2' }
  ];
  
  await mailManager.sendNewsletter(subscribers, {
    subject: 'Newsletter Décembre 2024',
    campaignId: 'DEC-2024'
  });

  // Workflow email complexe avec validation
  await mailManager.createEmailFlow({
    id: 'campaign-001',
    to: 'vip@example.com',
    subject: 'Email VIP avec validation',
    template: 'welcome'
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  const emailStats = await mailManager.getEmailStats();
  console.log(`📧 Manager stats: Queue ${emailStats.emailQueue}, ${emailStats.templatesCount} templates\n`);

  await mailManager.shutdown();
}

/**
 * 3. SERVICE APPLICATIF - Logique business complexe
 * Utilise les managers pour implémenter la logique métier
 */
async function exempleServiceApplicatif() {
  console.log('🚀 === SERVICE APPLICATIF (Remboursements) ===\n');

  // Services mock pour la démo
  const mockServices = {
    reimbursementService: {
      getReimbursements: async ({ type, statuses }) => {
        console.log(`🔍 Récupération remboursements ${type}: ${statuses.join(', ')}`);
        return [
          { 
            id: 'REIMB-001', 
            type, 
            globalStatus: 'PENDING', 
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            amount: 150000
          },
          { 
            id: 'REIMB-002', 
            type, 
            globalStatus: 'OVERDUE', 
            dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            amount: 200000
          }
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
        console.log(`📧 Rappel ${data.type} envoyé à ${data.recipients.length} personnes`);
        return { messageId: `MSG-${Date.now()}`, success: true };
      }
    }
  };

  const reminderService = new RemboursementMailService({
    redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    mongo: { uri: process.env.MONGO_URI },
    isProduction: false,
    ...mockServices
  });

  await reminderService.initialize();

  // Test de la logique business complexe
  await reminderService.forceReminderExecution('coverage');

  await new Promise(resolve => setTimeout(resolve, 3000));

  const serviceStats = await reminderService.getReminderStats();
  console.log(`🏢 Service stats: ${serviceStats.summary.totalCompleted} jobs terminés`);
  console.log(`📊 Métriques globales: ${serviceStats.globalMetrics.global.totalJobs} jobs total\n`);

  await reminderService.shutdown();
}

/**
 * 4. UTILS TRANSVERSAUX - Logs globaux indépendants
 * Fonctionne avec n'importe quel type de jobs/queues
 */
async function exempleUtilsTransversaux() {
  console.log('🛠️ === UTILS TRANSVERSAUX (Logs globaux) ===\n');

  const bullMQ = new BullMQManager({
    redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    isProduction: false
  });

  const jobLogger = new JobLogger({
    mongo: { uri: process.env.MONGO_URI },
    isProduction: false,
    logLevel: 'info',
    enableMetrics: true
  });

  await bullMQ.initialize();

  // Création de plusieurs queues de types différents
  bullMQ.createQueue('analytics');
  bullMQ.createQueue('reports');
  bullMQ.createQueue('notifications');

  // Handlers variés pour tester les métriques
  const analyticsHandlers = {
    'calculate-metrics': async (data, job) => {
      console.log(`📊 Calcul métriques pour ${data.period}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      return { metrics: { users: 1500, revenue: 25000 } };
    }
  };

  const reportHandlers = {
    'generate-pdf': async (data, job) => {
      console.log(`📄 Génération PDF ${data.reportType}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { pdfUrl: `/reports/${data.reportType}.pdf` };
    }
  };

  const notificationHandlers = {
    'send-push': async (data, job) => {
      console.log(`🔔 Push notification à ${data.userCount} utilisateurs`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return { sent: true, deliveredCount: data.userCount };
    }
  };

  bullMQ.startWorker('analytics', analyticsHandlers);
  bullMQ.startWorker('reports', reportHandlers);
  bullMQ.startWorker('notifications', notificationHandlers);

  // Attachment du logger global
  jobLogger.attachToBullMQManager(bullMQ);

  // Ajout de jobs de types variés
  await bullMQ.addJob('analytics', 'calculate-metrics', { period: 'monthly' });
  await bullMQ.addJob('reports', 'generate-pdf', { reportType: 'sales' });
  await bullMQ.addJob('notifications', 'send-push', { userCount: 500 });

  await new Promise(resolve => setTimeout(resolve, 4000));

  // Métriques globales tous types confondus
  const globalStats = jobLogger.getDetailedStats();
  console.log('📊 MÉTRIQUES GLOBALES TRANSVERSALES:');
  console.log(`   → Total jobs: ${globalStats.global.totalJobs}`);
  console.log(`   → Taux de succès: ${globalStats.global.successRate}`);
  console.log(`   → Temps moyen: ${globalStats.global.averageExecutionTime}`);
  
  console.log('\n📋 Par type de job:');
  Object.entries(globalStats.jobTypes).forEach(([jobType, metrics]) => {
    console.log(`   → ${jobType}: ${metrics.completed}/${metrics.total} (${Math.round(metrics.averageTime)}ms)`);
  });

  console.log('\n📈 Jobs les plus rapides:');
  globalStats.performance.fastestJobs.forEach(job => {
    console.log(`   → ${job.jobType}: ${job.averageTime}ms (${job.completedJobs} exécutions)`);
  });

  await bullMQ.shutdown();
}

/**
 * Démonstration complète de l'architecture
 */
async function demonstrationComplete() {
  console.log('🎯 === DÉMONSTRATION ARCHITECTURE COMPLÈTE ===\n');
  console.log('📁 Structure organisée par responsabilité:');
  console.log('   ├── core/        → BullMQ pur réutilisable');
  console.log('   ├── managers/    → Métier spécialisé (emails, exports, etc.)');
  console.log('   ├── services/    → Logique applicative business');
  console.log('   └── utils/       → Transversaux (logs, métriques, etc.)');
  console.log('');

  try {
    await exempleCoreBullMQ();
    await exempleManagerMetier();
    await exempleServiceApplicatif();
    await exempleUtilsTransversaux();

    console.log('\n🎉 === DÉMONSTRATION TERMINÉE ===');
    console.log('✅ Architecture claire et séparée');
    console.log('✅ Logs globaux indépendants du métier');
    console.log('✅ Composants core réutilisables');
    console.log('✅ Managers métier spécialisés');
    console.log('✅ Services applicatifs avec injection');
    console.log('✅ Persistance MongoDB avec Mongoose');
    console.log('✅ Gestion intelligente des environnements');

  } catch (error) {
    console.error('❌ Erreur:', error);
  }
}

// Exécution selon l'argument
if (require.main === module) {
  const arg = process.argv[2];
  
  switch(arg) {
    case 'core':
      exempleCoreBullMQ().catch(console.error);
      break;
    case 'manager':
      exempleManagerMetier().catch(console.error);
      break;
    case 'service':
      exempleServiceApplicatif().catch(console.error);
      break;
    case 'utils':
      exempleUtilsTransversaux().catch(console.error);
      break;
    default:
      demonstrationComplete().catch(console.error);
  }
}

module.exports = {
  exempleCoreBullMQ,
  exempleManagerMetier,
  exempleServiceApplicatif,
  exempleUtilsTransversaux,
  demonstrationComplete
}; 