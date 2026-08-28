# Кабинет: единая UI-библиотека и редизайн (liquid glass, «между двумя»)

Дата: 2026-08-28
Статус: утверждено пользователем (подход A, полный охват кабинета)

## Цели

1. Построить единую UI-библиотеку компонентов кабинета (`frontend/src/cabinet/components/ui/`) с API в стиле shadcn (CVA-варианты, Radix-примитивы, `cn()`), на которых работает **весь** кабинет (не админка).
2. Сдержать масштаб интерфейса: текущий «раздутый» и пример mega-redesign «топорный» — нужен средний вариант.
3. Сохранить и укрепить дизайн-язык: liquid glass (bg blur), glow, острова-карточки.
4. Живой интерфейс: анимации повсюду, но сдержанные; `cursor-pointer` на всём кликабельном; Enter сабмитит формы.
5. Единая система модалок: предзагрузка данных до открытия, свайп-закрытие на мобильных (vaul), без подрагиваний.
6. Единый async-слой: soft-refresh без мигания, SuccessDialog после покупок/зачислений, анимированный баланс в сайдбаре.

## Не-цели

- Админка (`frontend/src/pages`) не трогается.
- Бэкенд и API-контракты не меняются; пейлоады покупки идентичны текущим.
- `frontend/src` снимки `.before-*` не трогаем.
- Auth-страницы переводим на ui-kit, но их редизайн — только в объёме компонентов (не новая верстка сценариев).

## Новые зависимости

- `vaul` — swipeable bottom sheet на мобильных (built on Radix Dialog API).

## Дизайн-токены и шкала «между двумя»

Правится в одном месте — `cabinet.css` (существующие классы) + варианты компонентов:

- Заголовок страницы: `text-2xl sm:text-3xl` (сейчас до `text-3xl` + большие подписи).
- Крупная цифра (дни): `text-5xl sm:text-6xl` (сейчас `text-6xl/7xl`).
- Карточки: радиус `rounded-3xl/4xl` сохраняется, паддинги `p-5` (макс `sm:p-6`, сейчас до `p-7`).
- Кнопки: высоты `sm=36px, md=44px, lg=52px`; иконка 16px; text-sm. Активная зона не уменьшается.
- Glow: тоньше (меньше spread/opacity), blur и градиенты фона сохраняются как есть.
- Метки-капслоки (`ДЛИТЕЛЬНОСТЬ`) → обычный регистр, `text-xs font-semibold text-fog-500` (сдержаннее).

## UI-библиотека: состав

Каталог `frontend/src/cabinet/components/ui/`. Всё на `cn()` + `cva`. Комментарии на русском.

| Компонент | API | Заменяет |
|---|---|---|
| `button.tsx` | `Button` variants: `primary/secondary/outline/ghost/destructive`; sizes: `sm/md/lg/icon`; props: `loading`, `loadingText`; spinner внутри, блокировка повторных кликов | `btn-primary`/`btn-ghost` (71 исп.), 20 ручных `Loader2` |
| `card.tsx` | `Card` variants: `glass/glassStrong/inset/liquid` (prop `variant`), компаунды `CardHeader/Title/Description/Content/Footer` | 66 glass-плейтов |
| `dialog.tsx` | `Dialog` (Root/Trigger/Close), `DialogContent` (авто: десктоп — центр. glass-карточка, мобайл — vaul bottom-sheet со свайпом и grabber), `DialogHeader/Title/Description/Footer` | 7+ локальных Radix-диалогов |
| `input.tsx` | `Input`, `Textarea`; `label` через `field.tsx` (`Field` = Label + Input + error) | 27 `input-glass` |
| `checkbox.tsx`, `switch.tsx` | Radix-обёртки в нашем стиле | ручные чекбоксы, Switch в Profile |
| `badge.tsx` | `Badge` variants: `default/amber/mint/violet/success` | ручные `chip` |
| `progress.tsx` | `Progress` (gradient fill, glow, анимация заполнения) | `TrafficBar`, бары подписок (3 места) |
| `skeleton.tsx` | `Skeleton` | ручные `bg-white/8` скелетоны |
| `separator.tsx` | `Separator` | `h-px bg-white/8` (много мест) |
| `icon-tile.tsx` | `IconTile` (variants: default/violet/mint/amber) | 28 `icon-tile` |
| `option-card.tsx` | `OptionCard` (selected-glow, компакт) | карточки длительности/устройств/методов |
| `stepper.tsx` | `Stepper` (− N +, min/max, подпись цены сбоку) | сетка 6 карточек доп. устройств |
| `animated-number.tsx` | `AnimatedNumber` (spring, формат ru-RU) | статичные цифры баланса/дней |
| `success-dialog.tsx` | `SuccessDialog` (открывается через `useSuccess().open({title, description, onDone})`) | success-шаги внутри диалогов |
| `empty-state.tsx` | `EmptyState` (иконка + заголовок + текст + actions) | пустые состояния дашборда/ключей |
| `copy-button.tsx` | перенос существующего на новый `Button` | — |
| `toasts.tsx` | перенос, общий `Button`-стиль | существующий |
| `prefetch.ts` | `prefetchPublicConfig()`, `prefetchConversionPreview()` — кэш с TTL | запросы при открытии модалок |

