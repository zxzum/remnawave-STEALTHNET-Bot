-- Tariff-backed trials get an independent component snapshot. Existing snapshots
-- are never overwritten. The 5 GiB whitelist value is deployment data, not a
-- runtime business rule.
INSERT INTO "trial_remnawave_components" (
  "id", "trial_id", "key", "admin_name", "required", "merge_order",
  "internal_squad_uuids", "traffic_limit_bytes", "traffic_reset_mode",
  "show_quota_to_client", "quota_display_name", "enabled", "created_at", "updated_at"
)
SELECT
  ('tcmp' || SUBSTRING(MD5(tr."id" || ':' || c."key"), 1, 21))::TEXT,
  tr."id",
  c."key",
  c."admin_name",
  c."required",
  c."merge_order",
  c."internal_squad_uuids",
  CASE WHEN c."key" = 'whitelist' THEN 5368709120 ELSE c."traffic_limit_bytes" END,
  c."traffic_reset_mode",
  c."show_quota_to_client",
  c."quota_display_name",
  c."enabled",
  NOW(),
  NOW()
FROM "trials" tr
JOIN "tariff_remnawave_components" c ON c."tariff_id" = tr."tariff_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "trial_remnawave_components" existing
  WHERE existing."trial_id" = tr."id"
)
ON CONFLICT ("trial_id", "key") DO NOTHING;
