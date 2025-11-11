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
 * Query for all draft products with exactly 1000 inventory stock
 * @returns {Promise<Array>} - Array of product objects
 */
async function getDraftProductsWithExactInventory() {
  const products = [];
  let hasNextPage = true;
  let cursor = null;

  // Paginate through all draft products
  while (hasNextPage) {
    // Build query based on whether we're paginating or on first page
    const currentQuery = cursor
      ? `
        query($after: String) {
          products(first: 250, query: "status:DRAFT", after: $after) {
            edges {
              node {
                id
                title
                handle
                status
                variants(first: 250) {
                  edges {
                    node {
                      id
                      inventoryQuantity
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
          products(first: 250, query: "status:DRAFT") {
            edges {
              node {
                id
                title
                handle
                status
                variants(first: 250) {
                  edges {
                    node {
                      id
                      inventoryQuantity
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

    // Filter products with exactly 1000 total inventory
    productsData.edges.forEach((edge) => {
      const product = edge.node;
      const totalInventory = product.variants.edges.reduce(
        (sum, variantEdge) => sum + (variantEdge.node.inventoryQuantity || 0),
        0
      );

      if (totalInventory === 1000) {
        products.push({
          id: product.id,
          title: product.title,
          handle: product.handle,
          totalInventory,
        });
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

module.exports = {
  shopifyGraphqlRequest,
  getDraftProductsWithExactInventory,
  publishProduct,
  batchPublishProducts,
};
