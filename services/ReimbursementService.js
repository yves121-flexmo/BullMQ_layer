/**
 * Service de gestion des remboursements
 * Fournit les fonctionnalités de base pour gérer les remboursements
 */
class ReimbursementService {
    constructor(config = {}) {
        this.config = {
            isProduction: config.isProduction || process.env.NODE_ENV === 'production',
            loggerService: config.loggerService
        };

        // Mock data pour les tests
        this.mockReimbursements = [
            {
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
                healthCoverageId: 'HC-001'
            },
            {
                id: 'RBT-2024-002',
                type: 'TREASURY',
                amount: 2500.75,
                dueDate: '2024-02-10',
                globalStatus: 'OVERDUE',
                company: {
                    name: 'Digital Services CI',
                    registrationNumber: 'CI-ABJ-2023-B-54321',
                    address: 'Plateau, Abidjan'
                },
                employee: {
                    name: 'Aka Sarah',
                    position: 'Chef de Projet',
                    department: 'Management'
                },
                healthCoverageId: 'HC-002'
            }
        ];
    }

    /**
     * Récupère les remboursements selon les critères
     * @param {Object} filters - Critères de filtrage
     * @returns {Promise<Array>} Liste des remboursements
     */
    async getReimbursements(filters = {}) {
        this.log('📥 Récupération des remboursements avec filtres:', filters);

        try {
            // Simulation de filtrage sur les données mock
            return this.mockReimbursements.filter(reimbursement => {
                const typeMatch = !filters.type || reimbursement.type === filters.type;
                const statusMatch = !filters.statuses || filters.statuses.includes(reimbursement.globalStatus);
                return typeMatch && statusMatch;
            });
        } catch (error) {
            this.logError('❌ Erreur récupération remboursements:', error);
            throw error;
        }
    }

    /**
     * Récupère un remboursement par son ID
     * @param {string} id - ID du remboursement
     * @returns {Promise<Object>} Détails du remboursement
     */
    async getReimbursementById(id) {
        this.log('🔍 Recherche remboursement:', id);

        try {
            const reimbursement = this.mockReimbursements.find(r => r.id === id);
            if (!reimbursement) {
                throw new Error(`Remboursement non trouvé: ${id}`);
            }
            return reimbursement;
        } catch (error) {
            this.logError(`❌ Erreur récupération remboursement ${id}:`, error);
            throw error;
        }
    }

    /**
     * Met à jour le statut d'un remboursement
     * @param {string} id - ID du remboursement
     * @param {string} status - Nouveau statut
     * @returns {Promise<Object>} Remboursement mis à jour
     */
    async updateStatus(id, status) {
        this.log(`📝 Mise à jour statut ${id} vers ${status}`);

        try {
            const reimbursement = await this.getReimbursementById(id);
            reimbursement.globalStatus = status;
            reimbursement.updatedAt = new Date();
            return reimbursement;
        } catch (error) {
            this.logError(`❌ Erreur mise à jour statut ${id}:`, error);
            throw error;
        }
    }

    /**
     * Logger intelligent selon l'environnement
     * @param {string} message - Message à logger
     * @param {*} data - Données additionnelles
     */
    log(message, data = null) {
        if (!this.config.isProduction) {
            console.log(message, data || '');
        } else if (this.config.loggerService) {
            this.config.loggerService.info(message, data);
        }
    }

    /**
     * Logger d'erreurs
     * @param {string} message - Message d'erreur
     * @param {Error} error - Erreur
     */
    logError(message, error) {
        if (!this.config.isProduction) {
            console.error(message, error);
        } else if (this.config.loggerService) {
            this.config.loggerService.error(message, { error: error.message, stack: error.stack });
        }
    }
}

module.exports = ReimbursementService;