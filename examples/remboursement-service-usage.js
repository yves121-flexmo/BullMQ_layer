const RemboursementMailService = require('../services/RemboursementMailService');

/**
 * Services Mock pour démonstration
 * À remplacer par vos vrais services dans votre application
 */

// Service pour récupérer les remboursements
class MockReimbursementService {
  async getReimbursements({ type, statuses }) {
    const log = process.env.NODE_ENV !== 'production';
    if (log) console.log(`🔍 Récupération des remboursements ${type} avec statuts: ${statuses.join(', ')}`);
    
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
    const log = process.env.NODE_ENV !== 'production';
    if (log) console.log(`👤 Récupération du propriétaire pour ${reimbursementId}`);
    
    return {
      id: 'OWNER-001',
      email: 'owner@company.com',
      name: 'John Owner',
      role: 'company_owner'
    };
  }

  async getOldestManagers(type, limit = 3) {
    const log = process.env.NODE_ENV !== 'production';
    if (log) console.log(`👥 Récupération des ${limit} plus vieux managers (${type})`);
    
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
    const log = process.env.NODE_ENV !== 'production';
    
    if (log) {
      console.log(`📧 Envoi email de type "${type}" pour remboursement ${reimbursement.id}`);
      console.log(`   → ${recipients.length} destinataires`);
      console.log(`   → Sujet: ${template.subject}`);
      console.log(`   → Template: ${template.template}`);
      
      if (daysInfo.isOverdue) {
        console.log(`   → ⚠️ RETARD: ${daysInfo.overdueDays} jours`);
      } else if (daysInfo.remainingDays) {
        console.log(`   → ⏰ Échéance dans ${daysInfo.remainingDays} jours`);
      }
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

// Service de logging pour production
class MockLoggerService {
  info(message, data = null) {
    console.log(`[INFO] ${message}`, data || '');
  }

  error(message, errorData) {
    console.error(`[ERROR] ${message}`, errorData);
  }
}

/**
 * Exemple d'utilisation en développement
 */
async function exempleUtilisationDeveloppement() {
  console.log('🚀 Test en mode développement\n');

  // Configuration développement
  const config = {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    isProduction: false, // Mode développement = logs visibles
    reimbursementService: new MockReimbursementService(),
    managerService: new MockManagerService(),
    emailService: new MockEmailService(),
    loggerService: new MockLoggerService()
  };

  const reminderService = new RemboursementMailService(config);
  await reminderService.initialize();

  try {
    console.log('\n📊 Statistiques initiales:');
    const stats = await reminderService.getReminderStats();
    console.log(JSON.stringify(stats.environment, null, 2));

    console.log('\n🔧 Test d\'exécution manuelle des rappels...\n');
    await reminderService.forceReminderExecution('both');

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n✅ Test développement terminé !');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await reminderService.shutdown();
  }
}

/**
 * Exemple d'utilisation en production
 */
async function exempleUtilisationProduction() {
  console.log('🏭 Test en mode production\n');

  // Configuration production
  const config = {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    mongo: {
      uri: process.env.MONGO_URI || 'mongodb://localhost:27017/flexmo-reminders'
    },
    isProduction: true, // Mode production = pas de console.log
    reimbursementService: new MockReimbursementService(),
    managerService: new MockManagerService(),
    emailService: new MockEmailService(),
    loggerService: new MockLoggerService()
  };

  const reminderService = new RemboursementMailService(config);
  await reminderService.initialize();

  try {
    console.log('\n📊 Statistiques (mode production):');
    const stats = await reminderService.getReminderStats();
    console.log(JSON.stringify(stats.environment, null, 2));

    console.log('\n🔧 Exécution silencieuse en cours...');
    await reminderService.forceReminderExecution('both');

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n✅ Test production terminé (logs sauvegardés en DB) !');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await reminderService.shutdown();
  }
}

/**
 * Exemple avec variables d'environnement
 */
async function exempleAvecEnvironnement() {
  console.log('🌍 Test avec variables d\'environnement\n');

  // Configuration via variables d'environnement
  process.env.NODE_ENV = 'development';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.MONGO_URI = 'mongodb://localhost:27017/flexmo-test';

  const config = {
    // Utilise automatiquement les variables d'environnement
    reimbursementService: new MockReimbursementService(),
    managerService: new MockManagerService(), 
    emailService: new MockEmailService(),
    loggerService: new MockLoggerService()
  };

  const reminderService = new RemboursementMailService(config);
  await reminderService.initialize();

  try {
    const stats = await reminderService.getReminderStats();
    
    console.log('📊 Configuration détectée:');
    console.log(`   → Environnement: ${stats.environment.isProduction ? 'Production' : 'Développement'}`);
    console.log(`   → Redis: ${stats.environment.redisUrl}`);
    console.log(`   → MongoDB: ${stats.environment.hasMongoUri ? 'Configuré' : 'Non configuré'}`);

    await reminderService.forceReminderExecution('corporate');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n✅ Test environnement terminé !');
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await reminderService.shutdown();
  }
}

/**
 * Exemple d'intégration production réelle
 */
function exempleIntegrationReelle() {
  console.log('📋 Exemple d\'intégration en production réelle:\n');

  const exampleCode = `
// server.js - Votre application principale
const RemboursementMailService = require('./services/RemboursementMailService');

// Configuration production
const reminderService = new RemboursementMailService({
  // Variables d'environnement automatiques
  redis: {
    url: process.env.REDIS_URL // redis://user:pass@host:port
  },
  mongo: {
    uri: process.env.MONGO_URI // mongodb://host:port/database
  },
  isProduction: process.env.NODE_ENV === 'production',
  
  // Vos vrais services
  reimbursementService: require('./services/ReimbursementService'),
  managerService: require('./services/ManagerService'),
  emailService: require('./services/EmailService'),
  loggerService: require('./services/LoggerService')
});

// Démarrage automatique
async function startReminderSystem() {
  await reminderService.initialize();
  console.log('✅ Système de rappels démarré');
  
  // Le système fonctionne automatiquement avec les cron jobs !
  // Corporate: tous les jours 1-10 du mois à 9h
  // Coverage: tous les jours à 10h
}

// Arrêt propre
process.on('SIGTERM', async () => {
  await reminderService.shutdown();
  process.exit(0);
});

startReminderSystem().catch(console.error);
`;

  console.log(exampleCode);
}

// Exécution selon l'argument
if (require.main === module) {
  const arg = process.argv[2];
  
  switch(arg) {
    case 'production':
      exempleUtilisationProduction().catch(console.error);
      break;
    case 'env':
      exempleAvecEnvironnement().catch(console.error);
      break;
    case 'integration':
      exempleIntegrationReelle();
      break;
    default:
      exempleUtilisationDeveloppement().catch(console.error);
  }
}

module.exports = {
  exempleUtilisationDeveloppement,
  exempleUtilisationProduction,
  exempleAvecEnvironnement,
  MockReimbursementService,
  MockManagerService,
  MockEmailService,
  MockLoggerService
}; 