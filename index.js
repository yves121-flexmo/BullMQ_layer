/**
 * BullMQ Mail System - Point d'entrée principal
 * 
 * Système unifié pour la gestion des emails asynchrones avec BullMQ
 */

// Composants Core BullMQ
const MailManager = require('./core/MailManager');
const QueueManager = require('./core/QueueManager');
const WorkerManager = require('./core/WorkerManager');
const EventManager = require('./core/EventManager');
const FlowManager = require('./core/FlowManager');

// Services métier
const RemboursementMailService = require('./services/RemboursementMailService');

module.exports = {
  // Composants core
  MailManager,
  QueueManager,
  WorkerManager,
  EventManager,
  FlowManager,
  
  // Services métier
  RemboursementMailService,
  
  // Alias pour compatibilité
  RemboursementMailManager: RemboursementMailService, // Ancien nom
  
  // Utilitaires
  createMailManager: (config) => new MailManager(config),
  createRemboursementService: (config) => new RemboursementMailService(config)
}; 