const {
  getActiveProductsWithUntrackedInventory,
  batchRevertProductsToDraft,
} = require('./lib/shopify');

/**
 * Handler for reverting ACTIVE products with untracked inventory back to DRAFT
 * Finds first 200 ACTIVE products with untracked inventory variants and reverts them
 */
async function handler(req, res) {
  const startTime = new Date();
  console.log(
    `[${startTime.toISOString()}] Starting: Revert ACTIVE products with untracked inventory to DRAFT`
  );

  try {
    // Validate environment variables
    if (!process.env.SHOPIFY_STORE_NAME) {
      throw new Error('Missing required environment variable: SHOPIFY_STORE_NAME');
    }

    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Missing required environment variable: SHOPIFY_ACCESS_TOKEN');
    }

    // Step 1: Query ALL ACTIVE products matching filter to get total count
    console.log('Step 1: Querying for ALL ACTIVE products matching filter...');
    const queryResults = await getActiveProductsWithUntrackedInventory();

    console.log(
      `TOTAL products matching filter: ${queryResults.totalMatching}`
    );
    console.log(
      `Will revert first ${queryResults.products.length} to DRAFT...`
    );

    if (queryResults.products.length === 0) {
      const endTime = new Date();
      const duration = endTime - startTime;

      return res.status(200).json({
        status: 'success',
        message: 'No ACTIVE products matching filter found',
        totalMatching: queryResults.totalMatching,
        productsToRevert: 0,
        productsReverted: 0,
        duration: `${duration}ms`,
        timestamp: startTime.toISOString(),
      });
    }

    // Step 2: Revert first 200 matching products to DRAFT
    console.log(
      `Step 2: Reverting ${queryResults.products.length} product(s) to DRAFT...`
    );
    const productIds = queryResults.products.map((p) => p.id);
    const results = await batchRevertProductsToDraft(productIds);

    const endTime = new Date();
    const duration = endTime - startTime;

    console.log(`[${endTime.toISOString()}] Operation completed in ${duration}ms`);
    console.log(`Successfully reverted: ${results.successful.length} product(s)`);
    console.log(`Failed: ${results.failed.length} product(s)`);

    // Return results
    return res.status(200).json({
      status: 'success',
      message: 'Products reverted to DRAFT successfully',
      totalMatching: queryResults.totalMatching,
      productsToRevert: queryResults.products.length,
      productsReverted: results.successful.length,
      productsFailed: results.failed.length,
      successful: results.successful,
      failed: results.failed,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  } catch (error) {
    const endTime = new Date();
    const duration = endTime - startTime;

    console.error(`[${endTime.toISOString()}] Operation failed:`, error);

    return res.status(500).json({
      status: 'error',
      message: 'Operation failed',
      error: error.message,
      duration: `${duration}ms`,
      timestamp: startTime.toISOString(),
    });
  }
}

// Export for Vercel
module.exports = handler;
