/**
 * @fileoverview Business Logic - Logique métier pour les remboursements
 * 
 * Module contenant :
 * - Logique de traitement des remboursements Corporate et Coverage
 * - Calculs de dates et échéances avec gestion des fuseaux horaires
 * - Groupement et récupération des destinataires
 * - Règles métier spécialisées et validation des données
 * - Analyse d'urgence et génération de rapports exécutifs
 * - Filtrage, tri et statistiques avancées
 * 
 * @author Flexmo Team
 * @version 1.0.0
 * @since 2025-01-29
 */

/**
 * @typedef {Object} Reimbursement
 * @property {string} id - Identifiant unique du remboursement
 * @property {string} type - Type de remboursement ('SALARY', 'TREASURY')
 * @property {number} amount - Montant du remboursement en euros
 * @property {string} dueDate - Date d'échéance (format ISO 8601)
 * @property {string} globalStatus - Statut global ('PENDING', 'OVERDUE', 'COMPLETED')
 * @property {string} [description] - Description du remboursement
 * @property {string} [beneficiary] - Bénéficiaire du remboursement
 * @property {string} [healthCoverageId] - ID de la couverture santé (Treasury uniquement)
 */

/**
 * @typedef {Object} ProcessingResult
 * @property {string} id - ID du remboursement traité
 * @property {string} emailType - Type d'email envoyé ('payment-reminder', 'payment-overdue')
 * @property {number} daysDiff - Différence en jours par rapport à l'échéance
 * @property {number} recipientCount - Nombre de destinataires
 * @property {string} emailJobId - ID du job d'email créé
 * @property {boolean} [skipped] - Indique si le traitement a été ignoré
 * @property {string} [reason] - Raison de l'ignorance du traitement
 */

/**
 * @typedef {Object} CoverageProcessingResult
 * @property {string} healthCoverageId - ID de la couverture santé
 * @property {number} totalReimbursements - Nombre total de remboursements
 * @property {number} emailsSent - Nombre d'emails envoyés
 * @property {Array<ProcessingResult>} processedReimbursements - Détails des traitements
 */

/**
 * @typedef {Object} DaysInfo
 * @property {number} daysDiff - Différence en jours (négatif si en retard)
 * @property {boolean} [isOverdue] - Indique si le remboursement est en retard
 * @property {number} [remainingDays] - Jours restants avant échéance (si positif)
 * @property {number} [overdueDays] - Jours de retard (si négatif)
 */

/**
 * @typedef {Object} Recipient
 * @property {string} name - Nom du destinataire
 * @property {string} email - Email du destinataire
 * @property {string} [role] - Rôle du destinataire
 * @property {string} [department] - Département du destinataire
 */

/**
 * @typedef {Object} UrgencyAnalysis
 * @property {Array<Reimbursement>} critical - Remboursements critiques (>7 jours de retard)
 * @property {Array<Reimbursement>} urgent - Remboursements urgents (≤2 jours)
 * @property {Array<Reimbursement>} warning - Remboursements d'avertissement (3-10 jours)
 * @property {Array<Reimbursement>} normal - Remboursements normaux (10-30 jours)
 * @property {Array<Reimbursement>} future - Remboursements futurs (>30 jours)
 */

/**
 * @typedef {Object} ReimbursementStats
 * @property {number} total - Nombre total de remboursements
 * @property {Object<string, number>} byStatus - Répartition par statut
 * @property {Object<string, number>} byType - Répartition par type
 * @property {Object<string, number>} byUrgency - Répartition par niveau d'urgence
 * @property {Object} amounts - Statistiques des montants
 * @property {number} amounts.total - Montant total
 * @property {number} amounts.average - Montant moyen
 * @property {number} amounts.min - Montant minimum
 * @property {number} amounts.max - Montant maximum
 * @property {number} amounts.overdue - Montant total en retard
 * @property {Object<string, number>} timeline - Répartition par mois d'échéance
 */

