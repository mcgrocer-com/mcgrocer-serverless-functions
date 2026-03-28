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
 * Validate image URLs by sending HEAD requests in batches.
 * Only rejects products with HTTP 404/410 responses.
 * Treats network errors/timeouts as valid to avoid false positives.
 * @param {Array} products - Array of product objects with imageUrl
 * @param {number} timeoutMs - Timeout per image request in ms (default 2000)
 * @returns {Promise<Array>} - Products with reachable images
 */
async function validateImageUrls(products, timeoutMs = 2000) {
  if (products.length === 0) return products;

  console.log(`Validating image URLs for ${products.length} product(s)...`);
  const validProducts = [];
  const batchSize = 20;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (product) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          const response = await fetch(product.imageUrl, {
            method: 'HEAD',
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.status === 404 || response.status === 410) {
            console.log(
              `⊘ Skipped product with broken image (HTTP ${response.status}): ${product.title} (${product.id})`
            );
            return null;
          }

          return product;
        } catch (error) {
          console.warn(
            `⚠ Could not verify image for ${product.title} (${product.id}): ${error.message}`
          );
          // Treat network errors/timeouts as valid to avoid false positives
          return product;
        }
      })
    );

    validProducts.push(...results.filter(Boolean));
  }

  const skippedCount = products.length - validProducts.length;
  if (skippedCount > 0) {
    console.log(`Image validation complete: ${skippedCount} product(s) skipped due to broken images`);
  }

  return validProducts;
}

