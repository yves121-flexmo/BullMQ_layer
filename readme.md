# BullMQ Mail System - Architecture Unifiée

Ce projet fournit une **couche d'abstraction complète** au-dessus de BullMQ pour créer un système d'envoi de mails asynchrone robuste et scalable. L'architecture clarifie les concepts BullMQ et offre une interface simple pour gérer les queues, workers, événements et workflows.

## 🎯 Objectif

Simplifier l'utilisation de BullMQ en fournissant :
- Une interface unifiée pour tous les composants
- Une gestion automatique des schedulers et des événements  
- Des patterns prêts à l'emploi pour les cas d'usage courants
- Une architecture modulaire et extensible
- Une gestion robuste des erreurs et des retries

## 🏗️ Architecture

### Vue d'ensemble des composants

```
┌─────────────────┐
│   MailManager   │  ← Interface principale
└─────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Queue   │ │ Worker  │ │ Event   │ │ Flow    │
│Manager  │ │Manager  │ │Manager  │ │Manager  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

### 🔧 Composants Principaux

#### 1. **MailManager** (Interface principale)
- Point d'entrée unique pour toute l'application
- Unifie tous les autres managers
- Fournit des méthodes haut niveau simples
- Gère l'initialisation et l'arrêt propre

#### 2. **QueueManager** (Gestion des queues)
- Crée et gère toutes les queues BullMQ
- **Créé automatiquement un scheduler pour chaque queue**
- Gère les métriques et le nettoyage
- Operations : pause, resume, clean, obliterate

#### 3. **WorkerManager** (Gestion des workers)
- Démarre et gère tous les workers
- Route les jobs vers les bons handlers
- Gère la concurrence et les performances
- Fournit des handlers pré-définis pour les emails

#### 4. **EventManager** (Système d'événements)
- Centralise tous les événements BullMQ
- Listeners globaux et spécifiques par queue
- Monitoring et audit automatiques
- Alertes pour les échecs récurrents

#### 5. **FlowManager** (Workflows complexes)
- Gère les workflows avec dépendances
- Patterns pré-définis (email, newsletter, retry)
- Workflows conditionnels
- Métriques et état des flows

## 🚀 Installation

```bash
npm install bullmq ioredis dotenv
# S'assurer que Redis est installé et en cours d'exécution
brew install redis
brew services start redis
```

## 💡 Utilisation

### Exemple basique

```javascript
const MailManager = require('./core/MailManager');
const WorkerManager = require('./core/WorkerManager');

async function basicUsage() {
  // Configuration
  const mailManager = new MailManager({
    redis: { host: 'localhost', port: 6379 },
    defaultOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    }
  });

  // Initialisation
  await mailManager.initialize();

  // 1. Création d'une queue (avec scheduler automatique)
  mailManager.createQueue('emails');

  // 2. Démarrage d'un worker
  const handlers = WorkerManager.createEmailHandlers();
  mailManager.startWorker('emails', handlers, { concurrency: 5 });

  // 3. Ajout de jobs
  await mailManager.addJob('emails', 'send-welcome', {
    to: 'user@example.com',
    subject: 'Bienvenue !'
  });

  // 4. Planification récurrente
  await mailManager.scheduleJob(
    'emails', 
    'send-newsletter', 
    { to: 'subscribers@example.com' },
    '0 9 * * *' // Tous les jours à 9h
  );

  // 5. Monitoring
  mailManager.onEvent('emails', 'completed', (data) => {
    console.log(`Email envoyé: ${data.jobId}`);
  });

  // Nettoyage
  await mailManager.shutdown();
}
```

### Exemple avec workflows

```javascript
async function workflowUsage() {
  const mailManager = new MailManager({ redis: { host: 'localhost', port: 6379 } });
  await mailManager.initialize();

  mailManager.createQueue('email-processing');
  
  const handlers = {
    ...WorkerManager.createEmailHandlers(),
    ...FlowManager.createFlowHandlers()
  };
  
  mailManager.startWorker('email-processing', handlers);

  // Workflow d'email avec validation
  const emailFlow = await mailManager.addFlow({
    name: 'email-workflow',
    queueName: 'email-processing',
    data: { type: 'workflow' },
    children: [
      {
        name: 'validate-email',
        queueName: 'email-processing',
        data: { to: 'test@example.com' }
      },
      {
        name: 'prepare-template',
        queueName: 'email-processing',
        data: { template: 'welcome' },
        children: [
          {
            name: 'send-welcome',
            queueName: 'email-processing',
            data: { to: 'test@example.com' }
          }
        ]
      }
    ]
  });

  console.log('Workflow créé:', emailFlow.flowId);
}
```

## 📊 Clarification des Concepts BullMQ

| Concept | Rôle | Géré par | Automatique |
|---------|------|----------|-------------|
| **Queue** | Stocke les jobs | QueueManager | ✅ |
| **QueueScheduler** | Gère jobs delayed/recurring | QueueManager | ✅ Créé automatiquement |
| **Worker** | Traite les jobs | WorkerManager | Configuration requise |
| **QueueEvents** | Écoute les événements | EventManager | ✅ Créé à la demande |
| **FlowProducer** | Crée des workflows | FlowManager | ✅ |

### ❗ Points importants
- **Un scheduler par queue** : Automatiquement créé et géré
- **Events vs Workers** : Events = monitoring, Workers = traitement
- **Flow vs Queue** : Flow = workflow complexe, Queue = jobs simples

## 🔄 Patterns Disponibles

### Jobs simples
```javascript
await mailManager.addJob('emails', 'send-welcome', data);
```

### Jobs planifiés (avec scheduler automatique)
```javascript
await mailManager.scheduleJob('emails', 'send-newsletter', data, '0 9 * * *');
```

### Workflows avec dépendances
```javascript
await mailManager.addFlow(flowDefinition);
```

### Handlers d'emails pré-définis
- `send-welcome` : Email de bienvenue
- `send-newsletter` : Newsletter
- `send-reset-password` : Réinitialisation mot de passe
- `send-notification` : Notifications

### Flows pré-définis
- `createEmailFlow()` : Email avec validation
- `createNewsletterFlow()` : Newsletter multi-destinataires  
- `createConditionalFlow()` : Workflow conditionnel
- `createRetryFlow()` : Retry intelligent

## 📈 Monitoring et Métriques

```javascript
// État de santé global
const health = await mailManager.healthCheck();