/**
 * @typedef {Object} EmailStrategy
 * @property {boolean} shouldSend - Indique si un email doit être envoyé
 * @property {string} [emailType] - Type d'email à envoyer
 * @property {string} priority - Priorité de l'email ('normal', 'high', 'urgent')
 * @property {number} delay - Délai avant envoi en millisecondes
 * @property {string} reason - Raison de la décision
 */

/**
 * @typedef {Object} ExecutiveSummary
 * @property {Object} overview - Vue d'ensemble générale
 * @property {Object} urgency - Analyse d'urgence
 * @property {Object} breakdown - Répartition par type
 * @property {Array} recommendations - Recommandations d'actions
 */

/**
 * BusinessLogic - Classe de logique métier pour les remboursements
 * 
 * Cette classe encapsule toute la logique métier spécifique aux remboursements,
 * incluant les règles de traitement Corporate et Coverage, les calculs de dates,
 * l'analyse d'urgence et la génération de rapports.
 * 
 * @class BusinessLogic
 */
class BusinessLogic {
  
  /**
   * Crée une instance de BusinessLogic
   * 
   * @param {Object} service - Instance du ReminderService principal
   * @param {Object} service.config - Configuration du service
   * @param {number} service.config.warningDays - Nombre de jours d'avertissement
   * @param {string} service.config.emailQueue - Nom de la queue email
   * @param {Function} service.log - Fonction de logging
   * @param {Function} service.logError - Fonction de logging d'erreurs
   * @param {Object} service.managerService - Service de gestion des managers
   * @param {Map} service.queues - Map des queues BullMQ
   */
  constructor(service) {
    /**
     * Instance du service principal
     * @type {Object}
     * @private
     */
    this.service = service;
    
    /**
     * Configuration du service
     * @type {Object}
     * @private
     */
    this.config = service.config;
  }

  /**
   * Traite un remboursement Corporate selon les règles métier
   * 
   * Les règles Corporate :
   * - Traitement uniquement les 10 premiers jours du mois
   * - Type SALARY avec statuts PENDING/OVERDUE
   * - Email immédiat si en retard, sinon rappel standard
   * 
   * @async
   * @param {Reimbursement} reimbursement - Remboursement à traiter
   * @param {Date} [currentDate=new Date()] - Date actuelle pour les calculs
   * @returns {Promise<ProcessingResult>} Résultat du traitement
   * @throws {Error} Si le remboursement est invalide ou si l'envoi échoue
   * 
   * @example
   * const reimbursement = {
   *   id: 'RBT-001',
   *   type: 'SALARY',
   *   amount: 2500,
   *   dueDate: '2025-02-15',
   *   globalStatus: 'PENDING'
   * };
   * const result = await businessLogic.processCorporateReimbursement(reimbursement);
   * console.log(`Email ${result.emailType} envoyé à ${result.recipientCount} destinataires`);
   */
  async processCorporateReimbursement(reimbursement, currentDate = new Date()) {
    const dueDate = new Date(reimbursement.dueDate);
    const timeDiff = dueDate.getTime() - currentDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    let emailType;
    let daysInfo = { daysDiff, isOverdue: false };

    if (daysDiff <= 0) {
      emailType = 'payment-overdue';
      daysInfo.isOverdue = true;
      daysInfo.overdueDays = Math.abs(daysDiff);
    } else {
      emailType = 'payment-reminder';
      daysInfo.remainingDays = daysDiff;
    }

    // Récupération destinataires
    const recipients = await this.getReimbursementRecipients(reimbursement, 'corporate');

    // Envoi email
    const emailQueue = this.service.queues.get(this.config.emailQueue);
    const emailJob = await emailQueue.add('send-reminder-email', {
      emailType,
      recipients,
      reimbursement,
      daysInfo
    });

    return {
      id: reimbursement.id,
      emailType,
      daysDiff,
      recipientCount: recipients.length,
      emailJobId: emailJob.id
    };
  }

