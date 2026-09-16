-- Migration v11: optional "country" label on backend_pool accounts, so
-- pro/VIP config names can show a flag + country instead of the generic
-- "سرور N" text — see DEFAULT_PRO_CONFIG_NAME in src/services/subscription.ts.
--
-- Same rules as the clean_ips.country column added in migration-v10.sql:
-- purely a manually-entered, cosmetic label. Cloudflare Workers cannot
-- select or verify which country a connection actually egresses from, so
-- only tag an account with a country you've actually confirmed (it's a
-- worker you deployed/rented there, etc.) — see the comment at the top of
-- src/utils/countries.ts.

ALTER TABLE backend_pool ADD COLUMN country TEXT;
