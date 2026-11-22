# BNDMAX VPN Deployment Guide

This guide covers all available methods for deploying BNDMAX VPN to Cloudflare Workers.

## Prerequisites

Before deploying, ensure you have:

1. A Cloudflare account
2. A domain configured in Cloudflare
3. Wrangler CLI installed: `npm install -g wrangler`
4. Node.js 18 or higher

## Method 1: Download Pre-built Worker (Recommended for Quick Setup)

1. Download the latest `worker.js` from [Releases](https://github.com/ekhlasi1/My-vpn/releases)
2. Install Wrangler globally:
   ```bash
   npm install -g wrangler
   ```
3. Deploy to Cloudflare Workers:
   ```bash
   wrangler deploy worker.js
   ```
4. Configure environment variables as described in [Environment Variables Guide](environment-variables.md)

## Method 2: Build from Source (Recommended for Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/ekhlasi1/My-vpn.git
   cd bndmax-vpn
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```
   The D1 database is created (or reused) and its `database_id` is written
   into `wrangler.toml` automatically as part of the build — no manual
   `wrangler d1 create` or copy/paste is needed, whether you deploy locally
   or via Method 3 (Workers Builds) below.
5. Configure environment variables as described in [Environment Variables Guide](environment-variables.md)

## Method 3: GitHub Actions (Recommended for Production)

Fully automatic: no `wrangler d1 create`, no schema commands, no copying ids.
See also the Persian guide: [auto-setup-fa.md](auto-setup-fa.md).

1. Fork / push the repository to GitHub
2. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN`: token with **Workers Scripts: Edit** and **D1: Edit**
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id
3. Push to `main` / `master` (or run the workflow manually). `.github/workflows/deploy.yml`:
   - builds the project — `scripts/ci-setup.js` creates the D1 database if it
     does not exist, writes its id into `wrangler.toml`, applies the schema and migrations
   - deploys the Worker
   - calls `/health`, which creates any missing tables and confirms the database is ready
4. Optional: set a repository **variable** `WORKER_URL` (e.g. `https://vpn.example.com`)
   if you use a custom domain, so the health check knows where to look.

If the secrets are missing the workflow skips itself (so it never fights with
Cloudflare Workers Builds — use one of the two, not both).

### Setting Up Cloudflare Credentials

1. Create a Cloudflare API token:
   - Cloudflare Dashboard → My Profile → API Tokens → Create Token
   - Permissions: `Account → Workers Scripts → Edit` and `Account → D1 → Edit`
2. Get your Account ID:
   - Cloudflare Dashboard → Workers & Pages → the Account ID is shown in the sidebar
3. Add both as secrets in GitHub (Settings → Secrets and variables → Actions)

## Configuration After Deployment

After deploying, you need to configure environment variables:

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your deployed Worker
3. Go to Settings → Variables
4. Add the following variables:
   - `UUID`: Your user UUID(s)
   - `PROXY_IP`: Your proxy server IP(s)

## Custom Domain Setup

To use a custom domain:

1. In the Cloudflare Dashboard, go to your Worker
2. Navigate to "Settings" → "Triggers"
3. Under "Custom Domains", add your domain
4. Ensure your domain is configured in Cloudflare DNS

## Troubleshooting Deployment

### Common Issues

1. **Authentication errors**: Verify your Cloudflare API token has the correct permissions
2. **Build failures**: Ensure all dependencies are installed with `npm install`
3. **Deployment timeouts**: Check your internet connection and try again
4. **Environment variables not found**: Verify variables are set in the Cloudflare Dashboard

### Checking Deployment Status

1. View deployment logs in GitHub Actions (for CI/CD deployments)
2. Check Cloudflare Dashboard for deployment status
3. Test your deployment by visiting your Worker URL

## Updating Your Deployment

### For Pre-built Worker

1. Download the new `worker.js` from Releases
2. Redeploy using `wrangler deploy worker.js`

### For Source Builds

1. Pull the latest changes: `git pull`
2. Rebuild: `npm run build`
3. Redeploy: `npm run deploy`

### For GitHub Actions

1. Pull the latest changes or merge upstream changes
2. Push to your repository to trigger automatic deployment

## Rollback Procedure

If you need to rollback to a previous version:

1. Identify the previous working version
2. Either:
   - Download the previous release's `worker.js` and redeploy
   - Revert your repository to the previous commit and redeploy
   - Use Cloudflare's rollback feature in the dashboard

## Monitoring and Logs

Monitor your Worker performance through:

1. Cloudflare Dashboard → Workers & Pages → Your Worker → Analytics
2. Real-time logs with `wrangler tail`
3. Custom logging in your application code

For any deployment issues not covered in this guide, please check the [Issues](https://github.com/ekhlasi1/My-vpn/issues) section of the repository or create a new issue.