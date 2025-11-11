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

    // Step 1: Find all ACTIVE products matching filter (inventory_total:0 OR -inventory_total:*)
    console.log('Step 1: Querying for ACTIVE products with untracked inventory variants...');
    const queryResults = await getActiveProductsWithUntrackedInventory();
    console.log(
      `Total products matching filter: ${queryResults.totalFiltered}`
    );
    console.log(
      `Products with tracked===false: ${queryResults.untracked.length}`
    );

    if (queryResults.untracked.length === 0) {
      const endTime = new Date();
      const duration = endTime - startTime;

      return res.status(200).json({
        status: 'success',
        message: 'No ACTIVE products with untracked inventory found',
        totalFiltered: queryResults.totalFiltered,
        untrackedFound: 0,
        productsReverted: 0,
        duration: `${duration}ms`,
        timestamp: startTime.toISOString(),
      });
    }

    // Step 2: Take only first 200 untracked products (if there are more)
    const productsToRevert = queryResults.untracked.slice(0, 200);
    console.log(
      `Step 2: Reverting ${productsToRevert.length} product(s) to DRAFT (max 200)...`
    );
    const productIds = productsToRevert.map((p) => p.id);
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
      totalFiltered: queryResults.totalFiltered,
      untrackedFound: queryResults.untracked.length,
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
