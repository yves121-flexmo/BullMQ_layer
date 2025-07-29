/**
 * Service de gestion des managers
 * Fournit les fonctionnalités pour gérer les managers et leurs relations avec les remboursements
 */
class ManagerService {
    constructor(config = {}) {
        this.config = {
            isProduction: config.isProduction || process.env.NODE_ENV === 'production',
            loggerService: config.loggerService
        };

        // Mock data pour les tests
        this.mockManagers = [
            {
                id: 'MGR-001',
                name: 'Kouassi Jean',
                email: 'jean.k@company.com',
                role: 'Senior Manager',
                department: 'Finance',
                joinDate: '2020-01-15',
                isActive: true
            },
            {
                id: 'MGR-002',
                name: 'Bamba Marie',
                email: 'marie.b@company.com',
                role: 'Department Head',
                department: 'Operations',
                joinDate: '2020-03-20',
                isActive: true
            },
            {
                id: 'MGR-003',
                name: 'Koffi Pierre',
                email: 'pierre.k@company.com',
                role: 'Team Lead',
                department: 'IT',
                joinDate: '2020-06-10',
                isActive: true
            }
        ];

        // Mock des relations remboursement-owner
        this.mockReimbursementOwners = {
            'RBT-2024-001': {
                id: 'OWN-001',
                name: 'Diallo Fatou',
                email: 'fatou.d@company.com',
                role: 'Finance Manager',
                department: 'Finance'
            },
            'RBT-2024-002': {
                id: 'OWN-002',
                name: 'Touré Ibrahim',
                email: 'ibrahim.t@company.com',
                role: 'Operations Manager',
                department: 'Operations'
            }
        };
    }

    /**
     * Récupère les managers les plus anciens
     * @param {string} type - Type de remboursement ('corporate' ou 'coverage')
     * @param {number} limit - Nombre de managers à récupérer
     * @returns {Promise<Array>} Liste des managers
     */
    async getOldestManagers(type, limit = 3) {
        this.log(`📊 Récupération des ${limit} plus anciens managers pour ${type}`);

        try {
            // Simulation de filtrage selon le type
            let managers = [...this.mockManagers];
            
            if (type === 'corporate') {
                managers = managers.filter(m => m.department === 'Finance');
            } else if (type === 'coverage') {
                managers = managers.filter(m => ['Finance', 'Operations'].includes(m.department));
            }

            // Tri par date d'entrée
            managers.sort((a, b) => new Date(a.joinDate) - new Date(b.joinDate));

            return managers.slice(0, limit);
        } catch (error) {
            this.logError('❌ Erreur récupération managers:', error);
            throw error;
        }
    }

    /**
     * Récupère le propriétaire d'un remboursement
     * @param {string} reimbursementId - ID du remboursement
     * @returns {Promise<Object>} Propriétaire du remboursement
     */
    async getReimbursementOwner(reimbursementId) {
        this.log(`🔍 Recherche propriétaire pour remboursement: ${reimbursementId}`);

        try {
            const owner = this.mockReimbursementOwners[reimbursementId];
            if (!owner) {
                throw new Error(`Propriétaire non trouvé pour: ${reimbursementId}`);
            }
            return owner;
        } catch (error) {
            this.logError(`❌ Erreur récupération propriétaire ${reimbursementId}:`, error);
            throw error;
        }
    }

    /**
     * Récupère un manager par son ID
     * @param {string} id - ID du manager
     * @returns {Promise<Object>} Détails du manager
     */
    async getManagerById(id) {
        this.log(`🔍 Recherche manager: ${id}`);

        try {
            const manager = this.mockManagers.find(m => m.id === id);
            if (!manager) {
                throw new Error(`Manager non trouvé: ${id}`);
            }
            return manager;
        } catch (error) {
            this.logError(`❌ Erreur récupération manager ${id}:`, error);
            throw error;
        }
    }

    /**
     * Récupère les managers par département
     * @param {string} department - Département
     * @returns {Promise<Array>} Liste des managers
     */
    async getManagersByDepartment(department) {
        this.log(`📊 Récupération managers du département: ${department}`);

        try {
            return this.mockManagers.filter(m => m.department === department);
        } catch (error) {
            this.logError(`❌ Erreur récupération managers département ${department}:`, error);
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

module.exports = ManagerService;