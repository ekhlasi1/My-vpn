# FoxCloud Subscription Guide

FoxCloud provides an easy-to-use subscription system for configuring VLESS clients.

## Accessing Your Subscription

After deploying FoxCloud, you can access your subscription configuration at:
```
https://your-worker.your-subdomain.workers.dev/sub
```

## Subscription Page Features

The subscription page provides:

1. **VLESS Configuration URL**: A ready-to-use VLESS URL for importing into clients
2. **Copy Button**: One-click copy to clipboard functionality
3. **Responsive Design**: Works on both desktop and mobile devices
4. **Dark/Light Mode**: Automatic theme detection with manual toggle

## Multiple UUID Support

FoxCloud supports multiple UUIDs for different users or devices:

1. Configure multiple UUIDs in your environment variables separated by commas:
   ```
   UUID = "uuid1,uuid2,uuid3"
   ```
2. Each UUID will generate its own subscription configuration
3. Access individual configurations at:
   ```
   https://your-worker.your-subdomain.workers.dev/uuid1
   https://your-worker.your-subdomain.workers.dev/uuid2
   https://your-worker.your-subdomain.workers.dev/uuid3
   ```

## Troubleshooting

### Configuration Not Working

1. Verify your UUID is correctly set in environment variables
2. Check that your PROXY_IP is correctly configured
3. Ensure your domain has a valid SSL certificate
4. Confirm your Cloudflare Worker is properly deployed

### Connection Issues

1. Check that your proxy server is running and accessible
2. Verify firewall settings on your proxy server
3. Ensure your proxy server supports WebSocket connections
4. Test with different proxy IPs if multiple are configured

## Security Recommendations

1. Generate secure UUIDs for each user
2. Regularly rotate UUIDs for enhanced security
3. Use strong, unique UUIDs (version 4 recommended)
4. Limit the number of UUIDs to only what's needed