  /**
   * Traite les remboursements d'une health-coverage selon les règles Coverage
   * 
   * Les règles Coverage :
   * - Traitement tous les jours du mois
   * - Type TREASURY avec statuts PENDING/OVERDUE
   * - Rappel à X jours configurables avant échéance
   * - Email immédiat si en retard
   * 
   * @async
   * @param {string} healthCoverageId - ID de la couverture santé
   * @param {Array<Reimbursement>} reimbursements - Remboursements à traiter
   * @param {Date} [currentDate=new Date()] - Date actuelle pour les calculs
   * @returns {Promise<CoverageProcessingResult>} Résultat du traitement
   * @throws {Error} Si les remboursements sont invalides ou si l'envoi échoue
   * 
   * @example
   * const reimbursements = [
   *   { id: 'RBT-001', type: 'TREASURY', dueDate: '2025-02-10' },
   *   { id: 'RBT-002', type: 'TREASURY', dueDate: '2025-02-20' }
   * ];
   * const result = await businessLogic.processCoverageReimbursements('HC-001', reimbursements);
   * console.log(`${result.emailsSent} emails envoyés sur ${result.totalReimbursements}`);
   */
  async processCoverageReimbursements(healthCoverageId, reimbursements, currentDate = new Date()) {
    const processedReimbursements = [];

    for (const reimbursement of reimbursements) {
      const dueDate = new Date(reimbursement.dueDate);
      const timeDiff = dueDate.getTime() - currentDate.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      let shouldSendEmail = false;
      let emailType;
      let daysInfo = { daysDiff };

      // Logique Coverage
      if (daysDiff <= 0) {
        shouldSendEmail = true;
        emailType = 'payment-overdue';
        daysInfo.isOverdue = true;
        daysInfo.overdueDays = Math.abs(daysDiff);
      } else if (daysDiff <= this.config.warningDays) {
        shouldSendEmail = true;
        emailType = 'payment-reminder';
        daysInfo.remainingDays = daysDiff;
      }

      if (shouldSendEmail) {
        const recipients = await this.getReimbursementRecipients(reimbursement, 'coverage');
        
        const emailQueue = this.service.queues.get(this.config.emailQueue);
        const emailJob = await emailQueue.add('send-reminder-email', {
          emailType,
          recipients,
          reimbursement,
          daysInfo
        });

        processedReimbursements.push({
          id: reimbursement.id,
          emailType,
          daysDiff,
          recipientCount: recipients.length,
          emailJobId: emailJob.id
        });
      } else {
        processedReimbursements.push({
          id: reimbursement.id,
          skipped: true,
          reason: `${daysDiff} jours restants, pas d'alerte nécessaire`
        });
      }
    }

    return {
      healthCoverageId,
      totalReimbursements: reimbursements.length,
      emailsSent: processedReimbursements.filter(r => !r.skipped).length,
      processedReimbursements
    };
  }

  /**
   * Groupe les remboursements par health-coverage
   * 
   * Organise une liste de remboursements en groupes selon leur healthCoverageId
   * pour faciliter le traitement par couverture santé.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @returns {Object<string, Array<Reimbursement>>} Remboursements groupés par health-coverage
   * 
   * @example
   * const reimbursements = [
   *   { id: 'RBT-001', healthCoverageId: 'HC-001' },
   *   { id: 'RBT-002', healthCoverageId: 'HC-001' },
   *   { id: 'RBT-003', healthCoverageId: 'HC-002' }
   * ];
   * const grouped = businessLogic.groupByHealthCoverage(reimbursements);
   * // Résultat: { 'HC-001': [RBT-001, RBT-002], 'HC-002': [RBT-003] }
   */
  groupByHealthCoverage(reimbursements) {
    return reimbursements.reduce((groups, reimbursement) => {
      const healthCoverageId = reimbursement.healthCoverageId || 'unknown';
      if (!groups[healthCoverageId]) {
        groups[healthCoverageId] = [];
      }
      groups[healthCoverageId].push(reimbursement);
      return groups;
    }, {});
  }

