# Scripts

This directory contains utility scripts for BNDMAX VPN development and management.

## Available Scripts

### ci-setup.js

Runs automatically — you never call this by hand. It's wired into the
`[build]` command in `wrangler.toml`, so it runs on every `npm run deploy`
and on every push through Cloudflare Workers Builds, before the actual
build/deploy happens:

- Finds (or creates, on first run) the D1 database `bndmax-vpn-db` on your
  Cloudflare account.
- Writes its real `database_id` into `wrangler.toml`, which is what fixes
  the `binding DB of type d1 must have a valid database_id specified`
  deploy error.
- Applies `src/db/schema.sql` (safe to run every time — it only creates
  missing tables and seeds the initial admin password if one isn't set yet).

No manual `wrangler d1 create` and no manual copy/paste of an id into
`wrangler.toml` is ever needed.

### generate-uuid.js

Generates secure UUIDs for use with BNDMAX VPN.

**Usage:**
```bash
# Generate 1 UUID
npm run generate-uuid

# Generate 5 UUIDs
npm run generate-uuid 5
```

The script will output UUIDs in both individual and comma-separated formats for easy use in configuration files.