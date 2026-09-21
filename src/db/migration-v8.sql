-- Migration v8: editable display names for user-facing subscription configs
--
-- Adds two settings the admin panel's "تنظیمات تست" tab can now edit:
--   pro_config_name   - name shown for each of a pro/VIP user's configs
--   trial_config_name - name shown for a trial/test user's single config
-- Placeholders supported: {brand}, {admin}, {n} (pro only, server index).
--
-- Run this the same way as previous migrations:
--   npx wrangler d1 execute <db-name> --remote --file=./src/db/migration-v8.sql

INSERT OR IGNORE INTO settings (key, value) VALUES ('pro_config_name', '👑 {brand} VIP | سرور {n} | @{admin}');
INSERT OR IGNORE INTO settings (key, value) VALUES ('trial_config_name', '{brand} | خرید: @{admin}');
