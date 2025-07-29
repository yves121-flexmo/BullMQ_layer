require('dotenv').config();
const EmailService = require('./core/EmailService');
const path = require('path');
const fs = require('fs').promises;

// Configuration du service email
const emailService = new EmailService({
    from: process.env.GMAIL_USER || 'yves.lionel.diomande@gmail.com',
    password: process.env.GMAIL_APP_PASSWORD, // À configurer dans .env
    isProduction: process.env.NODE_ENV === 'production'
});

// Données de test
const mockReimbursement = {
    id: 'RBT-2024-001',
    type: 'SALARY',
    amount: 1500.50,
    dueDate: '2024-02-15',
    globalStatus: 'PENDING'
};

const mockDaysInfo = {
    remainingDays: 5
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
            to: 'yveslioneldiomande795@gmail.com',
            subject: 'Test - Rappel de paiement',
            html: template.replace(/<%=\s*([^%>]+)\s*%>/g, (match, p1) => {
                if (p1.includes('reimbursement.')) {
                    const prop = p1.split('.')[1].trim();
                    return mockReimbursement[prop];
                }
                if (p1.includes('daysInfo.')) {
                    const prop = p1.split('.')[1].trim();
                    return mockDaysInfo[prop];
                }
                if (p1.includes('recipient.name')) {
                    return 'Yves Lionel';
                }
                if (p1.includes('supportContact')) {
                    return 'support@flexmo.com';
                }
                return '';
            }),
            text: `Rappel de paiement pour le remboursement ${mockReimbursement.id}`
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