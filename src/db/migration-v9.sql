-- Migration v9: manual country/colo-aware approval for clean IPs
--
-- Extends the clean_ips table (added in migration v6) with:
--   colo     - Cloudflare colo (data-center) airport code this IP last
--              answered from (e.g. "FRA", "IST"), detected via
--              /cdn-cgi/trace dialed directly at the IP.
--   country  - friendly country/city label for `colo`, when it's one of
--              the colos in COLO_COUNTRY (see src/services/clean-ips.ts) —
--              currently Germany, Turkey, and a few other nearby colos
--              that tend to route better for Iranian ISPs than the US.
--   approved - an IP being "healthy" (reachable from Iran) is no longer
--              enough for it to be handed out to users. The admin must
--              also explicitly approve it from the dashboard's clean-IP
--              table (select rows -> "افزودن به لیست ربات") before
--              getBestCleanIp() will ever return it.
--
-- Existing rows default to approved = 0, so nothing already-discovered
-- silently starts being used after this migration — the admin has to
-- review and approve, same as newly discovered IPs.
--
-- Run this the same way as previous migrations:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v9.sql

ALTER TABLE clean_ips ADD COLUMN colo TEXT;
ALTER TABLE clean_ips ADD COLUMN country TEXT;
ALTER TABLE clean_ips ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_clean_ips_approved ON clean_ips(approved, healthy, latency_ms);
