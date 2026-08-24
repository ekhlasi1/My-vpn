-- Migration v6: automatic "clean IP" discovery (requirement #5)
--
-- Adds storage for Cloudflare edge IPs this worker has actually tested
-- itself (via the `cf.resolveOverride` fetch option) and found reachable.
-- The healthiest/fastest one is used as the VLESS connect address (`add=`)
-- in generated configs, while `host`/`sni` keep pointing at the real worker
-- domain — see src/services/clean-ips.ts.
--
-- Run this the same way as migration-v5:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v6.sql

CREATE TABLE IF NOT EXISTS clean_ips (
  ip           TEXT PRIMARY KEY,
  latency_ms   INTEGER,
  healthy      INTEGER NOT NULL DEFAULT 0,
  last_checked INTEGER NOT NULL,
  last_error   TEXT
);
CREATE INDEX IF NOT EXISTS idx_clean_ips_healthy ON clean_ips(healthy, latency_ms);
