const RemboursementMailManager = require('../core/RemboursementMailManager');

/**
 * Services Mock pour démonstration
 * À remplacer par vos vrais services dans votre application
 */

// Service pour récupérer les remboursements
class MockReimbursementService {
  async getReimbursements({ type, statuses }) {
    console.log(`🔍 Récupération des remboursements ${type} avec statuts: ${statuses.join(', ')}`);
    
    // Mock data - remplacez par vos vraies requêtes DB
    const mockReimbursements = [
      {
        id: 'REIMB-001',
        type: type,
        globalStatus: 'PENDING',
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // Dans 5 jours
        amount: 150000,
        companyId: 'COMP-001',
        healthCoverageId: type === 'TREASURY' ? 'HC-001' : null,
        description: 'Remboursement salaire Janvier'
      },
      {
        id: 'REIMB-002', 
        type: type,
        globalStatus: 'OVERDUE',
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // Il y a 3 jours
        amount: 200000,
        companyId: 'COMP-002',
        healthCoverageId: type === 'TREASURY' ? 'HC-002' : null,
        description: 'Remboursement urgent'
      },
      {
        id: 'REIMB-003',
        type: type,
        globalStatus: 'PENDING',
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // Dans 15 jours
        amount: 75000,
        companyId: 'COMP-001',
        healthCoverageId: type === 'TREASURY' ? 'HC-001' : null,
        description: 'Remboursement Février'
      }
    ];

    // Filtrage selon les statuts demandés
    return mockReimbursements.filter(r => statuses.includes(r.globalStatus));
  }
}

// Service pour récupérer les managers
class MockManagerService {
  async getReimbursementOwner(reimbursementId) {
    console.log(`👤 Récupération du propriétaire pour ${reimbursementId}`);
    
    return {
      id: 'OWNER-001',
      email: 'owner@company.com',
      name: 'John Owner',
      role: 'company_owner'
    };
  }

  async getOldestManagers(type, limit = 3) {
    console.log(`👥 Récupération des ${limit} plus vieux managers (${type})`);
    
    const mockManagers = [
      {
        id: 'MGR-001',
        email: 'manager1@company.com', 
        name: 'Alice Manager',
        role: type === 'corporate' ? 'corporate_manager' : 'coverage_manager',
        createdAt: new Date('2020-01-15')
      },
      {
        id: 'MGR-002',
        email: 'manager2@company.com',
        name: 'Bob Manager', 
        role: type === 'corporate' ? 'corporate_manager' : 'coverage_manager',
        createdAt: new Date('2020-03-20')
      },
      {
        id: 'MGR-003',
        email: 'manager3@company.com',
        name: 'Carol Manager',
        role: type === 'corporate' ? 'corporate_manager' : 'coverage_manager', 
        createdAt: new Date('2020-05-10')
      }
    ];

    // Tri par ancienneté et limite
    return mockManagers
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }
}

// Service d'envoi d'emails
class MockEmailService {
  async sendReminderEmail({ type, recipients, reimbursement, daysInfo, template }) {
    console.log(`📧 Envoi email de type "${type}" pour remboursement ${reimbursement.id}`);
    console.log(`   → ${recipients.length} destinataires`);
    console.log(`   → Sujet: ${template.subject}`);
    console.log(`   → Template: ${template.template}`);
    
    if (daysInfo.isOverdue) {
      console.log(`   → ⚠️ RETARD: ${daysInfo.overdueDays} jours`);
    } else if (daysInfo.remainingDays) {
      console.log(`   → ⏰ Échéance dans ${daysInfo.remainingDays} jours`);
    }

    // Simulation d'envoi
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      success: true,
      messageId: `MSG-${Date.now()}`,
      sentAt: new Date(),
      recipientCount: recipients.length
    };
  }
}

/**
 * Exemple d'utilisation du système de rappels
 */
async function exempleUtilisationRappels() {
  console.log('🚀 Démarrage du système de rappels de remboursements\n');

  // Configuration avec services mock
  const config = {
    redis: {
      host: 'localhost',
      port: 6379
    },
    defaultOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 50,
      removeOnFail: 20
    },
    // Injection des services
    reimbursementService: new MockReimbursementService(),
    managerService: new MockManagerService(),
    emailService: new MockEmailService()
  };

  // Initialisation du système
  const reminderManager = new RemboursementMailManager(config);
  await reminderManager.initializeReminderSystem();

  try {
    console.log('\n📊 Statistiques initiales:');
    const initialStats = await reminderManager.getReminderStats();
    console.log(JSON.stringify(initialStats, null, 2));

    console.log('\n🔧 Test d\'exécution manuelle des rappels...\n');
    
    // Test exécution manuelle Corporate
    console.log('=== TEST CORPORATE ===');
    const corporateExecution = await reminderManager.forceReminderExecution('corporate');
    console.log('Job Corporate lancé:', corporateExecution);

    // Attendre un peu
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test exécution manuelle Coverage  
    console.log('\n=== TEST COVERAGE ===');
    const coverageExecution = await reminderManager.forceReminderExecution('coverage');
    console.log('Job Coverage lancé:', coverageExecution);

    // Attendre le traitement
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📊 Statistiques finales:');
    const finalStats = await reminderManager.getReminderStats();
    console.log(JSON.stringify(finalStats, null, 2));

    console.log('\n✅ Test des rappels terminé avec succès !');

  } catch (error) {
    console.error('❌ Erreur pendant les tests:', error);
  } finally {
    // Nettoyage
    await reminderManager.shutdown();
  }
}