  /**
   * Récupère les destinataires pour un remboursement donné
   * 
   * Récupère le propriétaire du remboursement et les 3 managers les plus anciens
   * selon le type de traitement (corporate/coverage).
   * 
   * @async
   * @param {Reimbursement} reimbursement - Remboursement concerné
   * @param {string} type - Type de traitement ('corporate', 'coverage')
   * @returns {Promise<Array<Recipient>>} Liste des destinataires dédoublonnée
   * @throws {Error} Si la récupération des destinataires échoue
   * 
   * @example
   * const recipients = await businessLogic.getReimbursementRecipients(reimbursement, 'corporate');
   * console.log(`Envoi à ${recipients.length} destinataires`);
   * recipients.forEach(r => console.log(`- ${r.name} (${r.email})`));
   */
  async getReimbursementRecipients(reimbursement, type) {
    try {
      const owner = await this.service.managerService.getReimbursementOwner(reimbursement.id);
      const oldestManagers = await this.service.managerService.getOldestManagers(type, 3);
      
      const recipients = [owner, ...oldestManagers].filter(Boolean);
      
      // Dédoublonnage par email
      return recipients.filter((recipient, index, self) => 
        index === self.findIndex(r => r.email === recipient.email)
      );
    } catch (error) {
      this.service.logError(`❌ Erreur récupération destinataires pour ${reimbursement.id}:`, error);
      return [];
    }
  }

  /**
   * Analyse et classe les remboursements par niveau d'urgence
   * 
   * Classe les remboursements en 5 catégories d'urgence selon les jours
   * restants avant échéance ou le retard accumulé.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @param {Date} [currentDate=new Date()] - Date de référence pour les calculs
   * @returns {UrgencyAnalysis} Analyse d'urgence avec remboursements classés
   * 
   * @example
   * const analysis = businessLogic.analyzeReimbursementUrgency(reimbursements);
   * console.log(`${analysis.critical.length} remboursements critiques`);
   * console.log(`${analysis.urgent.length} remboursements urgents`);
   */
  analyzeReimbursementUrgency(reimbursements, currentDate = new Date()) {
    const analysis = {
      critical: [], // En retard de plus de 7 jours
      urgent: [],   // En retard ou échéance dans 1-2 jours
      warning: [],  // Échéance dans 3-10 jours
      normal: [],   // Échéance dans plus de 10 jours
      future: []    // Échéance dans plus de 30 jours
    };

    for (const reimbursement of reimbursements) {
      const dueDate = new Date(reimbursement.dueDate);
      const timeDiff = dueDate.getTime() - currentDate.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

      reimbursement.daysDiff = daysDiff;
      reimbursement.urgencyLevel = this.calculateUrgencyLevel(daysDiff);

      if (daysDiff < -7) {
        analysis.critical.push(reimbursement);
      } else if (daysDiff <= 2) {
        analysis.urgent.push(reimbursement);
      } else if (daysDiff <= 10) {
        analysis.warning.push(reimbursement);
      } else if (daysDiff <= 30) {
        analysis.normal.push(reimbursement);
      } else {
        analysis.future.push(reimbursement);
      }
    }

    return analysis;
  }

  /**
   * Calcule le niveau d'urgence d'un remboursement
   * 
   * @param {number} daysDiff - Différence en jours (négatif si en retard)
   * @returns {string} Niveau d'urgence ('critical', 'urgent', 'warning', 'normal', 'future')
   * 
   * @example
   * const urgency = businessLogic.calculateUrgencyLevel(-10); // 'critical'
   * const urgency2 = businessLogic.calculateUrgencyLevel(2); // 'urgent'
   */
  calculateUrgencyLevel(daysDiff) {
    if (daysDiff < -7) return 'critical';
    if (daysDiff <= 2) return 'urgent';
    if (daysDiff <= 10) return 'warning';
    if (daysDiff <= 30) return 'normal';
    return 'future';
  }

