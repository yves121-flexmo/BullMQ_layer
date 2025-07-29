require('dotenv').config();
const EmailService = require('./core/EmailService');
const path = require('path');
const fs = require('fs').promises;

// Configuration du service email
const emailService = new EmailService({
    from: process.env.GMAIL_USER || 'contact@flexmo.app',
    password: process.env.GMAIL_APP_PASSWORD,
    isProduction: process.env.NODE_ENV === 'production'
});

// Données de test complètes
const mockReimbursement = {
    id: 'RBT-2024-001',
    type: 'SALARY',
    amount: 1500.50,
    dueDate: '2024-02-15',
    globalStatus: 'PENDING',
    company: {
        name: 'Tech Solutions SARL',
        registrationNumber: 'CI-ABJ-2023-B-12345',
        address: 'Cocody Riviera 3, Abidjan'
    },
    employee: {
        name: 'Konan Marc',
        position: 'Développeur Senior',
        department: 'IT'
    },
    details: {
        description: 'Remboursement salaire Janvier 2024',
        category: 'Salaire mensuel',
        paymentMethod: 'Virement bancaire',
        bankInfo: {
            bank: 'NSIA Banque',
            accountNumber: 'CI040 01010 010101010101'
        }
    }
};

const mockDaysInfo = {
    remainingDays: 5,
    dueDate: '15 Février 2024',
    overdueDays: 0,
    urgencyLevel: 'MEDIUM'
};

const mockCompanyInfo = {
    name: 'Flexmo',
    email: 'contact@flexmo.app',
    phone: '+225 07 47 51 00 00',
    address: 'Abidjan, Côte d\'Ivoire',
    website: 'www.flexmo.app',
    supportContact: {
        email: 'contact@flexmo.app',
        phone: '+225 07 47 51 00 00',
        hours: '8h-18h GMT'
    }
};

/**
 * Teste l'envoi d'un email de rappel avant échéance
 */
async function testBeforeDueReminder() {
    try {
        // Lecture du template
        const templatePath = path.join(__dirname, 'lite', 'templates', 'reminder-before-due.ejs');
        const template = await fs.readFile(templatePath, 'utf-8');

        // Configuration de l'email
        const emailOptions = {
            to: ['yveslioneldiomande795@gmail.com', 'yves.lionel.diomande@gmail.com'],
            subject: `Rappel de paiement - ${mockReimbursement.company.name} - Échéance dans ${mockDaysInfo.remainingDays} jours`,
            html: template.replace(/<%=\s*([^%>]+)\s*%>/g, (match, p1) => {
                if (p1.includes('reimbursement.')) {
                    const props = p1.split('.').slice(1);
                    return props.reduce((obj, prop) => obj?.[prop], mockReimbursement) || '';
                }
                if (p1.includes('daysInfo.')) {
                    const prop = p1.split('.')[1].trim();
                    return mockDaysInfo[prop];
                }
                if (p1.includes('company.')) {
                    const prop = p1.split('.')[1].trim();
                    return mockCompanyInfo[prop];
                }
                if (p1.includes('recipient.name')) {
                    return mockReimbursement.employee.name;
                }
                if (p1.includes('supportContact')) {
                    return mockCompanyInfo.supportContact.email;
                }
                return '';
            }),
            text: `Rappel de paiement pour le remboursement ${mockReimbursement.id} - ${mockReimbursement.company.name} - Montant: ${mockReimbursement.amount} EUR - Échéance: ${mockDaysInfo.dueDate}`
        };

        // Envoi de l'email
        console.log('📧 Envoi du mail de test...');
        const result = await emailService.sendMail(emailOptions);
        console.log('✅ Email envoyé avec succès:', result);

    } catch (error) {
        console.error('❌ Erreur lors du test:', error);
    }
}

// Test de connexion puis envoi
async function runTest() {
    try {
        // Vérification de la connexion
        console.log('🔄 Vérification de la connexion SMTP...');
        const isConnected = await emailService.verifyConnection();
        
        if (!isConnected) {
            throw new Error('Impossible de se connecter au serveur SMTP');
        }
        
        console.log('✅ Connexion SMTP établie');

        // Test d'envoi
        await testBeforeDueReminder();

    } catch (error) {
        console.error('❌ Erreur:', error);
    }
}

// Exécution du test
runTest();