async function getDraftProductsWithExactInventory() {
  const products = [];
  let hasNextPage = true;
  let cursor = null;

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
                descriptionHtml
                featuredImage {
                  url
                }
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
                descriptionHtml
                featuredImage {
                  url
                }
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

    // Filter products with exactly 1000 inventory AND tracked inventory AND description
    productsData.edges.forEach((edge) => {
      const product = edge.node;

      // Verify total is exactly 1000
      if (product.totalInventory !== 1000) {
        console.warn(
          `⚠ Unexpected inventory for product ${product.id}: ${product.totalInventory} (expected 1000)`
        );
        return; // Skip this product
      }

      // Check if product has a description
      const hasDescription = product.descriptionHtml && product.descriptionHtml.trim().length > 0;
      if (!hasDescription) {
        console.log(
          `⊘ Skipped product with no description: ${product.title} (${product.id})`
        );
        return; // Skip this product
      }

      // Check if product has a featured image
      if (!product.featuredImage?.url) {
        console.log(
          `⊘ Skipped product with no image: ${product.title} (${product.id})`
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
          imageUrl: product.featuredImage.url,
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

  const validatedProducts = await validateImageUrls(products);
  return validatedProducts;
}

/**
 * Fetch a single page of draft products with exact inventory, apply filters,
 * and return a limited batch for publishing. Designed for use with self-chaining
 * to stay within Vercel Hobby plan's 10-second timeout.
 * @param {number} publishBatchSize - Max products to return for publishing (default 5)
 * @returns {Promise<{products: Array, hasMore: boolean}>}
 */
async function getDraftProductsBatch(publishBatchSize = 5, excludeIds = new Set()) {
  const query = `
    query {
      products(first: 250, query: "status:DRAFT AND inventory_total:1000") {
        edges {
          node {
            id
            title
            handle
            status
            totalInventory
            descriptionHtml
            featuredImage {
              url
            }
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
        }
      }
    }
  `;

  const result = await shopifyGraphqlRequest(query);
  const productsData = result.products;

  // Apply client-side filters
  const candidates = [];
  let skippedNoDesc = 0;
  let skippedNoImage = 0;
  let skippedUntracked = 0;
  let skippedExcluded = 0;

  for (const edge of productsData.edges) {
    const product = edge.node;

    if (excludeIds.has(product.id)) {
      skippedExcluded++;
      continue;
    }

    if (product.totalInventory !== 1000) {
      continue;
    }

    const hasDescription = product.descriptionHtml && product.descriptionHtml.trim().length > 0;
    if (!hasDescription) {
      skippedNoDesc++;
      continue;
    }

    if (!product.featuredImage?.url) {
      skippedNoImage++;
      continue;
    }

    const variantEdges = product.variants?.edges || [];
    const hasTrackedInventory = variantEdges.some((variantEdge) => {
      const inventoryItem = variantEdge.node.inventoryItem;
      return inventoryItem && inventoryItem.tracked === true;
    });

    if (!hasTrackedInventory) {
      skippedUntracked++;
      continue;
    }

    candidates.push({
      id: product.id,
      title: product.title,
      handle: product.handle,
      totalInventory: product.totalInventory,
      imageUrl: product.featuredImage.url,
    });

    // Stop collecting once we have enough candidates for image validation
    if (candidates.length >= publishBatchSize * 2) break;
  }

  console.log(`Filtered 250: ${skippedNoDesc} no desc, ${skippedNoImage} no image, ${skippedUntracked} untracked, ${skippedExcluded} already processed → ${candidates.length} candidates`);

  // Validate images only for our small candidate list
  const validatedProducts = await validateImageUrls(candidates);

  // Take only what we need for this batch
  const batch = validatedProducts.slice(0, publishBatchSize);

  // There are more products if the page has more results, or we found more valid candidates than we're publishing
  const hasMore = productsData.pageInfo.hasNextPage || validatedProducts.length > publishBatchSize;

  return { products: batch, hasMore: batch.length > 0 && hasMore };
}

/**
 * Get the publication ID for the Online Store (cached per process lifetime)
 * @returns {Promise<string>} - Publication ID for Online Store
 */
let _cachedPublicationId = null;

async function getOnlineStorePublicationId() {
  if (_cachedPublicationId) return _cachedPublicationId;

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

  _cachedPublicationId = onlineStore.node.id;
  return _cachedPublicationId;
}

/**
 * Publish a product (set status to ACTIVE and make it visible)
 * @param {string} productId - Shopify product ID
 * @returns {Promise<object>} - Updated product data
 */
async function publishProduct(productId) {
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
  const totalChunks = Math.ceil(productIds.length / chunkSize);

  // Process products in chunks to avoid overwhelming API rate limits
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunkIndex = Math.floor(i / chunkSize) + 1;
    const chunk = productIds.slice(i, i + chunkSize);
    const chunkStartCount = results.successful.length;

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

    // Log cycle summary
    const publishedThisCycle = results.successful.length - chunkStartCount;
    console.log(`[Cycle ${chunkIndex}/${totalChunks}] Published ${publishedThisCycle} product(s) this cycle | Total published: ${results.successful.length}/${productIds.length}`);
  }

  return results;
}

/**
 * Query for ACTIVE products with untracked inventory variants
 * Uses server-side filter: status:ACTIVE AND inventory_total:<=0 (candidates for untracked or out-of-stock)
 * Then checks client-side for inventoryItem.tracked === false (true untracked)
 * Gets the first 200 such products
 * @returns {Promise<Array>} - Array of product objects with untracked inventory
 */
async function getActiveProductsWithUntrackedInventory() {
  const products = [];
  let productCount = 0;
  const maxProducts = 200;
  let pageCount = 0;
  const maxPages = 10; // Safety limit (250*10 = 2500 checked max)
  let hasNextPage = true;
  let cursor = null;

  console.log('Fetching ACTIVE products with inventory_total:<=0 to check for tracked:false variants...');

  while (hasNextPage && productCount < maxProducts && pageCount < maxPages) {
    pageCount++;
    const pageStartTime = Date.now();

    try {
      const currentQuery = cursor
        ? `
          query($after: String) {
            products(first: 250, query: "status:ACTIVE AND inventory_total:<=0", after: $after) {
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
            products(first: 250, query: "status:ACTIVE AND inventory_total:<=0") {
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
      console.log(`  Requesting GraphQL for page ${pageCount}...`);
      const result = await shopifyGraphqlRequest(currentQuery, variables);
      console.log(`  Received GraphQL response for page ${pageCount}`);
      const productsData = result.products;
      const pageEndTime = Date.now();
      console.log(`  Page ${pageCount} returned ${productsData.edges.length} products in ${pageEndTime - pageStartTime}ms`);

      // For each product, handle variant pagination if >250 variants
      for (const edge of productsData.edges) {
        if (productCount >= maxProducts) break;

        const product = edge.node;
        let allVariants = [];
        let variantHasNext = product.variants?.pageInfo?.hasNextPage || false;
        let variantCursor = product.variants?.pageInfo?.endCursor || null;

        // Add initial variants from first page
        allVariants.push(...(product.variants?.edges || []));

        // Paginate variants if there are more
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

        // Check if at least one variant is untracked (tracked === false)
        const hasUntrackedInventory = allVariants.some((variantEdge) => {
          const inventoryItem = variantEdge.node.inventoryItem;
          return inventoryItem && inventoryItem.tracked === false;
        });

        // Only include true untracked products (skip tracked with 0 inventory)
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
        }
      }

      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

    } catch (error) {
      console.error(`Error on page ${pageCount}:`, error.message);
      throw error;
    }
  }

  console.log(`Query complete. Found ${products.length} untracked products after ${pageCount} pages`);
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
  getDraftProductsBatch,
  publishProduct,
  batchPublishProducts,
  getActiveProductsWithUntrackedInventory,
  revertProductToDraft,
  batchRevertProductsToDraft,
};
