-- Основная иерархия кнопок главного меню:
-- кабинет — акцент, подписки и рефералы — негативный акцент, служебные пункты — нейтральные.
DO $$
DECLARE
  current_buttons jsonb;
  normalized_buttons jsonb;
BEGIN
  SELECT value::jsonb INTO current_buttons
  FROM system_settings
  WHERE key = 'bot_buttons'
  LIMIT 1;

  IF current_buttons IS NOT NULL AND jsonb_typeof(current_buttons) = 'array' THEN
    SELECT jsonb_agg(
      CASE
        WHEN item->>'id' IN ('my_subs', 'referral')
          THEN jsonb_set(item, '{style}', to_jsonb('danger'::text))
        WHEN item->>'id' IN ('support', 'about')
          THEN jsonb_set(item, '{style}', to_jsonb(''::text))
        ELSE item
      END
      ORDER BY ord
    ) INTO normalized_buttons
    FROM jsonb_array_elements(current_buttons) WITH ORDINALITY AS entry(item, ord);

    UPDATE system_settings
    SET value = normalized_buttons::text
    WHERE key = 'bot_buttons';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'lazeyka_main_button_hierarchy: пропуск (старые настройки не JSON или таблица недоступна)';
END $$;
