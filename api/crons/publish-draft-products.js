
const {
  getDraftProductsBatch,
  batchPublishProducts,
} = require('../lib/shopify');

const PUBLISH_BATCH_SIZE = 5;
const MAX_CHAINS = 200;

/**
 * Main handler for the cron job.
 * Processes a small batch of products per invocation and self-chains
 * to continue processing until all qualifying products are published.
 */
async function handler(req, res) {
  const startTime = new Date();
  const chain = parseInt(req.query?.chain || '0', 10);

  console.log(
    `[${startTime.toISOString()}] Publish Draft Products [chain ${chain}]`
  );

  // Safety limit to prevent infinite loops
  if (chain >= MAX_CHAINS) {
    console.log(`Reached max chain limit (${MAX_CHAINS}). Stopping.`);
    return res.status(200).json({
      status: 'success',
      message: `Reached max chain limit (${MAX_CHAINS}). Will continue on next cron run.`,
      chain,
    });
  }

  try {
    // Validate environment variables
    if (!process.env.SHOPIFY_STORE_NAME) {
      throw new Error('Missing required environment variable: SHOPIFY_STORE_NAME');
    }

    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Missing required environment variable: SHOPIFY_ACCESS_TOKEN');
    }

    // Step 1: Fetch one batch of qualifying draft products
    console.log(`Step 1: Fetching batch of draft products (max ${PUBLISH_BATCH_SIZE})...`);
    const { products: draftProducts, hasMore } = await getDraftProductsBatch(PUBLISH_BATCH_SIZE);
    console.log(`Found ${draftProducts.length} qualifying product(s) in this batch`);

    if (draftProducts.length === 0) {
      const endTime = new Date();
      const duration = endTime - startTime;
      console.log(`No more qualifying products. Done after ${chain} chains.`);

      return res.status(200).json({
        status: 'success',
        message: 'No qualifying draft products found. Processing complete.',
        chain,
        productsProcessed: 0,
        duration: `${duration}ms`,
        timestamp: startTime.toISOString(),
      });
    }

    // Step 2: Publish this batch
    console.log(`Step 2: Publishing ${draftProducts.length} product(s)...`);
    const productIds = draftProducts.map((p) => p.id);
    const results = await batchPublishProducts(productIds);

    const endTime = new Date();
    const duration = endTime - startTime;

    console.log(
      `[${endTime.toISOString()}] Chain ${chain} completed in ${duration}ms`
    );
    console.log(`Published: ${results.successful.length} | Failed: ${results.failed.length}`);

    // Step 3: Self-chain if there are more products to process
    if (hasMore) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : `http://${req.headers.host}`;
      const nextUrl = `${baseUrl}/api/crons/publish-draft-products?chain=${chain + 1}`;

      console.log(`Chaining to next batch: chain ${chain + 1}`);

      // Fire-and-forget — do NOT await the response
      fetch(nextUrl).catch((err) =>
        console.error(`Self-chain failed: ${err.message}`)
      );
    } else {
      console.log('No more products to process. Chain complete.');
    }

    return res.status(200).json({
      status: 'success',
      chain,
      productsPublished: results.successful.length,
      productsFailed: results.failed.length,
      successful: results.successful,
      failed: results.failed,
      hasMore,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;

    console.error(`[${endTime.toISOString()}] Chain ${chain} failed:`, error);

    return res.status(500).json({
      status: 'error',
      message: 'Cron job failed',
      chain,
      error: error.message,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  }
}

// Export for Vercel
module.exports = handler;