Глобально в CSS: `button, [role="button"], a, select, label[for], summary { cursor: pointer }` + `:focus-visible` ring.

## Модальная система

- Один `DialogContent`: на `lg+` центрированная glass-карточка (spring scale+fade), на мобиле — vaul bottom-sheet: drag-handles, свайп вниз закрывает с пружиной, контент под шторкой подсвечивается (vaul reveal).
- Максимальная высота `85dvh`, скролл только внутри контента; заголовок/футер закреплены, чтобы «К оплате» всегда был виден.
- **Предзагрузка**: `getPublicConfig` грузится при входе на «Тарифы»/«Кабинет» (prefetch-кэш), conversion preview — при pointerdown на кнопке покупки до открытия. Внутри открытой модалки никаких появляющихся блоков: под данные — скелетон фиксированной высоты или отложенная секция.
- Контентная компактность: не более одной смысловой секции на экран; вторичные пояснения — сворачиваемые/меньше кеглем.

## Покупка тарифа (PlanDialog) — структура

**Шаг config** (как #4, но сдержаннее):
- Заголовок: имя тарифа + подпись, IconTile.
- Длительность: `OptionCard` в ряд (дней / цена / ₽/день), бейдж «−N%» на опциях со скидкой (как #13).
- Доп. устройства: `Stepper` «− N +» + строка «+20 ₽/мес за устройство»; если действует скидка — «скидка N%»; цена в итоге растёт на уменьшающиеся суммы (логика `quoteTariff` без изменений) (как #12).
- Итог-строка + чекбокс оферты + `Button loading` «Перейти к оплате».

**Шаг checkout** (как #15, с компоновкой кнопок #14):
- «← Изменить конфигурацию».
- Сводка-плейт: Тариф, N дней · Доп. устройства ×N · строки конвертации/продления · Итого.
- Промокод: Field + `Button` «Применить» (Enter сабмитит).
- Способ оплаты: строка «С баланса» (баланс справа, `AnimatedNumber`), Platega-блок «Рекомендуем» с крупными СБП/Карта (сохраняем наши кнопки), строка «Крипта через Platega», ряды CryptoBot / RollyPay / зарубежные карты.

**Успех**: `SuccessDialog` (галка, заголовок, описание, «Готово») + soft-refresh + анимация баланса. Вместо текущего шага «success» и части тостов.

## Дашборд

- Правая колонка «Быстрые действия» (glass-плейт, заголовок): «Продлить подписку» (primary) + компактные вторичные (Докупить трафик, Ключи доступа, Пробный период, Все тарифы) — стиль и иконки как в сдержанном примере, высота `md`.
- Главный план: та же информация (дни `AnimatedNumber`/`text-5xl`, трафик-`Progress`, whitelist, устройства компактными строками), масштаб по новой шкале.
- Сайдбар: баланс-плейт как #9 — IconTile + «Баланс» + `AnimatedNumber` + `Button` «Пополнить» (ведёт на пополнение в профиле).

## Async-слой и живость

- `AppContext.reload()` разделяется на первичную загрузку (скелетоны) и `softRefresh()` (точечные set-стейты, без `loading=true`, без мигания). Покупки/зачисления/отключение устройства вызывают softRefresh.
- Все платёжные кнопки — `Button loading`; повторный клик заблокирован.
- Формы: обёрнуты в `<form onSubmit>` (промокод, вывод средств, безопасность, вход/регистрация, 2FA) — Enter сабмитит.
- Анимации: layout-переходы чисел, заполнение прогрессов, появление карточек со сдвигом ≤12px и стаггером ≤60мс, press `scale 0.98`. Ничего не прыгает.

## Миграция (порядок)

1. Зависимость `vaul`; базовые компоненты (button, card, badge, separator, skeleton, icon-tile, input/field, progress, animated-number).
2. `dialog.tsx` (Radix+vaul) + `success-dialog` + контекст `useSuccess` + `prefetch.ts`.
3. `Layout.tsx` (сайдбар: баланс-плейт, кнопки), `Cabinet.tsx` (дашборд + быстрые действия).
4. `Tariffs.tsx` (PlanDialog config/checkout, OptionCard, Stepper, оплата), `Services.tsx` (TrafficOptionDialog, ExtraOptions).
5. `Keys.tsx`, `Profile.tsx` (SecurityDialog, Switch), `Referrals.tsx` (форма вывода), `trials-picker-dialog.tsx`.
6. `Auth.tsx`, `AccountFlows.tsx` (формы на Field/Button с Enter).
7. Токены шкалы в CSS, финальный проход: cursor-pointer, focus-visible, удаление мёртвых локальных стилей.

## Тестирование

- `cd frontend && npm run build` (tsc -b + vite) — обязателен после каждого этапа.
- Ручная проверка Playwright MCP: дашборд (десктоп/мобайл), открытие модалок без подрагиваний, свайп-закрытие на мобильном вьюпорте, покупка по балансу (SuccessDialog + анимация баланса), Stepper/скидки, Enter в формах.
- Регресс: продление с `?extend=`, конвертация trial, whitelist-трафик, «Позже» в BindTelegram, Deeplink-режим Telegram Mini App (оплата через pendingPaymentId).