/**
 * Exemple d'intégration en production
 */
async function exempleIntegrationProduction() {
  console.log('🏭 Exemple d\'intégration en production\n');

  // Configuration production avec vrais services
  const productionConfig = {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    defaultOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50
    },
    // Vrais services à injecter
    reimbursementService: {
      async getReimbursements({ type, statuses }) {
        // TODO: Implémentez votre logique de récupération des remboursements
        // Exemple avec Mongoose/Sequelize:
        // return await Reimbursement.find({ 
        //   type, 
        //   globalStatus: { $in: statuses } 
        // });
        throw new Error('Implémentez reimbursementService.getReimbursements()');
      }
    },
    managerService: {
      async getReimbursementOwner(reimbursementId) {
        // TODO: Récupérer le propriétaire du remboursement
        throw new Error('Implémentez managerService.getReimbursementOwner()');
      },
      async getOldestManagers(type, limit) {
        // TODO: Récupérer les plus vieux managers
        // Exemple:
        // return await Manager.find({ type })
        //   .sort({ createdAt: 1 })
        //   .limit(limit);
        throw new Error('Implémentez managerService.getOldestManagers()');
      }
    },
    emailService: {
      async sendReminderEmail(params) {
        // TODO: Intégrer avec votre service d'email (SendGrid, Mailgun, etc.)
        throw new Error('Implémentez emailService.sendReminderEmail()');
      }
    }
  };

  const reminderManager = new RemboursementMailManager(productionConfig);
  
  // En production, lancez simplement l'initialisation
  // Les cron jobs se chargeront du reste automatiquement
  await reminderManager.initializeReminderSystem();
  
  console.log('✅ Système de rappels lancé en production');
  console.log('📅 Planification automatique :');
  console.log('   - Corporate: Tous les jours 1-10 du mois à 9h');
  console.log('   - Coverage: Tous les jours à 10h');
  
  // Le système fonctionne maintenant automatiquement !
  // Pour arrêter proprement:
  // await reminderManager.shutdown();
}

/**
 * Exemple de monitoring en temps réel
 */
async function exempleMonitoring() {
  console.log('📊 Exemple de monitoring des rappels\n');

  const reminderManager = new RemboursementMailManager({
    redis: { host: 'localhost', port: 6379 },
    reimbursementService: new MockReimbursementService(),
    managerService: new MockManagerService(),
    emailService: new MockEmailService()
  });

  await reminderManager.initializeReminderSystem();

  // Monitoring en temps réel
  console.log('🔍 Monitoring activé...');
  
  // Vérification périodique des stats
  const monitoringInterval = setInterval(async () => {
    try {
      const stats = await reminderManager.getReminderStats();
      console.log(`📊 [${new Date().toLocaleTimeString()}] Stats:`, {
        corporate: `${stats.corporate.active} actifs, ${stats.corporate.waiting} en attente`,
        coverage: `${stats.coverage.active} actifs, ${stats.coverage.waiting} en attente`,
        total: `${stats.summary.totalCompleted} terminés, ${stats.summary.totalFailed} échoués`
      });
    } catch (error) {
      console.error('❌ Erreur monitoring:', error);
    }
  }, 10000); // Toutes les 10 secondes

  // Arrêt après 1 minute
  setTimeout(async () => {
    clearInterval(monitoringInterval);
    await reminderManager.shutdown();
    console.log('🛑 Monitoring arrêté');
  }, 60000);
}

// Exécution selon l'argument
if (require.main === module) {
  const arg = process.argv[2];
  
  switch(arg) {
    case 'production':
      exempleIntegrationProduction().catch(console.error);
      break;
    case 'monitoring':
      exempleMonitoring().catch(console.error);
      break;
    default:
      exempleUtilisationRappels().catch(console.error);
  }
}

module.exports = {
  exempleUtilisationRappels,
  exempleIntegrationProduction,
  exempleMonitoring,
  MockReimbursementService,
  MockManagerService,
  MockEmailService
}; 