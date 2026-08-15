# Project Structure

This document explains the directory structure and organization of the FoxCloud project.

## Root Directory

```
.
├── .github/                 # GitHub-specific files
│   ├── ISSUE_TEMPLATE/      # Issue templates
│   └── workflows/           # GitHub Actions workflows
├── dist/                    # Built output (generated)
├── docs/                    # Documentation files
├── scripts/                 # Utility scripts
├── src/                     # Source code
└── tests/                   # Test files
```

## Source Code Structure

### `src/constants/`

Contains constant definitions used throughout the application.

- `protocol.ts` - VLESS protocol constants and definitions

### `src/core/`

Core application logic and main entry points.

- `handler.ts` - Main request handler for HTTP and WebSocket requests
- `index.ts` - Core module exports
- `types.ts` - TypeScript type definitions

### `src/network/`

Network-related functionality and protocols.

- `dns.ts` - DNS resolution utilities
- `tcp.ts` - TCP connection utilities
- `websocket.ts` - WebSocket handling for proxy connections

### `src/pages/`

HTML page templates and UI components.

- `index.ts` - Main page templates (landing page, error page, subscription page)

### `src/protocols/`

Protocol-specific implementations (currently empty but reserved for future expansion).

- `index.ts` - Protocol module exports

### `src/services/`

Business logic and service layer components.

- `subscription.ts` - Subscription configuration generation

### `src/test/`

Test files for verifying application functionality.

- `architecture.test.js` - Architecture verification tests

### `src/utils/`

Utility functions and helper modules.

- `array.ts` - Array manipulation utilities
- `array.js` - JavaScript version for testing
- `helpers.ts` - General helper functions

## Configuration Files

### Root Configuration

- `package.json` - Node.js package configuration
- `package-lock.json` - Dependency lock file
- `tsconfig.json` - TypeScript configuration
- `eslint.config.mjs` - ESLint configuration
- `rolldown.config.js` - Build configuration
- `wrangler.toml` - Cloudflare Workers configuration
- `wrangler.example.toml` - Example configuration template

### GitHub Configuration

- `.github/ISSUE_TEMPLATE/` - GitHub issue templates
- `.github/PULL_REQUEST_TEMPLATE.md` - Pull request template
- `.github/workflows/` - GitHub Actions workflows

## Documentation

- `README.md` - Main project documentation
- `CONTRIBUTING.md` - Contribution guidelines
- `LICENSE` - License information
- `CHANGELOG.md` - Version history
- `CODE_OF_CONDUCT.md` - Community guidelines
- `SECURITY.md` - Security policy
- `docs/` - Detailed documentation files

## Assets

### Documentation Assets

- `docs/` - Documentation files
  - Images and diagrams for documentation

## Scripts

- `scripts/` - Utility scripts
  - `generate-uuid.js` - UUID generation utility

## Build Output

- `dist/` - Built output (generated during build process)
  - `worker.js` - Built Cloudflare Worker

## Test Output

- Generated during testing (no persistent test output directory)

## Development Files

- `.gitignore` - Git ignore patterns
- `.wrangler/` - Wrangler development cache (gitignored)

## Key Design Principles

### Modularity

The project is organized into modules by functionality:
- Each module has a single responsibility
- Modules are loosely coupled
- Clear separation between core logic and UI

### Separation of Concerns

- Business logic is separated from presentation
- Configuration is separated from code
- Tests are separated from source code

### Convention Over Configuration

- Standard directory structure
- Consistent naming conventions
- Predictable file organization

### Extensibility

- Protocol directory for future protocol support
- Services directory for business logic
- Utilities directory for reusable functions

This structure allows for easy navigation, maintenance, and extension of the FoxCloud project.