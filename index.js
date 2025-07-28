/**
 * BullMQ System - Point d'entrée principal
 * 
 * Architecture organisée : Core BullMQ + Managers Métier + Services + Utils
 */

// === CORE BULLMQ (Réutilisable pour tout projet) ===
const BullMQManager = require('./core/BullMQManager');
const QueueManager = require('./core/QueueManager');
const WorkerManager = require('./core/WorkerManager');
const EventManager = require('./core/EventManager');
const FlowManager = require('./core/FlowManager');

// === MANAGERS MÉTIER (Spécialisés par domaine) ===
const MailManager = require('./managers/MailManager');

// === SERVICES (Logique applicative) ===
const RemboursementMailService = require('./services/RemboursementMailService');

// === UTILS (Transversaux) ===
const JobLogger = require('./utils/JobLogger');

module.exports = {
  // === Core BullMQ ===
  BullMQManager,
  QueueManager,
  WorkerManager,
  EventManager,
  FlowManager,
  
  // === Managers Métier ===
  MailManager,
  
  // === Services ===
  RemboursementMailService,
  
  // === Utils ===
  JobLogger,
  
  // === Alias de compatibilité ===
  RemboursementMailManager: RemboursementMailService, // Ancien nom
  
  // === Factory Methods ===
  createBullMQManager: (config) => new BullMQManager(config),
  createMailManager: (config) => new MailManager(config),
  createRemboursementService: (config) => new RemboursementMailService(config),
  createJobLogger: (config) => new JobLogger(config)
}; 