# McGrocer Serverless Functions

Vercel serverless functions for McGrocer Shopify store automation.

## Features

- **Automated Product Publishing**: Cron job that runs every 12 hours
- **Smart Filtering**: Finds all DRAFT products with exactly 1000 inventory stock
- **Batch Publishing**: Publishes matching products to ACTIVE status
- **Error Handling**: Comprehensive logging and error reporting
- **Environment Configuration**: Easy setup with environment variables

## Project Structure

```
mcgrocer-serverless-functions/
├── api/
│   ├── crons/
│   │   └── publish-draft-products.js    # Main cron job handler
│   └── lib/
│       └── shopify.js                   # Shopify GraphQL utilities
├── vercel.json                          # Vercel configuration with cron schedule
├── package.json                         # Dependencies
├── .env.example                         # Example environment variables
└── README.md                            # This file
```

## Prerequisites

1. **Shopify Store**: An active Shopify store
2. **Vercel Account**: A Vercel account connected to this repository
3. **Node.js**: Version 18+ (for local development)

## Setup Instructions

### Step 1: Create a Shopify Private App

1. Go to your Shopify Admin Dashboard
2. Navigate to **Settings** → **Apps and integrations**
3. Click **Develop apps** (top right corner)
4. If prompted, enable private app development
5. Click **Create an app**
6. Name your app (e.g., "Product Auto-Publisher")
7. Click **Create app**

### Step 2: Configure API Credentials

1. In your app page, go to **Configuration** tab
2. Scroll to **Admin API access scopes**
3. Enable these scopes:
   - `write_products` - To update product status
   - `read_inventory` - To check inventory levels
4. Save and wait for confirmation

### Step 3: Generate Access Token

1. Click **Install app** at the top
2. Review and confirm the permissions
3. Go to the **API Credentials** tab
4. Copy your **Admin API access token**
   - **⚠️ Important**: Store this securely - you won't be able to see it again
5. Note your store name (from the URL: `https://[STORE_NAME].myshopify.com`)

### Step 4: Configure Environment Variables

1. Open your Shopify app's API Credentials tab and copy:
   - **Access token**: Your admin API access token
   - **Store name**: Your Shopify store name (without `.myshopify.com`)

2. In your Vercel project:
   - Go to **Settings** → **Environment Variables**
   - Add the following variables:
     - **Name**: `SHOPIFY_STORE_NAME`
       **Value**: Your store name (e.g., `mystore`)
     - **Name**: `SHOPIFY_ACCESS_TOKEN`
       **Value**: Your admin API access token
   - Make sure to add these to **Production** environment

### Step 5: Deploy to Vercel

1. Push your code to GitHub (or your git provider)
2. In Vercel:
   - Go to **Settings** → **Environment Variables** and verify they're set
   - The cron job will start running automatically after deployment
   - Check that the `vercel.json` file is present in your root

3. Verify deployment:
   - Go to **Deployments** and check that the latest deploy was successful
   - The cron should start running on the schedule (every 12 hours)

## How It Works

### Cron Schedule

The job runs on the schedule defined in `vercel.json`:
```json
"schedule": "0 */12 * * *"
```

This means:
- Every 12 hours
- At minute 0
- Example times: 12:00 AM, 12:00 PM, etc. (UTC)

### Execution Flow

1. **Query Phase**: The function queries all DRAFT products from Shopify
2. **Filter Phase**: Products are filtered to find those with exactly 1000 total inventory stock
3. **Publish Phase**: All matching products are set to ACTIVE status
4. **Response**: Returns a JSON report with success/failure details

### API Response

**Success Response (200)**:
```json
{
  "status": "success",
  "message": "Cron job completed successfully",
  "productsFound": 5,
  "productsPublished": 5,
  "productsFailed": 0,
  "successful": [
    {
      "id": "gid://shopify/Product/123456",
      "title": "Product Name",
      "status": "ACTIVE"
    }
  ],
  "failed": [],
  "duration": "1250ms",
  "timestamp": "2024-11-11T14:00:00.000Z"
}
```

**Error Response (500)**:
```json
{
  "status": "error",
  "message": "Cron job failed",
  "error": "Error message details",
  "duration": "450ms",
  "timestamp": "2024-11-11T14:00:00.000Z"
}
```

## Local Development

### Setup Local Environment

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file (copy from `.env.example`):
   ```bash
   cp .env.example .env.local
   ```

4. Add your Shopify credentials to `.env.local`

### Running Locally

To test the function locally:

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Run development server
npm run dev
```

The function will be available at: `http://localhost:3000/api/crons/publish-draft-products`

To trigger it manually, visit that URL in your browser or make a GET request:
```bash
curl http://localhost:3000/api/crons/publish-draft-products
```

## Monitoring and Logs

### View Cron Execution Logs

1. In Vercel Dashboard:
   - Go to your project
   - Click **Deployments**
   - Select the latest deployment
   - Click **View Function** next to `publish-draft-products`
   - Check the **Logs** tab to see execution history

### Check Execution Status

Each cron execution logs:
- Start and end times
- Number of products found
- Number successfully published
- Number that failed
- Any error messages

## Troubleshooting

### Function Not Running

- Check that environment variables are set in Vercel
- Verify the cron schedule in `vercel.json`
- Check function logs in Vercel dashboard
- Ensure the access token hasn't expired

### Authentication Errors

**Error**: `401 Unauthorized`
- Verify your access token is correct and not expired
- Check that the access token is in the correct Vercel environment
- Regenerate the token if needed in Shopify admin

### Product Update Failures

**Error**: `user errors` in response
- Check that your private app has `write_products` scope
- Verify product IDs are valid Shopify IDs
- Check Shopify's API documentation for specific error messages

### Missing Products

- Verify products are actually DRAFT status in Shopify
- Check that inventory is exactly 1000 (not 1001, not 999)
- Verify inventory is summed across all variants if product has multiple variants

## API Rate Limits

Shopify has rate limiting based on GraphQL query cost:
- Each request costs points based on fields queried
- The function uses pagination to handle large numbers of products
- If rate-limited, the job will retry on the next scheduled run

## Security Notes

- **Never commit `.env.local`** - Add it to `.gitignore`
- Keep your access token secret - it has write access to your products
- Use Shopify's private app access tokens (not OAuth tokens)
- Rotate your access token periodically
- Only enable the required API scopes

## Support and Debugging

For detailed logs and debugging:

1. **Check Vercel Logs**: Deployment → Function Logs
2. **Manual Testing**: Visit `/api/crons/publish-draft-products` directly
3. **Shopify API Errors**: Check response JSON for detailed error messages
4. **Contact Support**: Reach out with logs and error details

## License

MIT
