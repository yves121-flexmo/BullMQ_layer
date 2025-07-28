const mongoose = require('mongoose');

/**
 * Schéma pour les logs de jobs BullMQ
 */
const jobLogSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    index: true
  },
  queueName: {
    type: String,
    required: true,
    index: true
  },
  jobName: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    required: true,
    enum: ['started', 'completed', 'failed', 'progress', 'stalled'],
    index: true
  },
  startTime: {
    type: Date,
    index: true
  },
  endTime: Date,
  executionTime: {
    type: Number, // en millisecondes
    index: true
  },
  progress: Number,
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: Number,
  priority: {
    type: Number,
    default: 5
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  error: {
    message: String,
    stack: String,
    name: String
  },
  environment: {
    type: String,
    enum: ['development', 'production', 'test'],
    default: 'development'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'job_logs'
});

// Index composé pour les requêtes fréquentes
jobLogSchema.index({ queueName: 1, status: 1, timestamp: -1 });
jobLogSchema.index({ jobName: 1, status: 1, executionTime: -1 });
jobLogSchema.index({ timestamp: -1, status: 1 });

// Index TTL pour supprimer automatiquement les anciens logs (30 jours par défaut)
jobLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Méthodes statiques
jobLogSchema.statics.getPerformanceStats = function(days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return this.aggregate([
    { $match: { timestamp: { $gte: cutoffDate }, status: 'completed' } },
    {
      $group: {
        _id: '$jobName',
        totalJobs: { $sum: 1 },
        avgExecutionTime: { $avg: '$executionTime' },
        minExecutionTime: { $min: '$executionTime' },
        maxExecutionTime: { $max: '$executionTime' }
      }
    },
    { $sort: { avgExecutionTime: -1 } }
  ]);
};

jobLogSchema.statics.getErrorStats = function(days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return this.aggregate([
    { $match: { timestamp: { $gte: cutoffDate }, status: 'failed' } },
    {
      $group: {
        _id: '$error.message',
        count: { $sum: 1 },
        queues: { $addToSet: '$queueName' },
        jobTypes: { $addToSet: '$jobName' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);
};

jobLogSchema.statics.getQueueStats = function(queueName, days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return this.aggregate([
    { $match: { queueName, timestamp: { $gte: cutoffDate } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgExecutionTime: { 
          $avg: { 
            $cond: [{ $eq: ['$status', 'completed'] }, '$executionTime', null] 
          } 
        }
      }
    }
  ]);
};

// Méthodes d'instance
jobLogSchema.methods.getDuration = function() {
  if (this.startTime && this.endTime) {
    return this.endTime.getTime() - this.startTime.getTime();
  }
  return null;
};

jobLogSchema.methods.isSuccess = function() {
  return this.status === 'completed';
};

jobLogSchema.methods.isFailed = function() {
  return this.status === 'failed';
};

module.exports = mongoose.model('JobLog', jobLogSchema); 