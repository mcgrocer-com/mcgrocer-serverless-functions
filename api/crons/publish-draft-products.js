
const {
  getDraftProductsWithExactInventory,
  batchPublishProducts,
} = require('../lib/shopify');

/**
 * Main handler for the cron job
 */
async function handler(req, res) {
  const startTime = new Date();
  console.log(
    `[${startTime.toISOString()}] Starting cron job: Publish Draft Products`
  );

  try {
    // Validate environment variables
    if (!process.env.SHOPIFY_STORE_NAME) {
      throw new Error('Missing required environment variable: SHOPIFY_STORE_NAME');
    }

    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Missing required environment variable: SHOPIFY_ACCESS_TOKEN');
    }

    // Step 1: Find all draft products with exactly 1000 inventory
    console.log('Step 1: Querying for draft products with exactly 1000 inventory...');
    const draftProducts = await getDraftProductsWithExactInventory();
    console.log(`Found ${draftProducts.length} draft product(s) with 1000 inventory`);

    if (draftProducts.length === 0) {
      const endTime = new Date();
      const duration = endTime - startTime;

      return res.status(200).json({
        status: 'success',
        message: 'No draft products with 1000 inventory found',
        productsProcessed: 0,
        duration: `${duration}ms`,
        timestamp: startTime.toISOString(),
      });
    }

    // Step 2: Publish all matching products
    console.log(`Step 2: Publishing ${draftProducts.length} product(s)...`);
    const productIds = draftProducts.map((p) => p.id);
    const results = await batchPublishProducts(productIds);

    const endTime = new Date();
    const duration = endTime - startTime;

    console.log(
      `[${endTime.toISOString()}] Cron job completed in ${duration}ms`
    );
    console.log(`Successfully published: ${results.successful.length} product(s)`);
    console.log(`Failed: ${results.failed.length} product(s)`);

    // Return results
    return res.status(200).json({
      status: 'success',
      message: 'Cron job completed successfully',
      productsFound: draftProducts.length,
      productsPublished: results.successful.length,
      productsFailed: results.failed.length,
      successful: results.successful,
      failed: results.failed,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;

    console.error(`[${endTime.toISOString()}] Cron job failed:`, error);

    return res.status(500).json({
      status: 'error',
      message: 'Cron job failed',
      error: error.message,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  }
}

// Export for Vercel
module.exports = handler;
