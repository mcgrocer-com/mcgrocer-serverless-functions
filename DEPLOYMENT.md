# Deployment Guide

## Quick Deployment Checklist

Follow these steps to deploy your cron job to Vercel:

### Pre-Deployment

- [ ] **Shopify Private App Created**
  - ✓ App created in Shopify Admin
  - ✓ API credentials generated
  - ✓ Scopes enabled: `write_products`, `read_inventory`
  - ✓ Access token saved securely

- [ ] **Code Ready**
  - ✓ All files in place
  - ✓ `.env.example` completed
  - ✓ No sensitive data in code

### Deployment Steps

#### 1. Push Code to GitHub

```bash
# Add all files
git add .

# Commit
git commit -m "Initial setup: Shopify product auto-publisher cron job"

# Push to main branch
git push origin main
```

#### 2. Connect to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New Project**
3. Import your GitHub repository
4. Select the project name
5. Click **Import**

#### 3. Configure Environment Variables

1. After import, you'll see the **Configure Project** page
2. Scroll to **Environment Variables**
3. Add two variables:

   **Variable 1:**
   - **Name**: `SHOPIFY_STORE_NAME`
   - **Value**: Your store name (e.g., `mystore` from `mystore.myshopify.com`)
   - **Select Environments**: Production, Preview, Development

   **Variable 2:**
   - **Name**: `SHOPIFY_ACCESS_TOKEN`
   - **Value**: Your Shopify private app access token
   - **Select Environments**: Production, Preview, Development

4. Click **Deploy**

#### 4. Verify Deployment

1. Wait for deployment to complete (usually 1-2 minutes)
2. Check the **Deployments** page to see "Ready"
3. Open the deployment log to verify no errors

#### 5. Test the Cron Job

**Option A: Manual Trigger (Local)**
```bash
npm install -g vercel
vercel link  # Connect your local project to Vercel

# Then trigger the function
curl https://[your-deployment-url].vercel.app/api/crons/publish-draft-products
```

**Option B: View Logs in Vercel**
1. Go to your project in Vercel
2. Click **Deployments**
3. Select the latest deployment
4. Look for **Function** section
5. Click on `publish-draft-products` function
6. Check the **Logs** tab

### Post-Deployment

- [ ] **Verify Cron Schedule**
  - Check Vercel logs for execution messages
  - Verify it's running every 2 hours

- [ ] **Monitor First Run**
  - Check Shopify admin to confirm products are being published
  - Review execution logs for any errors

- [ ] **Set Up Monitoring** (Optional)
  - Vercel sends emails for failed deployments
  - Configure alerts in Vercel settings if needed

## Environment Variables in Vercel

### Where to Find Them

1. Project page → **Settings** → **Environment Variables**

### How to Update Them

1. Click on the variable
2. Click **Edit**
3. Update the value
4. Redeploy your project (or changes auto-apply)

### How to Create New Deployment After Env Changes

If you need to redeploy with new environment variables:

```bash
# Push a small change to trigger redeploy
git commit --allow-empty -m "Trigger redeploy"
git push origin main
```

Or redeploy manually from Vercel dashboard:
1. Go to **Deployments**
2. Find the latest deployment
3. Click the three dots **...**
4. Click **Redeploy**

## Troubleshooting Deployment

### Build Failed
- Check that `package.json` is in the root directory
- Verify all files are committed to git
- Check Vercel build logs for specific errors

### Environment Variables Not Working
- Verify they're set in the correct environment (Production)
- Redeploy after adding variables
- Check that variable names match exactly (case-sensitive)

### Cron Job Not Running
- Verify `vercel.json` is in the root with correct schedule
- Check deployment logs to see if function exists
- Wait for the next scheduled time (every 2 hours)
- Manual trigger: `curl https://[url]/api/crons/publish-draft-products`

### Authentication Errors
- Verify `SHOPIFY_STORE_NAME` is correct (without `.myshopify.com`)
- Verify `SHOPIFY_ACCESS_TOKEN` is the full token (not partial)
- Check that the token wasn't regenerated in Shopify (would invalidate old token)
- Check Shopify app scopes are enabled

## Rollback

If you need to revert to a previous version:

1. In Vercel **Deployments** page
2. Find the previous working deployment
3. Click the three dots **...**
4. Click **Promote to Production**

## Next Steps

- [ ] Monitor logs regularly
- [ ] Create backup cron jobs if needed
- [ ] Document any customizations
- [ ] Plan maintenance schedule

---

**Need help?** Check the main [README.md](./README.md) for more detailed documentation.
