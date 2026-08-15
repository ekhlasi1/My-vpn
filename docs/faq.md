# Frequently Asked Questions (FAQ)

This document answers common questions about FoxCloud.

## General Questions

### What is FoxCloud?

FoxCloud is a high-performance VLESS proxy server built for Cloudflare Workers. It provides secure and fast internet access through Cloudflare's global network, with a modern web interface for configuration management.

### Why use FoxCloud?

FoxCloud offers several advantages:
- **Global Performance**: Leverages Cloudflare's worldwide network for low latency
- **Easy Deployment**: Simple one-click deployment to Cloudflare Workers
- **Security**: Enterprise-grade encryption with TLS 1.3
- **Open Source**: Fully open-source with MIT license

### Is FoxCloud free to use?

Yes, FoxCloud is completely free and open-source under the MIT license. However, you may incur costs from Cloudflare depending on your usage of Cloudflare Workers.

## Technical Questions

### What protocols does FoxCloud support?

Currently, FoxCloud supports the VLESS protocol with WebSocket transport. Future versions may add support for additional protocols.

### What are the system requirements?

FoxCloud runs entirely on Cloudflare Workers, so there are no server requirements. For development and deployment, you need:
- Node.js 18 or higher
- Wrangler CLI
- A Cloudflare account

### How many users can FoxCloud support?

FoxCloud can support multiple users through the UUID system. Each user can have their own UUID, and there's no hard limit on the number of UUIDs you can configure.

### Can I use custom domains?

Yes, you can configure custom domains for your FoxCloud deployment through the Cloudflare Dashboard.

## Deployment Questions

### How do I deploy FoxCloud?

There are three main deployment methods:
1. Download pre-built worker.js from Releases
2. Build from source and deploy
3. Use GitHub Actions for CI/CD

See the [Deployment Guide](deployment.md) for detailed instructions.

### How do I configure environment variables?

Environment variables can be configured through:
- Wrangler CLI using `wrangler secret put`
- wrangler.toml file (not recommended for production)
- Cloudflare Dashboard

See the [Environment Variables Guide](environment-variables.md) for details.

### How do I update my FoxCloud deployment?

For pre-built deployments, download the new worker.js and redeploy. For source builds, pull the latest changes, rebuild, and redeploy. For GitHub Actions, push to your repository to trigger automatic deployment.

## Security Questions

### How secure is FoxCloud?

FoxCloud implements several security measures:
- VLESS protocol with strong encryption
- TLS 1.3 support
- UUID-based authentication
- Secure environment variable handling

### How do I generate secure UUIDs?

Use version 4 UUIDs for cryptographic security. See the [Environment Variables Guide](environment-variables.md) for generation methods.

### How often should I rotate UUIDs?

For maximum security, rotate UUIDs monthly or whenever a user leaves your organization.

## Troubleshooting Questions

### Why can't I connect to my proxy?

Common connection issues:
1. Incorrect UUID configuration
2. Unreachable proxy servers
3. Firewall blocking connections
4. Invalid SSL certificates on proxy servers

Check the logs and verify your configuration.

### Why is my deployment failing?

Common deployment issues:
1. Invalid Cloudflare credentials
2. Missing environment variables
3. Build process errors
4. Insufficient permissions

Check the deployment logs for specific error messages.

### How do I debug issues?

1. Check Cloudflare Worker logs
2. Verify environment variables are set correctly
3. Test proxy server connectivity
4. Review recent code changes

## Client Configuration Questions

### How do I configure my client?

1. Access your subscription page at `https://your-worker.your-subdomain.workers.dev/sub`
2. Copy the VLESS configuration URL
3. Import into your client
4. Connect to the proxy

See the [Subscription Guide](subscription-guide.md) for detailed instructions.

### Can I use QR codes?

Yes, the subscription page includes QR codes for easy mobile client setup.

## Performance Questions

### How fast is FoxCloud?

Performance depends on several factors:
- Proximity to Cloudflare data centers
- Proxy server performance
- Network conditions
- Client location

Cloudflare's global network typically provides low-latency connections.

### How much bandwidth can FoxCloud handle?

Cloudflare Workers have usage limits based on your plan. Check Cloudflare's documentation for specific limits.

### How can I improve performance?

1. Use proxy servers close to your users
2. Configure multiple proxy IPs for load balancing
3. Monitor and optimize proxy server performance
4. Use Cloudflare's performance features

## Development Questions

### How can I contribute to FoxCloud?

See the [Contributing Guide](../CONTRIBUTING.md) for information on how to contribute.

### How do I set up a development environment?

1. Clone the repository
2. Install dependencies with `npm install`
3. Start the development server with `npm run dev`

### How do I run tests?

Run tests with `npm test`. See the [Testing Guide](testing.md) for more information.

## Support Questions

### Where can I get help?

1. Check the documentation
2. Review existing GitHub issues
3. Create a new GitHub issue
4. Contact the maintainers

### How do I report bugs?

Create a GitHub issue with:
- Clear description of the problem
- Steps to reproduce
- Environment information
- Any relevant logs or screenshots

### How do I request features?

Create a GitHub issue describing:
- The feature you'd like
- The problem it solves
- How it would be used

## Legal Questions

### What license is FoxCloud released under?

FoxCloud is released under the MIT License. See the [LICENSE](../LICENSE) file for details.

### Can I use FoxCloud in commercial projects?

Yes, the MIT License allows use in commercial projects.

### Do you provide commercial support?

No, FoxCloud is community-supported open-source software. For commercial support, consider hiring a consultant or using commercial proxy services.