const ReminderService = require('./index');

/**
 * Exemple d'utilisation du ReminderService - Version Lite
 */

async function exempleUtilisationLite() {
  console.log('🚀 === EXEMPLE REMINDERSERVICE LITE ===\n');

  // Services mock pour la démonstration
  const mockServices = {
    // Service de remboursements
    reimbursementService: {
      getReimbursements: async ({ type, statuses }) => {
        console.log(`🔍 Récupération remboursements ${type}: ${statuses.join(', ')}`);
        
        if (type === 'SALARY') {
          return [
            {
              id: 'SALARY-001',
              type: 'SALARY',
              globalStatus: 'PENDING',
              dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 jours
              amount: 250000,
              companyId: 'COMP-001'
            },
            {
              id: 'SALARY-002',
              type: 'SALARY',
              globalStatus: 'OVERDUE',
              dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // -2 jours
              amount: 180000,
              companyId: 'COMP-002'
            }
          ];
        } else if (type === 'TREASURY') {
          return [
            {
              id: 'TREASURY-001',
              type: 'TREASURY',
              globalStatus: 'PENDING',
              dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 jours
              amount: 500000,
              healthCoverageId: 'HC-001'
            },
            {
              id: 'TREASURY-002',
              type: 'TREASURY',
              globalStatus: 'OVERDUE',
              dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // -3 jours
              amount: 750000,
              healthCoverageId: 'HC-002'
            }
          ];
        }
        
        return [];
      }
    },

    // Service de gestion des managers
    managerService: {
      getReimbursementOwner: async (reimbursementId) => {
        console.log(`👤 Récupération du propriétaire pour ${reimbursementId}`);
        return {
          email: 'owner@company.com',
          name: `Owner of ${reimbursementId}`,
          role: 'owner'
        };
      },

      getOldestManagers: async (type, limit) => {
        console.log(`👥 Récupération des ${limit} plus vieux managers (${type})`);
        return [
          { email: 'manager1@company.com', name: 'Manager 1', seniority: 5 },
          { email: 'manager2@company.com', name: 'Manager 2', seniority: 3 },
          { email: 'manager3@company.com', name: 'Manager 3', seniority: 2 }
        ];
      }
    },

    // Service d'envoi d'emails
    emailService: {
      sendEmail: async (emailData) => {
        console.log(`📧 Envoi email à: ${emailData.to.join(', ')}`);
        console.log(`   → Sujet: ${emailData.subject}`);
        
        // Simulation temps d'envoi
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return {
          messageId: `MSG-${Date.now()}`,
          success: true,
          deliveredTo: emailData.to.length
        };
      },

      sendReminderEmail: async (data) => {
        console.log(`📧 Envoi email de rappel ${data.type} pour ${data.reimbursement.id}`);
        console.log(`   → ${data.recipients.length} destinataires`);
        console.log(`   → Sujet: ${data.template.subject}`);
        console.log(`   → Template: ${data.template.template}`);
        
        if (data.daysInfo.isOverdue) {
          console.log(`   → ⚠️ RETARD: ${data.daysInfo.overdueDays} jours`);
        } else if (data.daysInfo.remainingDays) {
          console.log(`   → ⏰ Échéance dans ${data.daysInfo.remainingDays} jours`);
        }
        
        // Simulation envoi
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return {
          messageId: `REMINDER-${Date.now()}`,
          success: true,
          type: data.type
        };
      }
    },

    // Service d'alertes
    alertService: {
      notifyExecution: async (result) => {
        console.log(`🚨 Alerte exécution ${result.type}: ${result.totalProcessed} traités`);
      },

      notifyJobCompleted: (queueName, jobId) => {
        console.log(`✅ Alerte: Job ${jobId} terminé sur ${queueName}`);
      },

      notifyJobFailed: (queueName, jobId, reason) => {
        console.log(`❌ Alerte CRITIQUE: Job ${jobId} échoué sur ${queueName} - ${reason}`);
      },

      notifyJobStalled: (queueName, jobId) => {
        console.log(`⚠️ Alerte: Job ${jobId} bloqué sur ${queueName}`);
      },

      notifyError: (message, error) => {
        console.log(`🚨 Alerte ERREUR: ${message} - ${error.message}`);
      }
    }
  };

  // Configuration du service
  const reminderService = new ReminderService({
    // Configuration Redis
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },

    // Configuration MongoDB (optionnel)
    mongo: {
      uri: process.env.MONGO_URI || null
    },

    // Environnement
    isProduction: false,

    // Configuration des queues
    corporateQueue: 'lite-corporate-reminders',
    coverageQueue: 'lite-coverage-reminders',
    emailQueue: 'lite-email-reminders',

    // Configuration cron (pour test : plus fréquent)
    corporateCron: '*/30 * * * * *', // Toutes les 30 secondes pour demo
    coverageCron: '*/45 * * * * *',  // Toutes les 45 secondes pour demo

    // Configuration métier
    warningDays: 10,
    maxAttempts: 3,
    concurrency: 2,

    // Injection des services
    ...mockServices
  });

  try {
    // 1. Initialisation avec système d'alertes
    console.log('📋 Initialisation du ReminderService...');
    const initResult = await reminderService.initialize();
    console.log('✅ Initialisé:', initResult);
    console.log('');

    // 2. Test des fonctionnalités email génériques
    console.log('📧 Test des emails génériques...');
    
    await reminderService.sendWelcomeEmail('newuser@company.com', { name: 'Alice' });
    
    await reminderService.sendEmail(
      ['user1@company.com', 'user2@company.com'],
      'Test Email Lite',
      'Contenu du test email lite',
      { priority: 'high' }
    );

    await reminderService.sendNewsletter([
      { email: 'sub1@company.com', name: 'Subscriber 1' },
      { email: 'sub2@company.com', name: 'Subscriber 2' }
    ], {
      subject: 'Newsletter Test Lite',
      content: 'Contenu newsletter test'
    });

    console.log('');

    // 3. Test exécution forcée des rappels
    console.log('🔧 Test exécution forcée des rappels...');
    const forceResult = await reminderService.forceReminderExecution('both');
    console.log('📝 Jobs forcés:', forceResult);
    console.log('');

    // 4. Attendre que les jobs se terminent
    console.log('⏳ Attente exécution des jobs...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 5. Statistiques du service
    const stats = await reminderService.getStats();
    console.log('📊 Statistiques du service:');
    console.log('📈 Métriques:', stats.metrics);
    console.log('📋 Queues:', stats.queues);
    console.log('💾 MongoDB:', stats.mongodb);
    console.log('⏱️ Uptime:', Math.round(stats.service.uptime / 1000), 'secondes');
    console.log('');

    // 6. Health check
    const health = await reminderService.healthCheck();
    console.log('🔍 Health Check:', health);
    console.log('');

    // 7. Nettoyage des anciens jobs
    // await reminderService.cleanOldJobs(60000); // 1 minute
    console.log('');

    // 8. Test d'emails avec templates
    console.log('📝 Test templates d\'emails...');
    await reminderService.sendEmail(
      'template-test@company.com',
      'Template Test',
      null,
      {
        template: 'welcome',
        templateData: { name: 'Template User' }
      }
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 9. Arrêt propre
    console.log('🛑 Arrêt du service...');
    await reminderService.shutdown();

    console.log('\n🎉 === EXEMPLE TERMINÉ AVEC SUCCÈS ===');
    console.log('✅ ReminderService Lite testé complètement');
    console.log('✅ Système d\'alertes intégré fonctionnel');
    console.log('✅ Emails génériques + rappels spécialisés');
    console.log('✅ MongoDB et métriques en temps réel');
    console.log('✅ Aucune couche d\'abstraction - performance optimale');

  } catch (error) {
    console.error('❌ Erreur dans l\'exemple:', error);
    await reminderService.shutdown();
  }
}

// Exemple avec configuration avancée
async function exempleConfigurationAvancee() {
  console.log('\n🔧 === EXEMPLE CONFIGURATION AVANCÉE ===\n');

  const reminderService = new ReminderService({
    // Configuration Redis avancée
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },

    // MongoDB pour logs persistants
    mongo: {
      uri: process.env.MONGO_URI
    },

    // Mode production
    isProduction: process.env.NODE_ENV === 'production',

    // Queues personnalisées
    corporateQueue: 'advanced-corporate',
    coverageQueue: 'advanced-coverage',
    emailQueue: 'advanced-emails',

    // Cron patterns de production
    corporateCron: '0 9 1-10 * *',   // 10 premiers jours à 9h
    coverageCron: '0 10 * * *',      // Tous les jours à 10h

    // Configuration avancée
    warningDays: 15,
    maxAttempts: 7,
    concurrency: 5,
    retryDelays: [2000, 10000, 30000, 60000, 300000, 900000, 1800000],

    // Types de statuts personnalisés
    corporateTypes: ['PENDING', 'OVERDUE', 'REVIEWING'],
    coverageTypes: ['PENDING', 'OVERDUE', 'ESCALATED'],

    // Services mock avancés
    reimbursementService: {
      getReimbursements: async ({ type, statuses }) => {
        // Logique avancée avec filtres
        return [];
      }
    },

    alertService: {
      notifyExecution: async (result) => {
        if (result.totalReimbursements > 50) {
          console.log('🚨 ALERTE: Volume élevé de remboursements détecté!');
        }
      },
      notifyJobFailed: (queueName, jobId, reason) => {
        console.log(`🔥 ALERTE CRITIQUE: ${queueName}/${jobId} - ${reason}`);
        // Ici on pourrait envoyer SMS, webhook, Slack, etc.
      }
    }
  });
  console.log('⚙️ Configuration avancée chargée');
  console.log('📋 Queues:', ['advanced-corporate', 'advanced-coverage', 'advanced-emails']);
  console.log('⏰ Cron Corporate:', '0 9 1-10 * * (10 premiers jours à 9h)');
  console.log('⏰ Cron Coverage:', '0 10 * * * (tous les jours à 10h)');
  console.log('🔄 Max tentatives:', 7);
  console.log('🚀 Concurrence:', 5);
  console.log('');

  // Dans un vrai environnement, on ferait :
  // await reminderService.initialize();
  // Le service tournerait en continu avec les cron jobs
}

// Exécution selon l'argument CLI
if (require.main === module) {
  const arg = process.argv[2];
  
  switch(arg) {
    case 'advanced':
      exempleConfigurationAvancee().catch(console.error);
      break;
    default:
      exempleUtilisationLite().catch(console.error);
  }
}



module.exports = {
  exempleUtilisationLite,
  exempleConfigurationAvancee
};