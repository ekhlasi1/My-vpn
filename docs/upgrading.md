# Upgrading FoxCloud

This guide explains how to upgrade your FoxCloud deployment to newer versions.

## Before You Upgrade

### Check Release Notes

Always check the [CHANGELOG.md](../CHANGELOG.md) for:
- Breaking changes
- New features
- Bug fixes
- Upgrade instructions

### Backup Configuration

Before upgrading, backup your:
- Environment variables (UUIDs, PROXY_IPs)
- Custom domain configurations
- Any custom modifications

## Upgrade Methods

### Method 1: Pre-built Worker (Recommended for Production)

1. Download the latest `worker.js` from [Releases](https://github.com/code3-dev/foxcloud/releases)
2. Redeploy to Cloudflare Workers:
   ```bash
   wrangler deploy worker.js
   ```
3. Verify functionality after deployment

### Method 2: Source Build

1. Pull the latest changes:
   ```bash
   git pull origin main
   ```
2. Install/update dependencies:
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

### Method 3: GitHub Actions

1. Pull the latest changes or merge upstream changes
2. Push to your repository to trigger automatic deployment
3. Monitor the deployment process in GitHub Actions

## Version-Specific Upgrade Notes

### Upgrading to 1.x.x from 0.x.x

Major version upgrades may include breaking changes. Always:

1. Read the migration guide in the release notes
2. Test in a staging environment first
3. Schedule upgrades during maintenance windows
4. Have a rollback plan ready

## Post-Upgrade Verification

### Functionality Testing

1. Test the main landing page
2. Verify subscription page generation
3. Test VLESS configuration generation
4. Confirm WebSocket connections work
5. Verify all configured UUIDs work

### Performance Monitoring

1. Monitor response times
2. Check for increased error rates
3. Verify resource usage is within expected limits
4. Confirm all proxy servers are accessible

### User Communication

If users might be affected:
1. Announce maintenance windows in advance
2. Communicate any breaking changes
3. Provide updated client configuration if needed
4. Offer support during the transition

## Rollback Procedure

If issues are discovered after upgrading:

### For Pre-built Worker

1. Download the previous version's `worker.js`
2. Redeploy the previous version:
   ```bash
   wrangler deploy worker.js
   ```

### For Source Build

1. Revert to the previous commit:
   ```bash
   git checkout v0.x.x  # Previous version tag
   ```
2. Rebuild and redeploy:
   ```bash
   npm run build
   npm run deploy
   ```

### For GitHub Actions

1. Revert the commit in your repository
2. Push to trigger redeployment of the previous version

## Troubleshooting Upgrade Issues

### Deployment Failures

1. Check Cloudflare credentials and permissions
2. Verify environment variables are still configured
3. Review build logs for errors
4. Check Cloudflare Worker limits

### Functionality Issues

1. Verify environment variables are correctly set
2. Check for breaking changes in the release notes
3. Review recent code modifications
4. Consult the documentation for updated configuration

### Performance Degradation

1. Compare with previous version performance
2. Check for new dependencies or code changes
3. Monitor Cloudflare Worker metrics
4. Verify proxy server performance

## Best Practices for Upgrades

### Testing Strategy

1. Always test in a staging environment first
2. Use a separate Worker for testing
3. Test with a subset of users if possible
4. Monitor closely after deployment

### Scheduling

1. Schedule upgrades during low-usage periods
2. Allow sufficient time for testing
3. Have team members available for issues
4. Plan for rollback if needed

### Communication

1. Notify users of maintenance windows
2. Document any user-facing changes
3. Provide updated documentation
4. Offer support channels for issues

By following this guide, you can ensure smooth upgrades of your FoxCloud deployment with minimal disruption to users.