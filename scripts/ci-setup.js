#!/usr/bin/env node

/**
 * BNDMAX VPN — zero-touch D1 provisioning (runs automatically on every build)
 *
 * Wired into `npm run build`, so it runs for:
 *   - Cloudflare Workers Builds (Git integration)
 *   - GitHub Actions (.github/workflows/deploy.yml)
 *   - local `npm run deploy`
 * and always BEFORE `wrangler deploy` parses wrangler.toml.
 *
 * What it does (idempotent — safe on every build):
 *   1. Finds the D1 database named in wrangler.toml (`database_name`) on the
 *      account, or creates it if it does not exist yet.
 *   2. Writes the real `database_id` into wrangler.toml (in the build
 *      container only — nothing is committed).
 *   3. Applies src/db/schema.sql and every src/db/migration-v*.sql.
 *
 * The Worker ALSO creates its tables by itself on the first request
 * (src/db/bootstrap.ts), so step 3 is a second safety net, not a single
 * point of failure. Step 1/2 is the one thing the Worker cannot do for
 * itself (a binding needs a real id before deploy), hence this script.
 *
 * Auth: CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) from the environment.
 * Without a token it falls back to the local `wrangler login` session.
 *
 * Failure policy: if the database id cannot be resolved and wrangler.toml
 * still holds the placeholder, the build FAILS (in CI) with an actionable
 * message, instead of continuing and dying later with the cryptic
 * "binding DB of type d1 must have a valid `database_id` [code: 10021]".
 *
 * Env switches:
 *   CI_SETUP_SKIP=1      skip everything (you manage D1 yourself)
 *   CI_SETUP_STRICT=0|1  force soft / hard failure (default: hard in CI only)
 *   CLOUDFLARE_API_BASE  override the REST base URL (used by tests)
 */

import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'

const WRANGLER_TOML = 'wrangler.toml'
const SCHEMA_FILE = 'src/db/schema.sql'
const DEFAULT_DB_NAME = 'bndmax-vpn-db'
const API_BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const IS_UUID = new RegExp(`^${UUID_RE}$`)

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || ''
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || ''

const IN_CI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.WORKERS_CI)
const STRICT =
  process.env.CI_SETUP_STRICT === '1' ? true : process.env.CI_SETUP_STRICT === '0' ? false : IN_CI

const log = (m) => console.log(`[ci-setup] ${m}`)
const warn = (m) => console.warn(`[ci-setup] WARNING: ${m}`)

function die(lines) {
  console.error('')
  console.error('[ci-setup] ERROR: could not prepare the D1 database.')
  for (const l of lines) console.error(`[ci-setup]   ${l}`)
  console.error('')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function run(args) {
  const r = spawnSync('npx', ['--yes', 'wrangler', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  })
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` }
}

async function cf(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.success === false) {
    const msg = json?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  return json.result
}

// ---------------------------------------------------------------------------
// resolve account + database through the REST API (token auth)
// ---------------------------------------------------------------------------

async function resolveAccount() {
  if (accountId) return accountId
  const accounts = await cf('GET', '/accounts?per_page=50')
  if (accounts.length === 1) {
    accountId = accounts[0].id
    log(`Account id auto-detected: ${accountId}`)
    return accountId
  }
  throw new Error(
    accounts.length === 0
      ? 'the API token cannot see any account — set CLOUDFLARE_ACCOUNT_ID'
      : `the token can see ${accounts.length} accounts — set CLOUDFLARE_ACCOUNT_ID to choose one`,
  )
}

async function listViaApi() {
  const acc = await resolveAccount()
  const all = []
  for (let page = 1; page <= 20; page++) {
    const chunk = await cf('GET', `/accounts/${acc}/d1/database?per_page=100&page=${page}`)
    all.push(...chunk.map((d) => ({ name: d.name, uuid: d.uuid || d.id })))
    if (chunk.length < 100) break
  }
  return all
}

async function createViaApi(name) {
  const acc = await resolveAccount()
  try {
    const db = await cf('POST', `/accounts/${acc}/d1/database`, { name })
    return db.uuid || db.id
  } catch (err) {
    // Lost a race with a parallel build — it exists now, so just reuse it.
    const existing = (await listViaApi()).find((d) => d.name === name)
    if (existing) return existing.uuid
    throw err
  }
}

// ---------------------------------------------------------------------------
// same thing through wrangler (local `wrangler login` session, no token)
// ---------------------------------------------------------------------------

function listViaWrangler() {
  const j = run(['d1', 'list', '--json'])
  if (j.ok) {
    try {
      const dbs = JSON.parse(j.out.slice(j.out.indexOf('[')))
      if (Array.isArray(dbs)) return dbs.map((d) => ({ name: d.name, uuid: d.uuid || d.id }))
    } catch {
      /* fall through to the text parser */
    }
  }
  const plain = run(['d1', 'list'])
  if (!plain.ok) throw new Error(plain.out.trim().split('\n').slice(-3).join(' | ') || 'wrangler d1 list failed')
  const rows = []
  for (const line of plain.out.split('\n')) {
    const id = line.match(new RegExp(UUID_RE))
    if (!id) continue
    const cells = line.split(/[│|]/).map((c) => c.trim()).filter(Boolean)
    const name = cells.find((c) => !new RegExp(UUID_RE).test(c) && /^[\w-]{2,}$/.test(c))
    rows.push({ name: name || null, uuid: id[0] })
  }
  return rows
}

function createViaWrangler(name) {
  // Deliberately without --json: not supported by every wrangler version.
  const c = run(['d1', 'create', name])
  if (c.ok) {
    const m = c.out.match(new RegExp(`database_id"?\\s*[=:]\\s*"(${UUID_RE})"`)) || c.out.match(new RegExp(UUID_RE))
    if (m) return m[1] || m[0]
  }
  if (/already exists/i.test(c.out)) {
    const e = listViaWrangler().find((d) => d.name === name)
    if (e) return e.uuid
  }
  throw new Error(c.out.trim().split('\n').slice(-3).join(' | ') || 'wrangler d1 create failed')
}

