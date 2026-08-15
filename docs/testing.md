# FoxCloud Testing Guide

This document outlines the testing strategy and procedures for FoxCloud.

## Test Categories

### 1. Unit Tests

Located in `src/test/`, these tests verify individual components:

- Core handler functionality
- Subscription service generation
- Utility functions
- Network component helpers

### 2. Integration Tests

Tests that verify the interaction between components:

- End-to-end request handling
- WebSocket connection establishment
- Environment variable processing
- Configuration generation

### 3. Deployment Tests

Tests that verify the deployment process:

- Build process validation
- Environment variable injection
- Worker deployment success
- Runtime functionality

## Running Tests

### Unit Tests

```bash
npm run test
```

This runs the architecture tests which verify:
- Array utility functions
- Protocol constants
- Core component interactions

### Development Server Tests

```bash
npm run dev
# Then manually test functionality
```

## Test Scenarios

### Core Functionality

1. HTTP request handling
2. WebSocket upgrade requests
3. Subscription page generation
4. VLESS configuration generation
5. Error page rendering

### Environment Variables

1. UUID validation
2. PROXY_IP validation
3. Multiple UUID handling
4. Multiple PROXY_IP handling
5. Missing environment variables

### Network Components

1. WebSocket connection establishment
2. Data transfer through WebSocket
3. Proxy server connection
4. Error handling in network operations

### Web Interface

1. Main page rendering
2. Subscription page rendering
3. Dark/light mode functionality
4. Copy to clipboard functionality
5. Responsive design on different screen sizes

## Manual Testing Procedures

### Deployment Testing

1. Deploy using each method:
   - Pre-built worker.js
   - Source build and deploy
   - GitHub Actions deployment
2. Verify deployment success in Cloudflare Dashboard
3. Test access to main page
4. Test access to subscription page

### Configuration Testing

1. Set single UUID and verify subscription page
2. Set multiple UUIDs and verify subscription page
3. Set single PROXY_IP and verify configuration
4. Set multiple PROXY_IPs and verify configuration
5. Test with invalid UUIDs (should handle gracefully)
6. Test with invalid PROXY_IPs (should handle gracefully)

### Client Testing

1. Import VLESS configuration into V2Ray client
2. Connect through proxy and verify functionality
3. Test with different proxy IPs
4. Test with different UUIDs
5. Verify connection stability over time

### UI Testing

1. Test main page on desktop browser
2. Test main page on mobile browser
3. Test subscription page on desktop browser
4. Test subscription page on mobile browser
5. Verify dark mode functionality
6. Verify light mode functionality
7. Test copy button functionality
8. Verify all links are working

## Performance Testing

### Latency Tests

1. Measure response time for main page
2. Measure response time for subscription page
3. Measure WebSocket connection establishment time
4. Measure data transfer latency

### Load Tests

1. Simultaneous request handling
2. WebSocket connection limits
3. Memory usage under load
4. CPU usage under load

## Security Testing

### Authentication Tests

1. Valid UUID access
2. Invalid UUID rejection
3. UUID rotation testing
4. Access logging (if implemented)

### Data Security

1. TLS encryption verification
2. Data transfer integrity
3. No sensitive data leakage
4. Environment variable security

## Automated Testing

### Continuous Integration

GitHub Actions workflows include:

1. Build validation on each push
2. Deployment testing (when credentials are available)
3. Code quality checks

### Test Coverage

Aim for the following coverage targets:

- Unit tests: 80%+ coverage
- Integration tests: 70%+ coverage
- Critical path: 100% coverage

## Troubleshooting Test Failures

### Common Issues

1. **Environment variables not set**: Ensure all required variables are configured
2. **Network connectivity**: Verify proxy servers are accessible
3. **Build failures**: Check for TypeScript compilation errors
4. **Deployment errors**: Verify Cloudflare credentials and permissions

### Debugging Process

1. Check test logs for error messages
2. Reproduce issue manually
3. Isolate failing component
4. Verify environment setup
5. Check for external dependencies
6. Review recent code changes

## Test Data Management

### UUID Generation for Testing

Use the following command to generate test UUIDs:
```bash
# Linux/macOS
cat /proc/sys/kernel/random/uuid

# Windows PowerShell
New-Guid

# Node.js
node -e "console.log(require('crypto').randomUUID())"
```

### Proxy IPs for Testing

Use known working proxy servers for testing:
- Document which IPs are used for testing
- Verify IPs are accessible before testing
- Have fallback IPs for redundancy

## Test Environment Setup

### Local Development

1. Install dependencies: `npm install`
2. Set environment variables in `wrangler.toml` or using `wrangler secret put`
3. Start development server: `npm run dev`

### Staging Environment

1. Deploy to test subdomain
2. Configure test environment variables
3. Run full suite of tests
4. Verify functionality before production deployment

## Reporting Test Results

### Test Documentation

Maintain records of:

1. Test execution dates
2. Test environment configurations
3. Test results (pass/fail)
4. Performance metrics
5. Issues discovered and resolutions

### Issue Tracking

Report issues through:

1. GitHub Issues for code-related problems
2. Documentation updates for procedure improvements
3. Enhancement requests for new test scenarios

## Continuous Improvement

Regularly review and update:

1. Test procedures based on new features
2. Test coverage based on code changes
3. Performance benchmarks
4. Security testing procedures
5. Client compatibility testing