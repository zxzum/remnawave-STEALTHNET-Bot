-- Обновляем сохранённые настройки бота вместе с дефолтами кода.
-- Старые значения success поддерживаются рендерером, но больше не показываются зелёными.
DO $$
DECLARE
  current_buttons jsonb;
  normalized_buttons jsonb;
  current_styles jsonb;
  normalized_styles jsonb;
BEGIN
  SELECT value::jsonb INTO current_buttons
  FROM system_settings
  WHERE key = 'bot_buttons'
  LIMIT 1;

  IF current_buttons IS NOT NULL AND jsonb_typeof(current_buttons) = 'array' THEN
    SELECT jsonb_agg(
      CASE
        WHEN item->>'id' = 'referral' AND item->>'label' = '💸 Пригласить и заработать'
          THEN jsonb_set(jsonb_set(item, '{label}', to_jsonb('🔗 Реферальная система'::text)), '{style}', to_jsonb('primary'::text))
        WHEN item->>'id' = 'cabinet' AND item->>'label' = '🚀 Открыть кабинет'
          THEN jsonb_set(item, '{label}', to_jsonb('🔐 Войти в кабинет'::text))
        WHEN item->>'id' = 'support'
          THEN jsonb_set(item, '{style}', to_jsonb(''::text))
        WHEN item->>'style' = 'success'
          THEN jsonb_set(item, '{style}', to_jsonb('primary'::text))
        ELSE item
      END
      ORDER BY ord
    ) INTO normalized_buttons
    FROM jsonb_array_elements(current_buttons) WITH ORDINALITY AS entry(item, ord);

    UPDATE system_settings
    SET value = normalized_buttons::text
    WHERE key = 'bot_buttons';
  END IF;

  SELECT value::jsonb INTO current_styles
  FROM system_settings
  WHERE key = 'bot_inner_button_styles'
  LIMIT 1;

  IF current_styles IS NOT NULL AND jsonb_typeof(current_styles) = 'object' THEN
    SELECT jsonb_object_agg(key, CASE WHEN value = '"success"'::jsonb THEN '"primary"'::jsonb ELSE value END)
    INTO normalized_styles
    FROM jsonb_each(current_styles);

    UPDATE system_settings
    SET value = normalized_styles::text
    WHERE key = 'bot_inner_button_styles';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'lazeyka_bot_palette: пропуск (старые настройки не JSON или таблица недоступна)';
END $$;