  /**
   * Détermine la stratégie d'envoi d'email selon le contexte
   * 
   * Analyse un remboursement et détermine s'il faut envoyer un email,
   * quel type, avec quelle priorité et quel délai.
   * 
   * @param {Reimbursement} reimbursement - Remboursement à analyser
   * @param {string} type - Type de traitement ('corporate', 'coverage')
   * @param {Date} [currentDate=new Date()] - Date de référence
   * @returns {EmailStrategy} Stratégie d'envoi recommandée
   * 
   * @example
   * const strategy = businessLogic.determineEmailStrategy(reimbursement, 'corporate');
   * if (strategy.shouldSend) {
   *   console.log(`Envoyer ${strategy.emailType} avec priorité ${strategy.priority}`);
   * }
   */
  determineEmailStrategy(reimbursement, type, currentDate = new Date()) {
    const dueDate = new Date(reimbursement.dueDate);
    const timeDiff = dueDate.getTime() - currentDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    const strategy = {
      shouldSend: false,
      emailType: null,
      priority: 'normal',
      delay: 0,
      reason: ''
    };

    if (type === 'corporate') {
      // Logique Corporate : seulement pendant les 10 premiers jours du mois
      const dayOfMonth = currentDate.getDate();
      if (dayOfMonth > 10) {
        strategy.reason = 'Hors période Corporate (> 10 jours du mois)';
        return strategy;
      }

      strategy.shouldSend = true;
      if (daysDiff <= 0) {
        strategy.emailType = 'payment-overdue';
        strategy.priority = 'urgent';
      } else {
        strategy.emailType = 'payment-reminder';
        strategy.priority = daysDiff <= 3 ? 'high' : 'normal';
      }
    } else if (type === 'coverage') {
      // Logique Coverage : rappel à X jours ou si en retard
      if (daysDiff <= 0) {
        strategy.shouldSend = true;
        strategy.emailType = 'payment-overdue';
        strategy.priority = 'urgent';
      } else if (daysDiff <= this.config.warningDays) {
        strategy.shouldSend = true;
        strategy.emailType = 'payment-reminder';
        strategy.priority = daysDiff <= 3 ? 'high' : 'normal';
      } else {
        strategy.reason = `${daysDiff} jours restants, pas d'alerte nécessaire`;
      }
    }

    return strategy;
  }

