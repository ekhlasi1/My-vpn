-- Migration v9: remove automatic "clean IP" scanning, replace with a
-- manually-entered healthy IP:port list (requirement #5)
--
-- The OLD clean_ips table this migration originally targeted (columns: ip
-- PRIMARY KEY, latency_ms, healthy, last_checked, last_error, from an
-- in-worker scanner that tested Cloudflare candidate IPs against this
-- worker's own domain) was replaced before it ever actually shipped to any
-- deployment. schema.sql has always created the final shape directly
-- (id, ip, port, note, country, created_at) — the exact table
-- src/db/queries.ts (listCleanIps / addCleanIp / getBestCleanIp) reads and
-- writes today.
--
-- FIX (see scripts/ci-setup.js sort-order comment): this file used to
-- unconditionally run `DROP TABLE IF EXISTS clean_ips` + recreate it. On a
-- fresh/already-upgraded database (i.e. every real deployment, since the
-- old shape never shipped) that DROP just destroyed every admin-entered
-- "healthy IP" row on EVERY single deploy — pure data loss for no benefit.
-- It also stripped the `country` column added by migration-v10.sql whenever
-- v9 ran after v10 (the exact bug the ci-setup.js sort fix addresses).
-- Since schema.sql already owns and guarantees the correct table shape via
-- `CREATE TABLE IF NOT EXISTS`, this file no longer touches the table at
-- all — only the one-time settings-key rename below remains, which is
-- purely additive/idempotent and never deletes user data.
--
-- Run this the same way as previous migrations:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v9.sql

-- The old auto_clean_ip_enabled setting is replaced by
-- clean_ip_override_enabled; both default to off ('0') so this is optional,
-- but carrying over an admin's existing choice avoids surprising a
-- deployment that had already turned the old toggle on.
INSERT OR IGNORE INTO settings (key, value)
SELECT 'clean_ip_override_enabled', value FROM settings WHERE key = 'auto_clean_ip_enabled';
DELETE FROM settings WHERE key IN ('auto_clean_ip_enabled', 'clean_ip_scan_offset', 'last_clean_ip_scan');
