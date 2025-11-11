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
  const query = `
    query {
      products(first: 250, query: "status:DRAFT") {
        edges {
          node {
            id
            title
            handle
            status
            totalVariants
            variants(first: 250) {
              edges {
                node {
                  id
                  title
                  sku
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

  const data = await shopifyGraphqlRequest(query);
  const products = [];
  let hasNextPage = true;
  let cursor = null;

  // Paginate through all draft products
  while (hasNextPage) {
    const query = cursor
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
      : query;

    const result = await shopifyGraphqlRequest(query, cursor ? { after: cursor } : {});
    const productsData = result.products;

    // Filter products with exactly 1000 total inventory
    productsData.edges.forEach((edge) => {
      const product = edge.node;
      const totalInventory = product.variants.edges.reduce(
        (sum, variantEdge) => sum + variantEdge.node.inventoryQuantity,
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
 * Publish a product (set status to ACTIVE and make it visible)
 * @param {string} productId - Shopify product ID
 * @returns {Promise<object>} - Updated product data
 */
async function publishProduct(productId) {
  const query = `
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

  const variables = {
    input: {
      id: productId,
      status: 'ACTIVE',
    },
  };

  const data = await shopifyGraphqlRequest(query, variables);

  if (data.productUpdate.userErrors && data.productUpdate.userErrors.length > 0) {
    throw new Error(
      `Failed to update product: ${JSON.stringify(data.productUpdate.userErrors)}`
    );
  }

  return data.productUpdate.product;
}

/**
 * Batch publish multiple products
 * @param {Array<string>} productIds - Array of Shopify product IDs
 * @returns {Promise<object>} - Results of the batch operation
 */
async function batchPublishProducts(productIds) {
  const results = {
    successful: [],
    failed: [],
  };

  for (const productId of productIds) {
    try {
      const product = await publishProduct(productId);
      results.successful.push({
        id: productId,
        title: product.title,
        status: product.status,
      });
      console.log(`✓ Published product: ${product.title} (${productId})`);
    } catch (error) {
      results.failed.push({
        id: productId,
        error: error.message,
      });
      console.error(`✗ Failed to publish product ${productId}:`, error.message);
    }
  }

  return results;
}

module.exports = {
  shopifyGraphqlRequest,
  getDraftProductsWithExactInventory,
  publishProduct,
  batchPublishProducts,
};
