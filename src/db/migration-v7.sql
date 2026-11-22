-- Migration v7: public DNS routing list (Private DNS / DoT feature)
--
-- Backs the domain/ip/cidr list that the standalone DoT server in
-- dot-server/ (deployed separately — see docs/private-dns-fa.md, Cloudflare
-- Workers cannot host a DNS-over-TLS listener on port 853) fetches from the
-- public, unauthenticated GET /api/dns-rules endpoint and uses to decide,
-- per resolved answer, whether to hand back a Cloudflare "clean" IP (routed
-- through the proxy) or the real upstream answer untouched (direct).
--
-- Run this the same way as migration-v6:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v7.sql

CREATE TABLE IF NOT EXISTS dns_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,          -- 'domain' | 'ip' | 'cidr'
  value      TEXT NOT NULL,          -- 'example.com', '*.example.com', '1.2.3.4', '1.2.3.0/24'
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dns_rules_kind_value ON dns_rules(kind, value);
