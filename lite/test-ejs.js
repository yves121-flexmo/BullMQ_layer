/**
 * @fileoverview Test du système EJS avec templates
 * Démontre l'utilisation des templates EJS dans le dossier templates/
 */

const EmailUtils = require('./email-utils');

/**
 * Teste tous les templates disponibles
 */
async function testAllTemplates() {
  console.log('🧪 === TEST DU SYSTÈME EJS AVEC TEMPLATES ===\n');

  // Test du template welcome
  console.log('📧 Test template WELCOME...');
  try {
    const welcomeHtml = await EmailUtils.renderTemplate('welcome', {
      name: 'Alice Dupont',
      userData: {
        role: 'Manager Finance',
        department: 'Finance',
        loginUrl: 'https://app.company.com/login',
        unsubscribeUrl: 'https://app.company.com/unsubscribe'
      }
    });
    console.log('✅ Template welcome rendu avec succès');
    console.log(`📏 Taille: ${welcomeHtml.length} caractères`);
    console.log(`🎯 Contient "Alice Dupont": ${welcomeHtml.includes('Alice Dupont') ? '✅' : '❌'}`);
    console.log(`🎯 Contient "Manager Finance": ${welcomeHtml.includes('Manager Finance') ? '✅' : '❌'}\n`);
  } catch (error) {
    console.error('❌ Erreur template welcome:', error.message);
  }

  // Test du template newsletter
  console.log('📰 Test template NEWSLETTER...');
  try {
    const newsletterHtml = await EmailUtils.renderTemplate('newsletter', {
      month: 'janvier 2025',
      recipient: { name: 'Bob Martin', email: 'bob@company.com' },
      newsletterData: {
        intro: 'Voici les actualités de ce mois !',
        articles: [
          {
            title: 'Nouvelle fonctionnalité',
            summary: 'Découvrez notre nouvelle interface utilisateur',
            readMoreUrl: 'https://blog.company.com/nouvelle-interface'
          },
          {
            title: 'Mise à jour sécurité',
            summary: 'Améliorations importantes de la sécurité',
            readMoreUrl: 'https://blog.company.com/securite'
          }
        ],
        stats: {
          newUsers: 250,
          activeProjects: 45,
          completedTasks: 1200
        },
        events: [
          {
            title: 'Formation BullMQ',
            date: '15 février 2025',
            description: 'Apprenez à maîtriser BullMQ',
            registerUrl: 'https://events.company.com/bullmq'
          }
        ],
        tips: [
          'Utilisez les templates EJS pour vos emails',
          'Documentez votre code avec JSDoc',
          'Testez vos queues en local avant la production'
        ],
        unsubscribeUrl: 'https://newsletter.company.com/unsubscribe'
      }
    });
    console.log('✅ Template newsletter rendu avec succès');
    console.log(`📏 Taille: ${newsletterHtml.length} caractères`);
    console.log(`🎯 Contient "Bob Martin": ${newsletterHtml.includes('Bob Martin') ? '✅' : '❌'}`);
    console.log(`🎯 Contient "janvier 2025": ${newsletterHtml.includes('janvier 2025') ? '✅' : '❌'}\n`);
  } catch (error) {
    console.error('❌ Erreur template newsletter:', error.message);
  }

  // Test du template reminder-before-due
  console.log('⏰ Test template REMINDER-BEFORE-DUE...');
  try {
    const reminderHtml = await EmailUtils.renderTemplate('reminder-before-due', {
      recipient: { name: 'Claire Dubois', email: 'claire@company.com' },
      reimbursement: {
        id: 'RBT-2025-001',
        type: 'SALARY',
        amount: 2500,
        dueDate: '2025-02-15',
        description: 'Remboursement salaire janvier',
        beneficiary: 'Claire Dubois',
        globalStatus: 'PENDING',
        paymentUrl: 'https://pay.company.com/RBT-2025-001'
      },
      daysInfo: {
        remainingDays: 5,
        isOverdue: false
      }
    });
    console.log('✅ Template reminder-before-due rendu avec succès');
    console.log(`📏 Taille: ${reminderHtml.length} caractères`);
    console.log(`🎯 Contient "Claire Dubois": ${reminderHtml.includes('Claire Dubois') ? '✅' : '❌'}`);
    console.log(`🎯 Contient "RBT-2025-001": ${reminderHtml.includes('RBT-2025-001') ? '✅' : '❌'}\n`);
  } catch (error) {
    console.error('❌ Erreur template reminder-before-due:', error.message);
  }

  // Test du template reminder-overdue
  console.log('🚨 Test template REMINDER-OVERDUE...');
  try {
    const overdueHtml = await EmailUtils.renderTemplate('reminder-overdue', {
      recipient: { name: 'David Lambert', email: 'david@company.com' },
      reimbursement: {
        id: 'RBT-2025-002',
        type: 'TREASURY',
        amount: 3200,
        dueDate: '2025-01-20',
        description: 'Remboursement trésorerie décembre',
        beneficiary: 'David Lambert',
        globalStatus: 'OVERDUE',
        paymentUrl: 'https://pay.company.com/RBT-2025-002',
        contactUrl: 'https://support.company.com/contact',
        escalationContacts: [
          { role: 'Manager Finance', name: 'Sophie Martin', email: 'sophie@company.com', phone: '01.23.45.67.89' },
          { role: 'Directeur Financier', name: 'Pierre Durand', email: 'pierre@company.com', phone: '01.23.45.67.90' }
        ]
      },
      daysInfo: {
        overdueDays: 9,
        isOverdue: true
      }
    });
    console.log('✅ Template reminder-overdue rendu avec succès');
    console.log(`📏 Taille: ${overdueHtml.length} caractères`);
    console.log(`🎯 Contient "David Lambert": ${overdueHtml.includes('David Lambert') ? '✅' : '❌'}`);
    console.log(`🎯 Contient "9 jours": ${overdueHtml.includes('9 jours') ? '✅' : '❌'}\n`);
  } catch (error) {
    console.error('❌ Erreur template reminder-overdue:', error.message);
  }

  // Test du template password-reset
  console.log('🔐 Test template PASSWORD-RESET...');
  try {
    const resetHtml = await EmailUtils.renderTemplate('password-reset', {
      resetLink: 'https://auth.company.com/reset?token=abc123def456',
      resetCode: '123456',
      expirationTime: '15 minutes',
      userData: {
        email: 'user@company.com',
        lastLogin: '2025-01-28T10:30:00Z',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        requestId: 'req_abc123def456'
      },
      supportContact: {
        email: 'support@company.com',
        phone: '01.23.45.67.89',
        hours: 'Lun-Ven 9h-18h'
      }
    });
    console.log('✅ Template password-reset rendu avec succès');
    console.log(`📏 Taille: ${resetHtml.length} caractères`);
    console.log(`🎯 Contient "123456": ${resetHtml.includes('123456') ? '✅' : '❌'}`);
    console.log(`🎯 Contient "15 minutes": ${resetHtml.includes('15 minutes') ? '✅' : '❌'}\n`);
  } catch (error) {
    console.error('❌ Erreur template password-reset:', error.message);
  }

  // Test des utilitaires EmailUtils
  console.log('🔧 Test des UTILITAIRES EmailUtils...');
  
  // Test getAvailableTemplates
  const availableTemplates = EmailUtils.getAvailableTemplates();
  console.log(`📋 Templates disponibles: ${availableTemplates.join(', ')}`);
  
  // Test templateExists
  console.log(`🔍 Template "welcome" existe: ${EmailUtils.templateExists('welcome') ? '✅' : '❌'}`);
  console.log(`🔍 Template "unknown" existe: ${EmailUtils.templateExists('unknown') ? '❌' : '✅'}`);
  
  // Test getPriorityValue
  console.log(`📊 Priorité "high": ${EmailUtils.getPriorityValue('high')}`);
  console.log(`📊 Priorité "urgent": ${EmailUtils.getPriorityValue('urgent')}`);
  
  // Test sanitizeEmails
  const dirtyEmails = [' USER@EXAMPLE.COM ', 'test@test.com', 'invalid-email', 'user@example.com'];
  const cleanEmails = EmailUtils.sanitizeEmails(dirtyEmails);
  console.log(`🧹 Emails nettoyés: ${cleanEmails.join(', ')}`);
  
  // Test du cache
  const cacheStats = EmailUtils.getCacheStats();
  console.log(`💾 Cache templates: ${cacheStats.size} templates en cache`);
  
  console.log('\n🎉 === TOUS LES TESTS TERMINÉS ===');
}

