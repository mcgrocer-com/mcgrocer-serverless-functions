
const {
  getDraftProductsBatch,
  batchPublishProducts,
} = require('../lib/shopify');

const PUBLISH_BATCH_SIZE = 5;
const MAX_BATCHES = 200;
const TIME_LIMIT_MS = 8000; // Stop processing before Vercel's 10s timeout

/**
 * Cron handler — processes draft products in small batches within a single
 * invocation, stopping before the timeout. Picks up remaining products
 * on the next cron run since published products drop out of the DRAFT query.
 */
async function handler(req, res) {
  const startTime = new Date();
  console.log(
    `[${startTime.toISOString()}] Starting cron job: Publish Draft Products`
  );

  try {
    if (!process.env.SHOPIFY_STORE_NAME) {
      throw new Error('Missing required environment variable: SHOPIFY_STORE_NAME');
    }

    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Missing required environment variable: SHOPIFY_ACCESS_TOKEN');
    }

    let totalPublished = 0;
    let totalFailed = 0;
    let batch = 0;

    while (batch < MAX_BATCHES) {
      const elapsed = Date.now() - startTime.getTime();
      if (elapsed > TIME_LIMIT_MS) {
        console.log(`Approaching timeout (${elapsed}ms). Stopping. Will continue on next run.`);
        break;
      }

      batch++;
      console.log(`--- Batch ${batch} ---`);

      const { products: draftProducts, hasMore } = await getDraftProductsBatch(PUBLISH_BATCH_SIZE);
      console.log(`Found ${draftProducts.length} qualifying product(s)`);

      if (draftProducts.length === 0) {
        console.log('No more qualifying products. All done.');
        break;
      }

      const productIds = draftProducts.map((p) => p.id);
      const results = await batchPublishProducts(productIds);

      totalPublished += results.successful.length;
      totalFailed += results.failed.length;

      console.log(`Batch ${batch}: Published ${results.successful.length} | Failed ${results.failed.length}`);

      if (!hasMore) {
        console.log('No more products to process.');
        break;
      }
    }

    const endTime = new Date();
    const duration = endTime - startTime;

    console.log(
      `[${endTime.toISOString()}] Cron job completed in ${duration}ms`
    );
    console.log(`Total published: ${totalPublished} | Total failed: ${totalFailed} | Batches: ${batch}`);

    return res.status(200).json({
      status: 'success',
      totalPublished,
      totalFailed,
      batches: batch,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;

    console.error(`[${endTime.toISOString()}] Cron job failed:`, error);

    return res.status(500).json({
      status: 'error',
      error: error.message,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  }
}

module.exports = handler;
