const { FlowProducer } = require('bullmq');

/**
 * FlowManager - Gestion des workflows complexes
 * 
 * Gère les workflows avec dépendances entre jobs en utilisant FlowProducer.
 * Permet de créer des chaînes de traitement complexes avec conditions.
 */
class FlowManager {
  constructor(config) {
    this.config = config;
    this.flowProducer = null;
    this.connection = config.redis;
    this.flows = new Map();
  }

  /**
   * Initialise le FlowManager
   */
  async initialize() {
    console.log('🌊 Initialisation du FlowManager...');
    
    this.flowProducer = new FlowProducer({
      connection: this.connection
    });

    // Gestion des erreurs
    this.flowProducer.on('error', (error) => {
      console.error('❌ Erreur FlowProducer:', error);
    });

    console.log('✅ FlowManager initialisé');
  }

  /**
   * Ajoute un flow avec dépendances
   */
  async addFlow(flowDefinition) {
    if (!this.flowProducer) {
      throw new Error('FlowManager non initialisé');
    }

    const flowId = flowDefinition.id || `flow-${Date.now()}`;
    
    try {
      const flow = await this.flowProducer.add(flowDefinition);
      this.flows.set(flowId, {
        definition: flowDefinition,
        flow,
        createdAt: new Date()
      });

      console.log(`🌊 Flow "${flowId}" ajouté avec ${this.countJobs(flowDefinition)} jobs`);
      return { flowId, flow };
    } catch (error) {
      console.error(`❌ Erreur ajout flow "${flowId}":`, error);
      throw error;
    }
  }

  /**
   * Compte le nombre total de jobs dans un flow
   */
  countJobs(flowDefinition) {
    let count = 1; // Le job principal
    if (flowDefinition.children) {
      count += flowDefinition.children.reduce((acc, child) => acc + this.countJobs(child), 0);
    }
    return count;
  }

  // Fonctions spécifiques aux emails déplacées vers managers/MailManager.js

  /**
   * Crée un flow conditionnel basé sur des critères
   */
  async createConditionalFlow(baseData, conditions) {
    const flowDefinition = {
      id: `conditional-flow-${Date.now()}`,
      name: 'conditional-workflow',
      queueName: 'conditional-processing',
      data: { ...baseData, type: 'conditional-flow' },
      children: [
        {
          name: 'evaluate-conditions',
          queueName: 'conditional-processing',
          data: { conditions, step: 'evaluation' },
          children: this.buildConditionalChildren(conditions)
        }
      ]
    };

    return await this.addFlow(flowDefinition);
  }

  /**
   * Construit les jobs enfants basés sur les conditions
   */
  buildConditionalChildren(conditions) {
    return conditions.map(condition => ({
      name: condition.action,
      queueName: condition.queueName || 'conditional-processing',
      data: {
        condition: condition.criteria,
        actionData: condition.data,
        step: 'conditional-action'
      }
    }));
  }

  /**
   * Crée un flow de retry intelligent
   */
  async createRetryFlow(originalJobData, maxRetries = 3) {
    const flowDefinition = {
      id: `retry-flow-${Date.now()}`,
      name: 'retry-workflow',
      queueName: 'retry-processing',
      data: { ...originalJobData, type: 'retry-flow', attempt: 1 },
      children: Array.from({ length: maxRetries }, (_, index) => ({
        name: 'retry-attempt',
        queueName: 'retry-processing',
        data: { 
          ...originalJobData, 
          attempt: index + 2,
          step: 'retry',
          delay: Math.pow(2, index) * 1000 // Exponential backoff
        },
        opts: {
          delay: Math.pow(2, index) * 1000
        }
      }))
    };

    return await this.addFlow(flowDefinition);
  }

  /**
   * Récupère l'état d'un flow
   */
  async getFlowState(flowId) {
    const flowInfo = this.flows.get(flowId);
    if (!flowInfo) {
      throw new Error(`Flow "${flowId}" non trouvé`);
    }

    try {
      // Récupération de l'état du flow principal
      const job = flowInfo.flow;
      const state = await job.getState();
      
      return {
        flowId,
        state,
        createdAt: flowInfo.createdAt,
        definition: flowInfo.definition,
        jobId: job.id
      };
    } catch (error) {
      console.error(`❌ Erreur récupération état flow "${flowId}":`, error);
      throw error;
    }
  }

  /**
   * Récupère les métriques de tous les flows
   */
  getFlowMetrics() {
    const metrics = {
      totalFlows: this.flows.size,
      flowsByType: {},
      oldestFlow: null,
      newestFlow: null
    };

    let oldest = null;
    let newest = null;

    for (const [flowId, flowInfo] of this.flows) {
      const type = flowInfo.definition.data?.type || 'unknown';
      metrics.flowsByType[type] = (metrics.flowsByType[type] || 0) + 1;

      if (!oldest || flowInfo.createdAt < oldest) {
        oldest = flowInfo.createdAt;
        metrics.oldestFlow = { flowId, createdAt: oldest };
      }

      if (!newest || flowInfo.createdAt > newest) {
        newest = flowInfo.createdAt;
        metrics.newestFlow = { flowId, createdAt: newest };
      }
    }

    return metrics;
  }

  /**
   * Nettoie les flows anciens
   */
  cleanOldFlows(olderThanMs = 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - olderThanMs);
    let cleaned = 0;

    for (const [flowId, flowInfo] of this.flows) {
      if (flowInfo.createdAt < cutoff) {
        this.flows.delete(flowId);
        cleaned++;
      }
    }

    console.log(`🧹 ${cleaned} flows anciens nettoyés`);
    return cleaned;
  }

  /**
   * Supprime un flow spécifique
   */
  removeFlow(flowId) {
    const removed = this.flows.delete(flowId);
    if (removed) {
      console.log(`🗑️  Flow "${flowId}" supprimé`);
    }
    return removed;
  }

  /**
   * Récupère la liste de tous les flows
   */
  getFlows() {
    return Object.fromEntries(this.flows);
  }

  /**
   * Crée des handlers pré-définis pour les flows
   */
  static createFlowHandlers() {
    return {
      // Handlers spécifiques aux emails déplacés vers managers/MailManager.js

      // Gestionnaire d'évaluation de conditions
      'evaluate-conditions': async (data, job) => {
        console.log(`🔍 Évaluation des conditions`);
        
        const { conditions } = data;
        const results = [];
        
        for (const condition of conditions) {
          // Simulation d'évaluation
          const result = Math.random() > 0.5;
          results.push({
            condition: condition.criteria,
            result,
            action: condition.action
          });
        }
        
        return { evaluations: results };
      },

      // Gestionnaire de tentative de retry
      'retry-attempt': async (data, job) => {
        console.log(`🔄 Tentative ${data.attempt} pour le job`);
        
        // Simulation d'un processus qui peut échouer
        const success = Math.random() > 0.3;
        
        if (!success) {
          throw new Error(`Tentative ${data.attempt} échouée`);
        }
        
        return { 
          success: true, 
          attempt: data.attempt,
          completedAt: new Date()
        };
      }
    };
  }

  /**
   * Ferme proprement le FlowManager
   */
  async shutdown() {
    console.log('🛑 Arrêt du FlowManager...');
    
    if (this.flowProducer) {
      await this.flowProducer.close();
    }
    
    this.flows.clear();
    console.log('✅ FlowManager arrêté proprement');
  }
}

module.exports = FlowManager; 