  /**
   * Calcule les statistiques complètes des remboursements
   * 
   * Génère un rapport statistique détaillé incluant les répartitions
   * par statut, type, urgence, ainsi que les statistiques de montants.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @param {Date} [currentDate=new Date()] - Date de référence
   * @returns {ReimbursementStats} Statistiques complètes
   * 
   * @example
   * const stats = businessLogic.calculateReimbursementStats(reimbursements);
   * console.log(`Total: ${stats.total} remboursements`);
   * console.log(`Montant moyen: ${stats.amounts.average}€`);
   * console.log(`En retard: ${stats.amounts.overdue}€`);
   */
  calculateReimbursementStats(reimbursements, currentDate = new Date()) {
    const stats = {
      total: reimbursements.length,
      byStatus: {},
      byType: {},
      byUrgency: { critical: 0, urgent: 0, warning: 0, normal: 0, future: 0 },
      amounts: {
        total: 0,
        average: 0,
        min: Infinity,
        max: 0,
        overdue: 0
      },
      timeline: {}
    };

    for (const reimbursement of reimbursements) {
      // Statistiques par statut
      const status = reimbursement.globalStatus || 'UNKNOWN';
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Statistiques par type
      const type = reimbursement.type || 'UNKNOWN';
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      // Calcul urgence
      const dueDate = new Date(reimbursement.dueDate);
      const daysDiff = Math.ceil((dueDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
      const urgency = this.calculateUrgencyLevel(daysDiff);
      stats.byUrgency[urgency]++;

      // Statistiques montants
      const amount = reimbursement.amount || 0;
      stats.amounts.total += amount;
      stats.amounts.min = Math.min(stats.amounts.min, amount);
      stats.amounts.max = Math.max(stats.amounts.max, amount);
      
      if (daysDiff <= 0) {
        stats.amounts.overdue += amount;
      }

      // Timeline (par mois)
      const monthKey = dueDate.toISOString().substring(0, 7); // YYYY-MM
      stats.timeline[monthKey] = (stats.timeline[monthKey] || 0) + 1;
    }

    // Calculs finaux
    stats.amounts.average = stats.total > 0 ? Math.round(stats.amounts.total / stats.total) : 0;
    stats.amounts.min = stats.amounts.min === Infinity ? 0 : stats.amounts.min;

    return stats;
  }

  /**
   * Valide les données d'un remboursement
   * 
   * Vérifie que toutes les données obligatoires sont présentes
   * et dans le bon format pour éviter les erreurs de traitement.
   * 
   * @param {Reimbursement} reimbursement - Remboursement à valider
   * @returns {Array<string>} Liste des erreurs de validation (vide si valide)
   * 
   * @example
   * const errors = businessLogic.validateReimbursement(reimbursement);
   * if (errors.length > 0) {
   *   console.error('Erreurs de validation:', errors);
   * }
   */
  validateReimbursement(reimbursement) {
    const errors = [];

    if (!reimbursement.id) {
      errors.push('ID remboursement manquant');
    }

    if (!reimbursement.dueDate) {
      errors.push('Date d\'échéance manquante');
    } else {
      const dueDate = new Date(reimbursement.dueDate);
      if (isNaN(dueDate.getTime())) {
        errors.push('Date d\'échéance invalide');
      }
    }

    if (!reimbursement.type || !['SALARY', 'TREASURY'].includes(reimbursement.type)) {
      errors.push('Type de remboursement invalide (doit être SALARY ou TREASURY)');
    }

    if (!reimbursement.globalStatus || !['PENDING', 'OVERDUE', 'COMPLETED'].includes(reimbursement.globalStatus)) {
      errors.push('Statut global invalide');
    }

    if (reimbursement.amount !== undefined && (isNaN(reimbursement.amount) || reimbursement.amount < 0)) {
      errors.push('Montant invalide');
    }

    return errors;
  }

  /**
   * Filtre les remboursements selon des critères multiples
   * 
   * Applique plusieurs filtres simultanément pour affiner la sélection
   * de remboursements selon les besoins métier.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @param {Object} [filters={}] - Critères de filtrage
   * @param {Array<string>} [filters.types] - Types autorisés
   * @param {Array<string>} [filters.statuses] - Statuts autorisés
   * @param {number} [filters.minAmount] - Montant minimum
   * @param {number} [filters.maxAmount] - Montant maximum
   * @param {string} [filters.dueBefore] - Échéance avant cette date
   * @param {string} [filters.dueAfter] - Échéance après cette date
   * @param {Array<string>} [filters.healthCoverageIds] - IDs de couvertures santé
   * @returns {Array<Reimbursement>} Remboursements filtrés
   * 
   * @example
   * const filters = {
   *   types: ['SALARY'],
   *   statuses: ['PENDING', 'OVERDUE'],
   *   minAmount: 1000,
   *   dueBefore: '2025-03-01'
   * };
   * const filtered = businessLogic.filterReimbursements(reimbursements, filters);
   */
  filterReimbursements(reimbursements, filters = {}) {
    return reimbursements.filter(reimbursement => {
      // Filtre par type
      if (filters.types && !filters.types.includes(reimbursement.type)) {
        return false;
      }

      // Filtre par statut
      if (filters.statuses && !filters.statuses.includes(reimbursement.globalStatus)) {
        return false;
      }

      // Filtre par montant
      if (filters.minAmount && reimbursement.amount < filters.minAmount) {
        return false;
      }
      if (filters.maxAmount && reimbursement.amount > filters.maxAmount) {
        return false;
      }

      // Filtre par date
      if (filters.dueBefore) {
        const dueDate = new Date(reimbursement.dueDate);
        const filterDate = new Date(filters.dueBefore);
        if (dueDate > filterDate) {
          return false;
        }
      }

      if (filters.dueAfter) {
        const dueDate = new Date(reimbursement.dueDate);
        const filterDate = new Date(filters.dueAfter);
        if (dueDate < filterDate) {
          return false;
        }
      }

      // Filtre par health coverage
      if (filters.healthCoverageIds && !filters.healthCoverageIds.includes(reimbursement.healthCoverageId)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Trie les remboursements par priorité de traitement
   * 
   * Classe les remboursements en mettant en priorité ceux en retard
   * (les plus anciens en premier), puis par échéance croissante.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @param {Date} [currentDate=new Date()] - Date de référence
   * @returns {Array<Reimbursement>} Remboursements triés par priorité
   * 
   * @example
   * const sorted = businessLogic.sortReimbursementsByPriority(reimbursements);
   * console.log('Ordre de traitement:');
   * sorted.forEach((r, i) => console.log(`${i+1}. ${r.id} - ${r.dueDate}`));
   */
  sortReimbursementsByPriority(reimbursements, currentDate = new Date()) {
    return reimbursements.sort((a, b) => {
      const dueDateA = new Date(a.dueDate);
      const dueDateB = new Date(b.dueDate);
      
      const daysDiffA = Math.ceil((dueDateA.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysDiffB = Math.ceil((dueDateB.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

      // Priorité : en retard (plus ancien en premier), puis par échéance proche
      if (daysDiffA <= 0 && daysDiffB > 0) return -1;
      if (daysDiffA > 0 && daysDiffB <= 0) return 1;
      
      // Si tous les deux en retard ou tous les deux futurs
      if (daysDiffA <= 0 && daysDiffB <= 0) {
        return daysDiffA - daysDiffB; // Plus ancien en premier
      } else {
        return daysDiffA - daysDiffB; // Plus proche en premier
      }
    });
  }

  /**
   * Génère un résumé exécutif des remboursements
   * 
   * Crée un rapport de synthèse destiné à la direction avec les
   * informations clés et les recommandations d'actions.
   * 
   * @param {Array<Reimbursement>} reimbursements - Liste des remboursements
   * @param {Date} [currentDate=new Date()] - Date de référence
   * @returns {ExecutiveSummary} Résumé exécutif complet
   * 
   * @example
   * const summary = businessLogic.generateExecutiveSummary(reimbursements);
   * console.log(`Vue d'ensemble: ${summary.overview.totalReimbursements} remboursements`);
   * console.log(`Actions urgentes: ${summary.urgency.totalRequiringAttention}`);
   * summary.recommendations.forEach(r => console.log(`- ${r.message}`));
   */
  generateExecutiveSummary(reimbursements, currentDate = new Date()) {
    const stats = this.calculateReimbursementStats(reimbursements, currentDate);
    const analysis = this.analyzeReimbursementUrgency(reimbursements, currentDate);

    return {
      overview: {
        totalReimbursements: stats.total,
        totalAmount: stats.amounts.total,
        averageAmount: stats.amounts.average,
        overdueAmount: stats.amounts.overdue
      },
      urgency: {
        critical: analysis.critical.length,
        urgent: analysis.urgent.length,
        warning: analysis.warning.length,
        totalRequiringAttention: analysis.critical.length + analysis.urgent.length + analysis.warning.length
      },
      breakdown: stats.byType,
      recommendations: this.generateRecommendations(analysis, stats)
    };
  }

  /**
   * Génère des recommandations basées sur l'analyse
   * 
   * @private
   * @param {UrgencyAnalysis} analysis - Analyse d'urgence
   * @param {ReimbursementStats} stats - Statistiques des remboursements
   * @returns {Array<Object>} Liste des recommandations
   */
  generateRecommendations(analysis, stats) {
    const recommendations = [];

    if (analysis.critical.length > 0) {
      recommendations.push({
        priority: 'critical',
        message: `${analysis.critical.length} remboursements en retard critique (>7 jours) nécessitent une action immédiate`,
        action: 'Contacter les responsables et escalader si nécessaire'
      });
    }

    if (analysis.urgent.length > 0) {
      recommendations.push({
        priority: 'urgent',
        message: `${analysis.urgent.length} remboursements arrivent à échéance sous 2 jours`,
        action: 'Envoyer des rappels urgents'
      });
    }

    if (analysis.warning.length > 5) {
      recommendations.push({
        priority: 'warning',
        message: `${analysis.warning.length} remboursements nécessitent un suivi dans les 10 prochains jours`,
        action: 'Planifier des rappels préventifs'
      });
    }

    if (stats.amounts.overdue > 100000) {
      recommendations.push({
        priority: 'financial',
        message: `${stats.amounts.overdue}€ en remboursements en retard impactent la trésorerie`,
        action: 'Analyser l\'impact financier et prioriser les gros montants'
      });
    }

    return recommendations;
  }
}

module.exports = BusinessLogic;