const listDatabases = () => (TOKEN ? listViaApi() : listViaWrangler())
const createDatabase = (name) => (TOKEN ? createViaApi(name) : Promise.resolve(createViaWrangler(name)))

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.CI_SETUP_SKIP === '1') return log('CI_SETUP_SKIP=1 — skipping D1 provisioning.')
  if (!existsSync(WRANGLER_TOML)) return log(`${WRANGLER_TOML} not found — nothing to do.`)

  let toml = readFileSync(WRANGLER_TOML, 'utf8')
  if (!/\[\[d1_databases\]\]/.test(toml)) return log('No [[d1_databases]] binding in wrangler.toml — nothing to do.')

  const dbName = (toml.match(/database_name\s*=\s*"([^"]+)"/) || [])[1] || DEFAULT_DB_NAME
  const currentId = (toml.match(/database_id\s*=\s*"([^"]*)"/) || [])[1] || ''
  let databaseId = IS_UUID.test(currentId) ? currentId : null

  const haveAuth = Boolean(TOKEN) || existsSync(`${process.env.HOME || ''}/.wrangler`) || IN_CI
  let dbs = null
  let apiError = null

  try {
    dbs = await listDatabases()
  } catch (err) {
    apiError = err
  }

  if (dbs) {
    if (databaseId && !dbs.some((d) => d.uuid === databaseId)) {
      log(`database_id ${databaseId} is not on this account — re-resolving by name.`)
      databaseId = null
    }
    if (!databaseId) {
      const found = dbs.find((d) => d.name === dbName)
      if (found) {
        databaseId = found.uuid
        log(`Found existing database "${dbName}" (${databaseId}) — reusing it.`)
      } else {
        log(`Database "${dbName}" does not exist yet — creating it...`)
        try {
          databaseId = await createDatabase(dbName)
          log(`Created database "${dbName}" (${databaseId}).`)
        } catch (err) {
          apiError = err
        }
      }
    }
  }

  if (!databaseId) {
    const reason = apiError ? apiError.message : 'unknown reason'
    const text = [
      `Reason: ${reason}`,
      '',
      'Fix (one time only):',
      '  1. Cloudflare dashboard -> My Profile -> API Tokens -> edit your token and make sure it has:',
      '       Account > D1 > Edit      and      Account > Workers Scripts > Edit',
      '  2. Make sure CLOUDFLARE_ACCOUNT_ID is set (Workers Builds: Settings -> Build -> Variables;',
      '     GitHub Actions: repository secret CLOUDFLARE_ACCOUNT_ID).',
      '  3. Re-run the build. Nothing else needs to be created by hand.',
      '',
      `Alternative: create the DB yourself and paste its id into database_id in ${WRANGLER_TOML}.`,
    ]
    if (STRICT && !currentId.match(IS_UUID)) die(text)
    warn(`Could not resolve a D1 database id (${reason}).`)
    if (!haveAuth) warn('No Cloudflare credentials found — fine for a plain local build, `deploy` would need them.')
    return
  }

  // --- patch wrangler.toml (build container only) --------------------------
  if (databaseId !== currentId) {
    const patched = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`)
    writeFileSync(WRANGLER_TOML, patched)
    toml = patched
    log(`wrangler.toml now points at database_id ${databaseId}.`)
  }

  // --- schema + migrations (idempotent) -------------------------------------
  const apply = (file) => run(['d1', 'execute', dbName, '--remote', `--file=${file}`])
  const files = []
  if (existsSync(SCHEMA_FILE)) files.push(SCHEMA_FILE)
  if (existsSync('src/db')) {
    files.push(
      ...readdirSync('src/db')
        .filter((f) => /^migration-v\d+\.sql$/.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
        .map((f) => `src/db/${f}`),
    )
  }
  let failed = 0
  for (const file of files) {
    const r = apply(file)
    if (r.ok) log(`${file}: applied.`)
    else if (/duplicate column|already exists/i.test(r.out)) log(`${file}: already up to date.`)
    else {
      failed++
      warn(`${file} could not be applied at build time: ${r.out.trim().split('\n').slice(-2).join(' | ')}`)
    }
  }
  if (failed) {
    warn('The Worker will create/upgrade its tables itself on the first request (src/db/bootstrap.ts), so this is not fatal.')
  }

  log('Done — proceeding to build.')
}

main().catch((err) => {
  if (STRICT) die([`Unexpected failure: ${err.message}`])
  warn(`Unexpected failure: ${err.message} — continuing without provisioning.`)
})
