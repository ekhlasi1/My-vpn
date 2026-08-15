# FoxCloud API Documentation

This document describes the API endpoints provided by FoxCloud.

## Base URL

All endpoints are relative to your deployed Worker URL:
```
https://your-worker.your-subdomain.workers.dev
```

## Public Endpoints

### GET /

Returns the main landing page with system status information.

**Response:**
- Content-Type: text/html
- Status: 200 OK
- Body: HTML page with status information and links

### GET /sub

Returns the subscription configuration page for VLESS clients.

**Response:**
- Content-Type: text/html
- Status: 200 OK
- Body: HTML page with subscription configuration and copy functionality

### GET /{uuid}

Returns VLESS configuration for a specific UUID.

**Path Parameters:**
- uuid: A valid UUID configured in environment variables

**Response:**
- Content-Type: text/plain
- Status: 200 OK
- Body: VLESS configuration URL

**Example:**
```
GET /08dad8a6-8a6c-4424-9d63-62f3a9bf7f4f

Response:
vless://08dad8a6-8a6c-4424-9d63-62f3a9bf7f4f@your-domain.workers.dev:443?encryption=none&security=tls&sni=your-domain.workers.dev&fp=chrome&type=ws&host=your-domain.workers.dev&path=/ws
```

## WebSocket Endpoint

### GET /ws

Upgrades HTTP connection to WebSocket for proxy traffic.

**Query Parameters:**
- encoding: Data encoding method (optional)
- host: Target host (optional)

**Headers:**
- Upgrade: websocket
- Connection: Upgrade

**Response:**
- Status: 101 Switching Protocols
- Upgrade: websocket
- Connection: Upgrade

**WebSocket Communication:**
- Client sends VLESS handshake
- Server establishes connection to proxy server
- Bidirectional data transfer

## Error Responses

### 404 Not Found

Returned when accessing an unknown endpoint.

**Response:**
- Content-Type: text/html
- Status: 404 Not Found
- Body: Error page

### 500 Internal Server Error

Returned when an unexpected error occurs.

**Response:**
- Content-Type: text/html
- Status: 500 Internal Server Error
- Body: Error page

### 400 Bad Request

Returned when request parameters are invalid.

**Response:**
- Content-Type: text/html
- Status: 400 Bad Request
- Body: Error page

## Rate Limiting

FoxCloud inherits rate limiting from Cloudflare Workers:

- **Free Tier**: 100,000 requests per day
- **Paid Tier**: Up to 100 million requests per month

Exceeding these limits may result in:
- 429 Too Many Requests
- Temporary blocking
- Service degradation

## Security Considerations

### Authentication

- VLESS protocol uses UUID-based authentication
- Each UUID provides access to proxy services
- UUIDs should be kept secret and rotated regularly

### Encryption

- All connections use TLS 1.3 encryption
- WebSocket traffic is encrypted end-to-end
- No plaintext data is transmitted

### Access Control

- Access is controlled through environment variables
- Only configured UUIDs can access the service
- No user management interface is exposed

## CORS Policy

FoxCloud does not implement CORS headers as it's primarily designed for proxy traffic rather than web API usage.

## Content Types

### HTML Pages

- Main landing page
- Subscription configuration page
- Error pages

### Plain Text

- VLESS configuration URLs
- Error messages

### Binary Data

- WebSocket traffic (proxied data)

## WebSocket Protocol

### Connection Flow

1. Client connects to `/ws` endpoint with Upgrade header
2. Server validates request and upgrades to WebSocket
3. Client sends VLESS handshake
4. Server connects to configured proxy server
5. Bidirectional data transfer begins

### Data Format

- VLESS protocol specification compliant
- Binary data transfer
- No additional framing or encoding

### Connection Lifecycle

- Connections are maintained as long as data flows
- Idle connections may be closed by Cloudflare
- Error conditions result in connection termination

## Environment Variable Endpoints

Environment variables are not directly accessible via HTTP endpoints for security reasons. They are only available within the Worker runtime.

## Health Check Endpoint

Currently, there is no dedicated health check endpoint. The main page (`/`) can be used as a basic health check.

## Version Information

Version information is displayed on the main page and in the subscription page footer.

## Customization

The API endpoints are fixed and cannot be customized without modifying the source code. The following aspects can be customized through environment variables:

- UUIDs for authentication
- Proxy server addresses
- Worker name and configuration

## Integration Examples

### Client Integration

Clients integrate by:
1. Obtaining VLESS configuration from `/sub` or `/{uuid}` endpoint
2. Connecting to WebSocket endpoint `/ws`
3. Sending VLESS handshake
4. Transferring data through the proxy

### Monitoring Integration

Monitoring can be implemented by:
1. Making periodic requests to `/` endpoint
2. Checking response status codes
3. Parsing response content for status information

## API Evolution

As FoxCloud evolves, endpoints may be added or modified. Breaking changes will be documented in the changelog and version releases.

## Debugging

For debugging API issues:
1. Check Cloudflare Worker logs
2. Verify environment variables are set correctly
3. Test endpoints with curl or browser
4. Monitor response headers and status codes

## Example Usage

### Getting Subscription Configuration

```bash
curl https://your-worker.your-subdomain.workers.dev/sub
```

### Getting VLESS Configuration for UUID

```bash
curl https://your-worker.your-subdomain.workers.dev/08dad8a6-8a6c-4424-9d63-62f3a9bf7f4f
```

### Testing WebSocket Connection

WebSocket connections require a proper VLESS client implementation and cannot be easily tested with command-line tools.

This API documentation provides a complete reference for integrating with and using FoxCloud.