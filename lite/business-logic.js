/**
 * Business Logic - Logique métier pour les remboursements
 * 
 * Module contenant :
 * - Logique de traitement des remboursements Corporate et Coverage
 * - Calculs de dates et échéances
 * - Groupement et récupération des destinataires
 * - Règles métier spécialisées
 */

class BusinessLogic {
  constructor(service) {
    this.service = service;
    this.config = service.config;
  }

  /**
   * Traite un remboursement Corporate
   */
  async processCorporateReimbursement(reimbursement, currentDate) {
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
   * Traite les remboursements d'une health-coverage
   */
  async processCoverageReimbursements(healthCoverageId, reimbursements, currentDate) {
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
   * Récupère les destinataires pour un remboursement
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
   * Analyse et classe les remboursements par urgence
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
   * Calcule les statistiques des remboursements
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
   * Filtre les remboursements selon des critères
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
   * Trie les remboursements par priorité
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