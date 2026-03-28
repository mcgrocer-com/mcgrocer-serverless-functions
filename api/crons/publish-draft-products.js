
const publishBatchHandler = require('../publish-batch');

/**
 * Vercel cron entry point (daily at midnight UTC).
 * Delegates to the shared batch publish handler.
 */
module.exports = publishBatchHandler;
