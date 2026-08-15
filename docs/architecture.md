# FoxCloud Architecture

This document describes the architecture of FoxCloud, a VLESS proxy server built for Cloudflare Workers.

## Overview

FoxCloud is designed as a lightweight, high-performance proxy server that runs on Cloudflare's edge network. It leverages Cloudflare Workers' serverless architecture to provide global, low-latency access to proxy services.

## System Components

### 1. Core Handler (`src/core/handler.ts`)

The main request handler that processes incoming HTTP requests and WebSocket upgrade requests:

- Routes requests to appropriate handlers based on URL path
- Handles WebSocket upgrade requests for proxy connections
- Manages subscription requests for client configuration
- Provides error handling and fallback responses

### 2. Worker Entry Point (`src/worker.ts`)

The main entry point for the Cloudflare Worker:

- Exports the main fetch handler
- Receives incoming requests from Cloudflare's edge network
- Passes requests to the core handler with environment variables

### 3. Subscription Service (`src/services/subscription.ts`)

Generates VLESS configuration strings and objects:

- Creates VLESS URLs for client import
- Generates JSON configuration objects
- Supports multiple proxy server configurations

### 4. Web Interface (`src/pages/index.ts`)

Provides HTML interfaces for:

- Main landing page with system status
- Error pages for troubleshooting
- Subscription configuration page with copy functionality
- Responsive design with dark/light mode

### 5. Network Components

#### WebSocket Handler (`src/network/websocket.ts`)
- Manages WebSocket connections for proxy traffic
- Handles VLESS protocol negotiation
- Processes data transfer between client and proxy server

#### TCP Utilities (`src/network/tcp.ts`)
- Helper functions for TCP connection management
- Address parsing and validation

#### DNS Utilities (`src/network/dns.ts`)
- DNS resolution utilities for proxy targets

### 6. Utilities

#### Array Utilities (`src/utils/array.ts`)
- Helper functions for array manipulation
- String splitting and filtering

#### Helper Functions (`src/utils/helpers.ts`)
- General utility functions used throughout the application

## Data Flow

1. **Incoming Request**: Client sends HTTP request to Cloudflare Worker
2. **Request Routing**: Core handler determines request type:
   - WebSocket upgrade request → WebSocket handler
   - `/sub` path → Subscription page
   - UUID path → VLESS configuration response
   - Other paths → Main index page
3. **WebSocket Connection**: For proxy traffic:
   - Establishes WebSocket connection with client
   - Connects to configured proxy server
   - Transfers data bidirectionally
4. **Configuration Generation**: For subscription requests:
   - Generates VLESS configuration based on environment variables
   - Returns configuration as URL or JSON

## Environment Variables

The system uses two primary environment variables:

- `UUID`: User authentication identifiers
- `PROXY_IP`: Target proxy server addresses

These variables are injected by Cloudflare Workers at runtime and are accessible through the Env interface.

## Security Model

- **Authentication**: VLESS protocol with UUID-based authentication
- **Encryption**: TLS encryption for all connections
- **Isolation**: Each Worker instance is isolated and stateless
- **Rate Limiting**: Inherited from Cloudflare's infrastructure

## Scalability

- **Global Distribution**: Automatically deployed to Cloudflare's global network
- **Automatic Scaling**: Scales automatically with demand
- **Edge Computing**: Processing occurs at the edge, reducing latency

## Deployment Model

- **Serverless**: No dedicated servers to manage
- **Stateless**: No persistent storage in the Worker
- **Event-Driven**: Processes requests as they arrive
- **Multi-Tenant**: Can serve multiple users from a single deployment

## Limitations

- **Execution Time**: Limited by Cloudflare Workers' CPU time limits
- **Memory**: Constrained by Worker memory limits
- **Storage**: No persistent storage (configuration must be in environment variables)
- **Protocols**: Currently supports only VLESS over WebSocket

## Future Enhancements

- Additional protocol support (VMess, Trojan, etc.)
- Enhanced configuration options
- Improved analytics and monitoring
- Custom domain support improvements