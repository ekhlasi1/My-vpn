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
 *
 * IMPORTANT: `wrangler d1 create` does NOT support `--json` on every wrangler
 * version (confirmed failing with "Unknown argument: json" on 4.43.0) — it
 * hard-errors before creating anything if you pass it. Only `d1 list`
 * reliably supports --json. Every command below is written with a plain-text
 * fallback parser in case --json isn't available at all.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const WRANGLER_TOML = 'wrangler.toml';
const SCHEMA_FILE = 'src/db/schema.sql';
const DB_NAME = 'bndmax-vpn-db';
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

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

/** Returns [{ name, uuid }] for every D1 database on the account, or null on total failure. */
function listDatabases() {
  const jsonAttempt = tryRun('npx wrangler d1 list --json');
  if (jsonAttempt.ok) {
    try {
      const dbs = JSON.parse(jsonAttempt.out);
      if (Array.isArray(dbs)) {
        return dbs.map((d) => ({ name: d.name, uuid: d.uuid || d.id }));
      }
    } catch {
      /* fall through to plain-text parsing below */
    }
  }

  // Plain-text fallback: parse the rendered table, matching any row that has
  // a UUID in it and taking the DB_NAME token as the name when present.
  const plain = tryRun('npx wrangler d1 list');
  if (!plain.ok) return null;
  const rows = [];
  const uuidRe = new RegExp(UUID_RE, 'g');
  for (const line of plain.out.split('\n')) {
    const idMatch = line.match(new RegExp(UUID_RE));
    if (!idMatch) continue;
    const nameMatch = line.match(/[\w-]{2,}/); // first word-ish token, often the name
    rows.push({ name: nameMatch ? nameMatch[0] : null, uuid: idMatch[0] });
  }
  return rows;
}

/** Creates the D1 database and returns its uuid, or null on failure. */
function createDatabase(name) {
  // Deliberately NOT passing --json here — see file header note.
  const create = tryRun(`npx wrangler d1 create ${name}`);
  if (create.ok) {
    const m = create.out.match(new RegExp(`database_id\\s*=\\s*"(${UUID_RE})"`));
    if (m) return m[1];
    // Some versions may still emit a bare uuid or JSON despite no --json; try those too.
    const bare = create.out.match(new RegExp(UUID_RE));
    if (bare) return bare[0];
    try {
      const parsed = JSON.parse(create.out);
      return parsed.uuid || parsed.database_id || parsed.id || null;
    } catch {
      return null;
    }
  }

  if (/already exists/i.test(create.out)) {
    const dbs = listDatabases();
    const existing = dbs && dbs.find((d) => d.name === name);
    return existing ? existing.uuid : null;
  }

  console.error(`[ci-setup] wrangler d1 create failed:\n${create.out}`);
  return null;
}

// -----------------------------------------------------------------------

if (!existsSync(WRANGLER_TOML)) {
  console.error(`[ci-setup] ${WRANGLER_TOML} not found — skipping (nothing to patch).`);
  process.exit(0);
}

let toml = readFileSync(WRANGLER_TOML, 'utf8');
const idMatch = toml.match(new RegExp(`database_id\\s*=\\s*"(${UUID_RE})"`));
let databaseId = idMatch ? idMatch[1] : null;

// --- Step 1: resolve (or create) the database id ---------------------------

if (databaseId) {
  log(`wrangler.toml already has a database_id (${databaseId}) — verifying it still exists...`);
  const dbs = listDatabases();
  if (dbs && !dbs.some((d) => d.uuid === databaseId)) {
    log('Configured database_id was not found on the account — will re-resolve it.');
    databaseId = null;
  }
}

if (!databaseId) {
  log(`Looking up D1 database "${DB_NAME}"...`);
  const dbs = listDatabases();
  const existing = dbs && dbs.find((d) => d.name === DB_NAME);
  if (existing) {
    databaseId = existing.uuid;
    log(`Found existing database, id: ${databaseId}`);
  } else {
    log(`Not found — creating D1 database "${DB_NAME}"...`);
    databaseId = createDatabase(DB_NAME);
    if (databaseId) log(`Created database, id: ${databaseId}`);
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
