# Scripts

This directory contains utility scripts for BNDMAX VPN development and management.

## Available Scripts

### ci-setup.js

Runs automatically — you never call this by hand. It's wired into the
`build` npm script (`npm run build`), which both Cloudflare Workers Builds
and local `npm run deploy` (via the `predeploy` hook) always run as a
separate step *before* any `wrangler` process starts. That ordering matters:
Wrangler reads `wrangler.toml` into memory once at startup, so the database
id has to be correct on disk *before* Wrangler launches — patching it from
inside Wrangler's own build hook is too late.

On every run it:

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