// Statistiques d'une queue
const stats = await mailManager.getQueueStats('emails');

// Métriques complètes
const allMetrics = await mailManager.queueManager.getAllQueueMetrics();
const flowMetrics = mailManager.flowManager.getFlowMetrics();
const eventStats = mailManager.eventManager.getEventStats();

// Audit log
mailManager.eventManager.setupAuditListeners();
const auditLog = mailManager.eventManager.getAuditLog(100);
```

## 🛠️ Configuration Avancée

```javascript
const config = {
  redis: {
    host: 'localhost',
    port: 6379,
    // Ou utiliser une URL : url: 'redis://localhost:6379'
  },
  defaultOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
};

const mailManager = new MailManager(config);
```

## 🔍 Handlers Personnalisés

```javascript
const customHandlers = {
  'my-custom-job': async (data, job) => {
    console.log(`Traitement custom: ${data.id}`);
    
    // Mise à jour du progrès
    await job.updateProgress(50);
    
    // Logique métier
    const result = await processData(data);
    
    await job.updateProgress(100);
    return result;
  }
};

mailManager.startWorker('my-queue', customHandlers);
```

## 📁 Structure du Projet

```
bullMQ_examples/
├── core/                    # Architecture principale
│   ├── MailManager.js      # Interface unifiée
│   ├── QueueManager.js     # Gestion queues + schedulers
│   ├── WorkerManager.js    # Gestion workers + handlers
│   ├── EventManager.js     # Système d'événements
│   └── FlowManager.js      # Workflows complexes
├── examples/               # Exemples d'utilisation
│   └── basic-usage.js      # Exemples complets
├── scheduler.js            # Exemple de planification
└── main.js                 # Interface Bull Board
```

## 🧪 Tests et Exemples

```bash
# Exemple basique
node examples/basic-usage.js

# Scheduler
node scheduler.js

# Interface de monitoring
node main.js  # http://localhost:3000
```

## ⚡ Performances

- **Concurrence configurable** par worker
- **Nettoyage automatique** des anciens jobs
- **Retry exponentiel** intelligent
- **Monitoring des performances** intégré
- **Audit log** avec rotation automatique

## 🔐 Gestion d'Erreurs

- Retries automatiques avec backoff exponentiel
- Monitoring des échecs récurrents
- Alertes pour les jobs problématiques
- Isolation des erreurs par queue
- Logs détaillés pour le debug

## 📦 Migration depuis BullMQ Classique

```javascript
// Avant (BullMQ classique)
const { Queue, Worker, QueueScheduler } = require('bullmq');
const queue = new Queue('emails');
const scheduler = new QueueScheduler('emails');
const worker = new Worker('emails', processor);

// Après (Architecture unifiée)
const mailManager = new MailManager();
await mailManager.initialize();
mailManager.createQueue('emails');  // Scheduler créé automatiquement
mailManager.startWorker('emails', handlers);
```

## 🚀 Intégration dans une Application Existante

1. **Copier le dossier `core/`** dans votre projet
2. **Installer les dépendances** : `npm install bullmq ioredis`
3. **Initialiser MailManager** dans votre application
4. **Remplacer les appels BullMQ** par l'interface MailManager
5. **Configurer les handlers** pour vos types d'emails

## 📋 API Référence

### MailManager

```javascript
// Initialisation
await mailManager.initialize()
await mailManager.shutdown()

// Queues
mailManager.createQueue(name, options)
await mailManager.addJob(queueName, jobName, data, options)
await mailManager.scheduleJob(queueName, jobName, data, cronPattern, options)

// Workers
mailManager.startWorker(queueName, handlers, options)

// Flows
await mailManager.addFlow(flowDefinition)

// Events
mailManager.onEvent(queueName, eventType, callback)

// Monitoring
await mailManager.getQueueStats(queueName)
await mailManager.healthCheck()
```

## 📄 Licence

ISC

---

**💡 Cette architecture résout la confusion entre les concepts BullMQ en fournissant une interface claire et unifiée. Plus besoin de gérer manuellement schedulers, events et workers !**
