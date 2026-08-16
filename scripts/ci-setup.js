#!/usr/bin/env node

/**
 * BNDMAX VPN — CI auto-provisioning (runs automatically on Cloudflare Workers Builds)
 *
 * This is what fixes the deploy error you saw in the Cloudflare build log:
 *   "binding DB of type d1 must have a valid `database_id` specified [code: 10021]"
 *
 * Cloudflare's build container is already authenticated to your account
 * (that's how the later `wrangler deploy` step works), so this script runs
 * as part of the [build] command, BEFORE `wrangler deploy`, and:
 *
 *   1. Looks for a D1 database named "bndmax-vpn-db" on the account.
 *      - If it doesn't exist yet, creates it.
 *      - If it already exists, reuses its id (idempotent — safe on every build).
 *   2. Patches wrangler.toml in the build container with the real database_id,
 *      so the deploy step that follows has a valid binding.
 *   3. Applies src/db/schema.sql to it (CREATE TABLE IF NOT EXISTS / INSERT OR
 *      IGNORE, so this is also safe to run on every single build).
 *
 * No manual `wrangler d1 create` and no manual copy/paste of an id is needed —
 * this runs on every push automatically.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const WRANGLER_TOML = 'wrangler.toml';
const SCHEMA_FILE = 'src/db/schema.sql';
const DB_NAME = 'bndmax-vpn-db';

function tryRun(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}

function log(msg) {
  console.log(`[ci-setup] ${msg}`);
}

if (!existsSync(WRANGLER_TOML)) {
  console.error(`[ci-setup] ${WRANGLER_TOML} not found — skipping (nothing to patch).`);
  process.exit(0);
}

let toml = readFileSync(WRANGLER_TOML, 'utf8');
const idMatch = /database_id\s*=\s*"([0-9a-fA-F-]{36})"/.exec(toml);
let databaseId = idMatch ? idMatch[1] : null;

// --- Step 1: resolve (or create) the database id ---------------------------

if (databaseId) {
  log(`wrangler.toml already has a database_id (${databaseId}) — verifying it still exists...`);
  const list = tryRun('npx wrangler d1 list --json');
  if (list.ok) {
    try {
      const dbs = JSON.parse(list.out);
      const stillExists = dbs.some((d) => (d.uuid || d.id) === databaseId);
      if (!stillExists) {
        log('Configured database_id was not found on the account — will re-resolve it.');
        databaseId = null;
      }
    } catch {
      // If we can't parse the list, trust the configured id and move on.
    }
  }
}

if (!databaseId) {
  log(`Looking up D1 database "${DB_NAME}"...`);
  const list = tryRun('npx wrangler d1 list --json');
  if (list.ok) {
    try {
      const dbs = JSON.parse(list.out);
      const existing = dbs.find((d) => d.name === DB_NAME);
      if (existing) databaseId = existing.uuid || existing.id;
    } catch {
      // fall through to create
    }
  }

  if (!databaseId) {
    log(`Not found — creating D1 database "${DB_NAME}"...`);
    const create = tryRun(`npx wrangler d1 create ${DB_NAME} --json`);
    if (create.ok) {
      try {
        const parsed = JSON.parse(create.out);
        databaseId = parsed.uuid || parsed.database_id || parsed.id;
      } catch {
        const m = /database_id\s*=\s*"([0-9a-fA-F-]{36})"/.exec(create.out);
        if (m) databaseId = m[1];
      }
    } else if (/already exists/i.test(create.out)) {
      const list2 = tryRun('npx wrangler d1 list --json');
      if (list2.ok) {
        try {
          const dbs = JSON.parse(list2.out);
          const existing = dbs.find((d) => d.name === DB_NAME);
          if (existing) databaseId = existing.uuid || existing.id;
        } catch {
          /* noop */
        }
      }
    } else {
      console.error(`[ci-setup] wrangler d1 create failed:\n${create.out}`);
    }
  }
}

if (!databaseId) {
  console.error('[ci-setup] Could not resolve a D1 database_id automatically.');
  console.error('[ci-setup] Falling back to the value already committed in wrangler.toml (deploy may fail if it is still a placeholder).');
  process.exit(0); // don't hard-fail the build; let wrangler deploy report the real error if any
}

log(`Using database_id: ${databaseId}`);

// --- Step 2: patch wrangler.toml in the build container --------------------

const patched = toml.match(/database_id\s*=\s*".*?"/)
  ? toml.replace(/database_id\s*=\s*".*?"/, `database_id = "${databaseId}"`)
  : toml; // (shouldn't happen given the project's wrangler.toml shape)

if (patched !== toml) {
  writeFileSync(WRANGLER_TOML, patched);
  log('wrangler.toml updated with the resolved database_id.');
  toml = patched;
}

// --- Step 3: apply schema (idempotent) --------------------------------------

if (existsSync(SCHEMA_FILE)) {
  log('Applying schema to the remote D1 database (idempotent)...');
  const apply = tryRun(`npx wrangler d1 execute ${DB_NAME} --remote --file=${SCHEMA_FILE}`);
  if (apply.ok) {
    log('Schema applied.');
  } else {
    console.error(`[ci-setup] Could not apply schema automatically:\n${apply.out}`);
  }
} else {
  log(`${SCHEMA_FILE} not found — skipping schema step.`);
}

log('Done — proceeding to build.');