/**
 * Test des templates avec données incomplètes
 */
async function testPartialData() {
  console.log('\n🧪 === TEST AVEC DONNÉES PARTIELLES ===\n');

  try {
    // Test welcome avec données minimales
    const minimalWelcome = await EmailUtils.renderTemplate('welcome', {
      name: 'Utilisateur Test'
    });
    console.log('✅ Template welcome avec données minimales: OK');

    // Test newsletter avec données partielles
    const minimalNewsletter = await EmailUtils.renderTemplate('newsletter', {
      recipient: { name: 'Test User' },
      newsletterData: { intro: 'Newsletter de test' }
    });
    console.log('✅ Template newsletter avec données partielles: OK');

  } catch (error) {
    console.error('❌ Erreur test données partielles:', error.message);
  }
}

/**
 * Test de gestion d'erreurs
 */
async function testErrorHandling() {
  console.log('\n🧪 === TEST GESTION D\'ERREURS ===\n');

  try {
    // Test template inexistant
    await EmailUtils.renderTemplate('nonexistent', {});
  } catch (error) {
    console.log('✅ Erreur template inexistant capturée:', error.message);
  }

  try {
    // Test validation email
    const errors = EmailUtils.validateEmailData({
      to: ['invalid-email'],
      subject: '',
      template: 'nonexistent'
    });
    console.log('✅ Validation emails:', errors.length, 'erreurs détectées');
    console.log('   -', errors.join('\n   - '));
  } catch (error) {
    console.error('❌ Erreur validation:', error.message);
  }
}

// Exécution des tests
async function runAllTests() {
  try {
    await testAllTemplates();
    await testPartialData();
    await testErrorHandling();
  } catch (error) {
    console.error('❌ Erreur globale:', error.message);
  }
}

// Lancement si appelé directement
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testAllTemplates, testPartialData, testErrorHandling };