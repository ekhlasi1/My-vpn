# Troubleshooting Guide

This document provides solutions to common issues encountered when using FoxCloud.

## Deployment Issues

### 1. Authentication Errors

**Problem**: Deployment fails with authentication errors.

**Solutions**:
1. Verify Cloudflare API token has correct permissions:
   - Workers Scripts: Edit permission
   - Account Settings: Read permission
2. Check that `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are correctly set
3. Ensure the token hasn't expired
4. Verify you're using the correct account ID

### 2. Build Failures

**Problem**: Build process fails with errors.

**Solutions**:
1. Ensure all dependencies are installed:
   ```bash
   npm install
   ```
2. Check for TypeScript compilation errors:
   ```bash
   npx tsc --noEmit
   ```
3. Verify Node.js version is 18 or higher
4. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

### 3. Environment Variable Issues

**Problem**: Application doesn't recognize environment variables.

**Solutions**:
1. Verify variables are set using the correct method:
   - For development: Check `wrangler.toml`
   - For production: Use `wrangler secret put`
2. Check for typos in variable names (case-sensitive)
3. Redeploy after setting variables
4. Verify variables are being passed to the handler function

## Runtime Issues

### 1. WebSocket Connection Failures

**Problem**: Clients cannot establish WebSocket connections.

**Solutions**:
1. Verify proxy servers support WebSocket connections
2. Check that proxy IPs and ports are correct
3. Ensure proxy servers are accessible from the internet
4. Verify SSL certificates on proxy servers
5. Check firewall settings on proxy servers

### 2. Subscription Page Not Working

**Problem**: Subscription page returns errors or blank content.

**Solutions**:
1. Verify UUID environment variable is set correctly
2. Check that UUIDs are valid version 4 UUIDs
3. Ensure PROXY_IP environment variable is set
4. Verify proxy IPs are accessible
5. Check Cloudflare Worker logs for errors

### 3. Configuration Generation Issues

**Problem**: Generated configurations don't work with clients.

**Solutions**:
1. Verify UUID in configuration matches environment variable
2. Check that proxy IP in configuration is correct
3. Ensure domain name matches your deployment
4. Verify TLS settings (SNI, fingerprint) are correct
5. Test with different client applications

## Client-Side Issues

### 1. Connection Timeouts

**Problem**: Clients time out when connecting.

**Solutions**:
1. Verify proxy server is running and accessible
2. Check network connectivity to proxy server
3. Verify firewall settings allow connections
4. Test proxy server with other tools (curl, ping)
5. Check for rate limiting on proxy server

### 2. Authentication Failures

**Problem**: Clients fail authentication with "invalid UUID" errors.

**Solutions**:
1. Verify UUID in client matches server configuration
2. Check for extra spaces or characters in UUID
3. Ensure UUID is properly formatted (8-4-4-4-12)
4. Verify UUID is active on the server
5. Generate a new UUID if needed

### 3. TLS/SSL Errors

**Problem**: Clients report SSL/TLS certificate errors.

**Solutions**:
1. Verify proxy server has valid SSL certificate
2. Check that SNI setting matches proxy domain
3. Verify client fingerprint settings match server
4. Update client to latest version
5. Try different TLS settings in client

## Performance Issues

### 1. Slow Connections

**Problem**: Proxy connections are slower than expected.

**Solutions**:
1. Choose proxy servers closer to users
2. Use multiple proxy IPs for load balancing
3. Monitor proxy server performance
4. Check for network congestion
5. Optimize proxy server configuration

### 2. High Latency

**Problem**: High latency in WebSocket connections.

**Solutions**:
1. Check Cloudflare Worker execution time limits
2. Optimize code for faster processing
3. Use proxy servers with better connectivity
4. Monitor network path for bottlenecks
5. Consider using Cloudflare's performance features

## UI Issues

### 1. Dashboard Not Loading

**Problem**: Web dashboard fails to load or displays errors.

**Solutions**:
1. Check Cloudflare Worker logs for errors
2. Verify HTML templates are correctly formatted
3. Test with different browsers
4. Check for Content Security Policy issues
5. Verify asset paths are correct

### 2. Theme Issues

**Problem**: Dark/light theme not working correctly.

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify CSS variables are correctly defined
3. Test with different browser versions
4. Clear browser cache and cookies
5. Check for conflicting browser extensions

## Development Issues

### 1. Development Server Issues

**Problem**: `npm run dev` fails or behaves unexpectedly.

**Solutions**:
1. Ensure Wrangler is properly installed:
   ```bash
   npm install -g wrangler
   ```
2. Check for port conflicts
3. Verify Node.js version compatibility
4. Clear Wrangler cache:
   ```bash
   wrangler dev --cleanup
   ```
5. Check for syntax errors in code

### 2. TypeScript Errors

**Problem**: TypeScript compilation fails with type errors.

**Solutions**:
1. Install Cloudflare Workers types:
   ```bash
   npm install --save-dev @cloudflare/workers-types
   ```
2. Verify tsconfig.json includes correct types
3. Check for missing type definitions
4. Update TypeScript to compatible version
5. Use type assertions where necessary

## Security Issues

### 1. Unauthorized Access

**Problem**: Suspicious activity or unauthorized access attempts.

**Solutions**:
1. Rotate UUIDs immediately
2. Implement access logging
3. Monitor connection patterns
4. Use rate limiting
5. Consider implementing IP whitelisting

### 2. Data Exposure

**Problem**: Concerns about sensitive data exposure.

**Solutions**:
1. Audit environment variable usage
2. Verify no sensitive data in logs
3. Check for proper error handling
4. Review HTML template security
5. Implement Content Security Policy

## GitHub Actions Issues

### 1. CI/CD Pipeline Failures

**Problem**: GitHub Actions workflows fail.

**Solutions**:
1. Verify repository secrets are correctly set
2. Check workflow file syntax
3. Ensure required permissions are granted
4. Review action versions for compatibility
5. Check Cloudflare service status

### 2. Deployment Failures

**Problem**: Automatic deployments fail.

**Solutions**:
1. Check Cloudflare API token permissions
2. Verify account limits and quotas
3. Review deployment logs for specific errors
4. Test manual deployment
5. Check for breaking changes in dependencies

## Monitoring and Logging

### 1. Missing Logs

**Problem**: Unable to access application logs.

**Solutions**:
1. Use Wrangler to tail logs:
   ```bash
   wrangler tail
   ```
2. Check Cloudflare Dashboard for logs
3. Implement custom logging in code
4. Verify log level settings
5. Check for log retention policies

### 2. Error Tracking

**Problem**: Difficulty tracking down errors.

**Solutions**:
1. Implement structured error handling
2. Add context to error messages
3. Use try/catch blocks appropriately
4. Log errors with sufficient detail
5. Consider using error tracking services

## Advanced Troubleshooting

### 1. Debugging with Console Logs

Add console.log statements to track execution flow:
```javascript
console.log('Debug: Variable value:', variable);
```

### 2. Using Wrangler Tools

```bash
# Tail logs in real-time
wrangler tail

# Test locally
wrangler dev

# Check current configuration
wrangler whoami
```

### 3. Network Debugging

```bash
# Test proxy server connectivity
curl -v https://your-proxy-server:port

# Check DNS resolution
nslookup your-proxy-server
```

## Getting Help

If you're unable to resolve an issue:

1. Check existing GitHub issues
2. Create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Error messages and logs
   - Environment information
   - What you've tried so far

3. Include relevant configuration (without sensitive data)
4. Provide screenshots if applicable
5. Tag the issue appropriately

By following this troubleshooting guide, you should be able to resolve most common issues with FoxCloud.