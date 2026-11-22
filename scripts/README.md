# Scripts

This directory contains utility scripts for BNDMAX VPN development and management.

## Available Scripts

### ci-setup.js

Runs automatically — you never call this by hand. It is wired into the
`build` npm script, which GitHub Actions, Cloudflare Workers Builds and local
`npm run deploy` all run *before* `wrangler` starts (Wrangler reads
`wrangler.toml` once at startup, so the database id must already be on disk).

On every run it:

- Finds the D1 database named in `wrangler.toml` (`bndmax-vpn-db`), or creates
  it on first run — through the Cloudflare REST API when `CLOUDFLARE_API_TOKEN`
  is set (account id auto-detected if the token sees one account), otherwise
  through your local `wrangler login` session.
- Writes the real `database_id` into `wrangler.toml` (build container only).
- Applies `src/db/schema.sql` and every `src/db/migration-v*.sql` (idempotent).

If the id cannot be resolved the build **fails in CI** with the exact fix
(token needs `D1: Edit`, set `CLOUDFLARE_ACCOUNT_ID`) instead of the cryptic
`binding DB of type d1 must have a valid database_id` error. Locally, without
credentials, it only warns.

The Worker also creates/upgrades its own tables on the first request
(`src/db/bootstrap.ts`), so a schema step that fails at build time is not fatal.

Switches: `CI_SETUP_SKIP=1` (skip, manage D1 yourself), `CI_SETUP_STRICT=0|1`
(force soft/hard failure; default hard only in CI).

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