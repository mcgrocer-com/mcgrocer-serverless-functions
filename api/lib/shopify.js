/**
 * Shopify GraphQL API utility functions
 */

const SHOPIFY_GRAPHQL_ENDPOINT = `https://${process.env.SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2024-10/graphql.json`;

/**
 * Make a request to Shopify GraphQL API
 * @param {string} query - GraphQL query string
 * @param {object} variables - GraphQL variables
 * @returns {Promise<object>} - API response data
 */
async function shopifyGraphqlRequest(query, variables = {}) {
  try {
    const response = await fetch(SHOPIFY_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    const data = await response.json();

    // Check for GraphQL errors
    if (data.errors) {
      throw new Error(`Shopify GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  } catch (error) {
    console.error('Shopify API Request Error:', error);
    throw error;
  }
}

/**
 * Query for all draft products with exactly 1000 total inventory
 * Filters by server-side inventory_total and verifies tracked inventory
 * Excludes products with "inventory not tracked" status
 * @returns {Promise<Array>} - Array of product objects
 */
async function getDraftProductsWithExactInventory() {
  const products = [];
  let hasNextPage = true;
  let cursor = null;

  // Paginate through all matching products (filtered server-side by Shopify)
  while (hasNextPage) {
    // Build query based on whether we're paginating or on first page
    const currentQuery = cursor
      ? `
        query($after: String) {
          products(first: 250, query: "status:DRAFT AND inventory_total:1000", after: $after) {
            edges {
              node {
                id
                title
                handle
                status
                totalInventory
                variants(first: 250) {
                  edges {
                    node {
                      id
                      inventoryItem {
                        tracked
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `
      : `
        query {
          products(first: 250, query: "status:DRAFT AND inventory_total:1000") {
            edges {
              node {
                id
                title
                handle
                status
                totalInventory
                variants(first: 250) {
                  edges {
                    node {
                      id
                      inventoryItem {
                        tracked
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

    const variables = cursor ? { after: cursor } : {};
    const result = await shopifyGraphqlRequest(currentQuery, variables);
    const productsData = result.products;

    // Filter products with exactly 1000 inventory AND tracked inventory
    productsData.edges.forEach((edge) => {
      const product = edge.node;

      // Verify total is exactly 1000
      if (product.totalInventory !== 1000) {
        console.warn(
          `⚠ Unexpected inventory for product ${product.id}: ${product.totalInventory} (expected 1000)`
        );
        return; // Skip this product
      }

      // Check if at least one variant has tracked inventory
      const variantEdges = product.variants?.edges || [];
      const hasTrackedInventory = variantEdges.some((variantEdge) => {
        const inventoryItem = variantEdge.node.inventoryItem;
        return inventoryItem && inventoryItem.tracked === true;
      });

      // Only include products with tracked inventory
      if (hasTrackedInventory) {
        products.push({
          id: product.id,
          title: product.title,
          handle: product.handle,
          totalInventory: product.totalInventory,
        });
      } else {
        console.log(
          `⊘ Skipped product with untracked inventory: ${product.title} (${product.id})`
        );
      }
    });

    hasNextPage = productsData.pageInfo.hasNextPage;
    cursor = productsData.pageInfo.endCursor;
  }

  return products;
}

/**
 * Get the publication ID for the Online Store
 * @returns {Promise<string>} - Publication ID for Online Store
 */
async function getOnlineStorePublicationId() {
  const query = `
    query {
      publications(first: 10) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;

  const data = await shopifyGraphqlRequest(query);
  const onlineStore = data.publications.edges.find(
    (edge) => edge.node.name === 'Online Store'
  );

  if (!onlineStore) {
    throw new Error('Online Store publication not found');
  }

  return onlineStore.node.id;
}

/**
 * Publish a product (set status to ACTIVE and make it visible)
 * @param {string} productId - Shopify product ID
 * @returns {Promise<object>} - Updated product data
 */
async function publishProduct(productId) {
  // Step 1: Update product status to ACTIVE
  const updateQuery = `
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
          status
          publishedAt
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateVariables = {
    input: {
      id: productId,
      status: 'ACTIVE',
    },
  };

  const updateData = await shopifyGraphqlRequest(updateQuery, updateVariables);

  if (updateData.productUpdate.userErrors && updateData.productUpdate.userErrors.length > 0) {
    throw new Error(
      `Failed to update product status: ${JSON.stringify(updateData.productUpdate.userErrors)}`
    );
  }

  const updatedProduct = updateData.productUpdate.product;

  // Step 2: Publish product to Online Store publication
  try {
    const publicationId = await getOnlineStorePublicationId();
    const publishQuery = `
      mutation($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            ... on Product {
              id
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const publishVariables = {
      id: productId,
      input: [
        {
          publicationId: publicationId,
        },
      ],
    };

    const publishData = await shopifyGraphqlRequest(publishQuery, publishVariables);

    if (
      publishData.publishablePublish.userErrors &&
      publishData.publishablePublish.userErrors.length > 0
    ) {
      throw new Error(
        `Failed to publish product to Online Store: ${JSON.stringify(
          publishData.publishablePublish.userErrors
        )}`
      );
    }

    console.log(`✓ Published to Online Store: ${updatedProduct.title} (${productId})`);
  } catch (error) {
    console.error(
      `⚠ Warning: Product status updated but failed to publish to Online Store: ${error.message}`
    );
    // Continue anyway - product is ACTIVE, just not visible yet
  }

  return updatedProduct;
}

/**
 * Batch publish multiple products with parallelization
 * @param {Array<string>} productIds - Array of Shopify product IDs
 * @returns {Promise<object>} - Results of the batch operation
 */
async function batchPublishProducts(productIds) {
  const results = {
    successful: [],
    failed: [],
  };

  const chunkSize = 10; // Process 10 products in parallel at a time

  // Process products in chunks to avoid overwhelming API rate limits
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);

    // Process all products in the chunk in parallel
    const promises = chunk.map(async (productId) => {
      try {
        const product = await publishProduct(productId);
        results.successful.push({
          id: productId,
          title: product.title,
          status: product.status,
        });
        console.log(`✓ Published product: ${product.title} (${productId})`);
        return { success: true, productId };
      } catch (error) {
        results.failed.push({
          id: productId,
          error: error.message,
        });
        console.error(`✗ Failed to publish product ${productId}:`, error.message);
        return { success: false, productId };
      }
    });

    // Wait for the entire chunk to complete before moving to the next one
    await Promise.all(promises);
  }

  return results;
}

/**
 * Query for ACTIVE products with untracked inventory variants
 * Fetches all ACTIVE products (up to 10 pages = 2500 products max)
 * Checks each variant client-side for tracked === false
 * Returns first 200 products that have at least one untracked variant
 * @returns {Promise<Array>} - Array of product objects with untracked inventory
 */
async function getActiveProductsWithUntrackedInventory() {
  const products = [];
  let productCount = 0;
  const maxProducts = 200;
  let pageCount = 0;
  const maxPages = 50; // Safety limit (250*50 = 12,500 products checked max - you said 5000+ untracked so this is safe)
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage && productCount < maxProducts && pageCount < maxPages) {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);
    const pageStartTime = Date.now();

    try {
      // Build query based on pagination
      // Query ALL ACTIVE products (untracked products can have any inventory level, not just 0)
      // We filter client-side for tracked:false variants
      const currentQuery = cursor
        ? `
          query($after: String) {
            products(first: 250, query: "status:ACTIVE", after: $after) {
              edges {
                node {
                  id
                  title
                  handle
                  status
                  totalInventory
                  variants(first: 250) {
                    edges {
                      node {
                        id
                        inventoryItem {
                          tracked
                        }
                      }
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `
        : `
          query {
            products(first: 250, query: "status:ACTIVE") {
              edges {
                node {
                  id
                  title
                  handle
                  status
                  totalInventory
                  variants(first: 250) {
                    edges {
                      node {
                        id
                        inventoryItem {
                          tracked
                        }
                      }
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

      const variables = cursor ? { after: cursor } : {};
      console.log(`  About to request GraphQL for page ${pageCount}...`);
      const result = await shopifyGraphqlRequest(currentQuery, variables);
      console.log(`  Received GraphQL response for page ${pageCount}`);
      const productsData = result.products;
      const pageEndTime = Date.now();
      console.log(`  Page ${pageCount} returned ${productsData.edges.length} products in ${pageEndTime - pageStartTime}ms`);

      // For each product, handle variant pagination if >250 variants
      for (const edge of productsData.edges) {
        if (productCount >= maxProducts) break;

        const product = edge.node;
        let allVariants = [...(product.variants?.edges || [])];
        let variantHasNext = product.variants?.pageInfo?.hasNextPage || false;
        let variantCursor = product.variants?.pageInfo?.endCursor || null;

        // Paginate variants if necessary (rare, but handles products with >250 variants)
        while (variantHasNext) {
          const variantQuery = `
            query($productId: ID!, $after: String) {
              product(id: $productId) {
                variants(first: 250, after: $after) {
                  edges {
                    node {
                      id
                      inventoryItem {
                        tracked
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          `;

          const variantVariables = { productId: product.id, after: variantCursor };
          const variantResult = await shopifyGraphqlRequest(variantQuery, variantVariables);
          const variantData = variantResult.product.variants;
          allVariants.push(...variantData.edges);
          variantHasNext = variantData.pageInfo.hasNextPage;
          variantCursor = variantData.pageInfo.endCursor;
        }

        // Check if at least one variant has untracked inventory
        // Handle three cases:
        // 1. inventoryItem exists with tracked === false (explicitly untracked)
        // 2. inventoryItem is null (implicitly untracked/not managed)
        const hasUntrackedInventory = allVariants.some((variantEdge) => {
          const inventoryItem = variantEdge.node.inventoryItem;
          // Count as untracked if: inventoryItem is null OR tracked is explicitly false
          const isUntracked = inventoryItem === null || (inventoryItem && inventoryItem.tracked === false);

          // Debug logging for first few products
          if (productCount < 3) {
            console.log(`    Variant ${variantEdge.node.id}: inventoryItem=${JSON.stringify(inventoryItem)}, isUntracked=${isUntracked}`);
          }

          return isUntracked;
        });

        // Only include products with untracked inventory (skip tracked out-of-stock)
        if (hasUntrackedInventory) {
          products.push({
            id: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            totalInventory: product.totalInventory,
          });
          productCount++;
          console.log(`  Found untracked product: ${product.title} (${product.id})`);
        } else if (productCount < 3) {
          console.log(`  Skipped (tracked): ${product.title} (${product.id})`);
        }
      }

      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

    } catch (error) {
      console.error(`Error on page ${pageCount}:`, error.message);
      throw error;
    }
  }

  console.log(`Query complete. Found ${products.length} products with untracked inventory after ${pageCount} pages`);
  return products;
}

/**
 * Revert a product to DRAFT status
 * @param {string} productId - Shopify product ID
 * @returns {Promise<object>} - Updated product data
 */
async function revertProductToDraft(productId) {
  const updateQuery = `
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateVariables = {
    input: {
      id: productId,
      status: 'DRAFT',
    },
  };

  const updateData = await shopifyGraphqlRequest(updateQuery, updateVariables);

  if (updateData.productUpdate.userErrors && updateData.productUpdate.userErrors.length > 0) {
    throw new Error(
      `Failed to revert product to draft: ${JSON.stringify(updateData.productUpdate.userErrors)}`
    );
  }

  return updateData.productUpdate.product;
}

/**
 * Batch revert multiple products to DRAFT status
 * @param {Array<string>} productIds - Array of Shopify product IDs
 * @returns {Promise<object>} - Results of the batch operation
 */
async function batchRevertProductsToDraft(productIds) {
  const results = {
    successful: [],
    failed: [],
  };

  const chunkSize = 10; // Process 10 products in parallel at a time

  // Process products in chunks to avoid overwhelming API rate limits
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);

    // Process all products in the chunk in parallel
    const promises = chunk.map(async (productId) => {
      try {
        const product = await revertProductToDraft(productId);
        results.successful.push({
          id: productId,
          title: product.title,
          status: product.status,
        });
        console.log(`✓ Reverted product to draft: ${product.title} (${productId})`);
        return { success: true, productId };
      } catch (error) {
        results.failed.push({
          id: productId,
          error: error.message,
        });
        console.error(`✗ Failed to revert product ${productId}:`, error.message);
        return { success: false, productId };
      }
    });

    // Wait for the entire chunk to complete before moving to the next one
    await Promise.all(promises);
  }

  return results;
}

module.exports = {
  shopifyGraphqlRequest,
  getDraftProductsWithExactInventory,
  publishProduct,
  batchPublishProducts,
  getActiveProductsWithUntrackedInventory,
  revertProductToDraft,
  batchRevertProductsToDraft,
};
