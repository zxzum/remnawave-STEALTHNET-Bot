# Кабинет: UI-библиотека и редизайн — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить единую UI-библиотеку кабинета (shadcn-подобный API, liquid glass) и перевести на неё весь кабинет: сдержанный масштаб, единые свайп-модалки с предзагрузкой, SuccessDialog + анимированный баланс, Stepper вместо карточек устройств.

**Architecture:** Собственный ui-kit в `frontend/src/cabinet/components/ui/` на CVA + Radix + vaul + framer-motion поверх существующих CSS-токенов (`cabinet.css`). Миграция страниц на компоненты поэтапно; бизнес-логика покупок (`quoteTariff`, пейлоады) не меняется.

**Tech Stack:** React 18, TypeScript, Tailwind 4, Radix primitives, vaul (новая), framer-motion, lucide-react, class-variance-authority.

**Spec:** `docs/superpowers/specs/2026-08-28-cabinet-ui-kit-design.md`

## Global Constraints

- Ветка `redesign/cabinet-ui-kit`. Все команды — из `frontend/`, если не указано иное.
- Единственная новая зависимость: `vaul`. React 18 (не поднимать до 19).
- Комментарии в коде — на русском.
- Не трогать: `frontend/src/pages/**` (админка), файлы `*.before-*`, бэкенд.
- Верификация каждого таска: `cd frontend && npm run build` — 0 ошибок (tsc -b + vite). Фронтовый раннер unit-тестов в проекте отсутствует — цикл «теста» здесь: сборка + Playwright-проверка в чекпоинт-тасках (Task 12).
- Дизайн-язык сохраняем: классы `glass`, `glass-strong`, `glass-inset`, `liquid`, `btn-primary` в `cabinet.css` остаются базой вариантов; CSS в `@layer components`, поэтому tailwind-утилиты (например, `rounded-xl`) их перекрывают — это осознанно используется для size-вариантов.
- Кнопки/ссылки/инпуты: `cursor-pointer` везде (глобальное правило в Task 1), press `active:scale-[0.97]`, `focus-visible` ring.
- Формы: сабмит по Enter (`<form onSubmit>`).

---

### Task 1: Базовые примитивы — Button, IconTile, Badge, Separator, Skeleton + cursor-pointer

**Files:**
- Create: `frontend/src/cabinet/components/ui/button.tsx`
- Create: `frontend/src/cabinet/components/ui/icon-tile.tsx`
- Create: `frontend/src/cabinet/components/ui/badge.tsx`
- Create: `frontend/src/cabinet/components/ui/separator.tsx`
- Create: `frontend/src/cabinet/components/ui/skeleton.tsx`
- Create: `frontend/src/cabinet/components/ui/index.ts`
- Modify: `frontend/src/cabinet.css`
- Modify: `frontend/package.json` (зависимость `vaul` — ставится сейчас, нужна с Task 4)

**Interfaces (Produces):**
- `Button({ variant = "primary", size = "md", loading, loadingText, ...props })` — variants: `primary | secondary | ghost | outline | destructive | success | link`; sizes: `sm | md | lg | icon`; при `loading` рендерит `Loader2 animate-spin` первым ребёнком, disables кнопки.
- `IconTile({ size = "md", tone = "default", className, children })` — sizes `sm (h-9 w-9 rounded-xl) | md (h-11 w-11 rounded-xl) | lg (h-12 w-12 rounded-2xl)`; tones `default | violet | mint | amber`.
- `Badge({ variant = "default", fluid })` — variants `default | amber | mint | violet`; fluid = `chip-fluid`-поведение.
- `Separator({ className })`; `Skeleton({ className })`.
- `export * from` каждого файла в `ui/index.ts`.

- [ ] **Step 1: Установить vaul**

```bash
cd frontend && npm install vaul
```

- [ ] **Step 2: Глобальный cursor-pointer в cabinet.css**

В конец `frontend/src/cabinet.css` добавить:

```css
/* Все интерактивные элементы — pointer (требование «живого» интерфейса) */
body.cabinet-ui-active button:not(:disabled),
body.cabinet-ui-active [role="button"]:not(:disabled),
body.cabinet-ui-active a,
body.cabinet-ui-active select,
body.cabinet-ui-active label:has(> input:not(:disabled)),
body.cabinet-ui-active summary,
body.cabinet-ui-active [data-radix-collection-item] {
  cursor: pointer;
}
```

- [ ] **Step 3: Button**

`frontend/src/cabinet/components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  // press-анимация + focus-ring + фиксированный размер иконок внутри
  "relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-bold transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
  {
    variants: {
      // primary/ghost/success опираются на существующие CSS-классы (light sweep, glow)
      variant: {
        primary: "btn-primary",
        secondary:
          "glass text-fog-100 hover:bg-white/8 hover:border-white/20",
        ghost: "btn-ghost",
        outline: "border border-white/14 bg-transparent text-fog-100 hover:bg-white/6",
        destructive: "border border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        success: "btn-success",
        link: "text-fog-400 hover:text-fog-100",
      },
      size: {
        sm: "h-9 rounded-xl px-3 text-xs",
        md: "h-11 rounded-2xl px-4 text-sm",
        lg: "h-12 rounded-2xl px-5 text-sm",
        icon: "h-9 w-9 rounded-xl p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Спиннер внутри + блокировка повторных кликов */
  loading?: boolean;
  /** Текст на время загрузки (иначе остаётся children) */
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, loadingText, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" />}
      {loading && loadingText ? loadingText : children}
    </button>
  ),
);
Button.displayName = "Button";
```

- [ ] **Step 4: IconTile, Badge, Separator, Skeleton**

`icon-tile.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** Плитка под иконку — база всех иконочных кружков кабинета */
export function IconTile({
  size = "md",
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  size?: "sm" | "md" | "lg";
  tone?: "default" | "violet" | "mint" | "amber";
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center border",
        size === "sm" && "h-9 w-9 rounded-xl",
        size === "md" && "h-11 w-11 rounded-xl",
        size === "lg" && "h-12 w-12 rounded-2xl",
        tone === "default" && "icon-tile",
        tone === "violet" && "border-violet-glow/30 bg-violet-glow/12 text-violet-glow",
        tone === "mint" && "border-mint-400/25 bg-mint-500/12 text-mint-400",
        tone === "amber" && "border-amber-glow/30 bg-amber-glow/12 text-amber-glow",
        className,
      )}
      {...props}
    />
  );
}
```

`badge.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Badge({
  variant = "default",
  fluid,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "amber" | "mint" | "violet";
  fluid?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-bold tracking-wide",
        variant === "default" && "border border-white/10 bg-white/5 text-fog-300",
        variant === "amber" && "border border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
        variant === "mint" && "border border-mint-400/30 bg-mint-500/10 text-mint-400",
        variant === "violet" && "border border-violet-glow/30 bg-violet-glow/12 text-violet-glow",
        fluid && "w-full min-w-0 justify-center whitespace-normal",
        className,
      )}
      {...props}
    />
  );
}
```

`separator.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-white/8", className)} />;
}
```

`skeleton.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-2xl bg-white/8", className)} />;
}
```

`ui/index.ts`:

```ts
export * from "./button";
export * from "./icon-tile";
export * from "./badge";
export * from "./separator";
export * from "./skeleton";
```

- [ ] **Step 5: Сборка**

Run: `cd frontend && npm run build`
Expected: 0 ошибок.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/cabinet/components/ui frontend/src/cabinet.css frontend/package.json frontend/package-lock.json
git commit -m "feat(cabinet): base ui primitives — Button/IconTile/Badge/Separator/Skeleton"
```

---

### Task 2: Поля форм — Input, Textarea, Field, Checkbox, Switch

**Files:**
- Create: `frontend/src/cabinet/components/ui/input.tsx` (Input, Textarea, Field)
- Create: `frontend/src/cabinet/components/ui/checkbox.tsx`
- Create: `frontend/src/cabinet/components/ui/switch.tsx`
- Modify: `frontend/src/cabinet/components/ui/index.ts`

**Interfaces (Produces):**
- `Input` / `Textarea` — нативные элементы со стилем `input-glass`; `invalid?: boolean`.
- `Field({ label, error, children, className })` — обёртка label+control+error.
- `Checkbox({ checked, onCheckedChange })` — Radix-обёртка (controlled).
- `Switch({ checked, onCheckedChange })` — Radix-обёртка.

- [ ] **Step 1: input.tsx**

```tsx
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const controlBase = "input-glass";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} className={cn(controlBase, invalid && "border-red-400/50 focus:shadow-[0_0_0_3px_rgba(248,113,113,0.18)]", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea ref={ref} className={cn(controlBase, "min-h-20 resize-none", invalid && "border-red-400/50", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

/** Label + контрол + текст ошибки */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-2 block text-sm font-bold">{label}</span>}
      {children}
      {error && <span className="mt-2 block text-sm text-red-400">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 2: checkbox.tsx и switch.tsx**

`checkbox.tsx`:

```tsx
import * as Radix from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Radix.Root>) {
  return (
    <Radix.Root
      className={cn(
        "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/5 transition-colors",
        "data-[state=checked]:border-violet-glow data-[state=checked]:bg-violet-glow data-[state=checked]:text-ink-950",
        className,
      )}
      {...props}
    >
      <Radix.Indicator>
        <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
      </Radix.Indicator>
    </Radix.Root>
  );
}
```

`switch.tsx`:

```tsx
import * as Radix from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof Radix.Root>) {
  return (
    <Radix.Root
      className={cn(
        "relative h-7 w-12 shrink-0 cursor-pointer rounded-full border border-white/12 bg-white/8 transition-colors",
        "data-[state=checked]:border-violet-glow/60 data-[state=checked]:bg-violet-glow/70",
        className,
      )}
      {...props}
    >
      <Radix.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
    </Radix.Root>
  );
}
```

- [ ] **Step 3: index.ts дополнить**

```ts
export * from "./input";
export * from "./checkbox";
export * from "./switch";
```

- [ ] **Step 4: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/components/ui
git commit -m "feat(cabinet): form primitives — Input/Field/Checkbox/Switch"
```

---

### Task 3: Живые компоненты — AnimatedNumber, Progress, OptionCard, Stepper, EmptyState

**Files:**
- Create: `frontend/src/cabinet/components/ui/animated-number.tsx`
- Create: `frontend/src/cabinet/components/ui/progress.tsx`
- Create: `frontend/src/cabinet/components/ui/option-card.tsx`
- Create: `frontend/src/cabinet/components/ui/stepper.tsx`
- Create: `frontend/src/cabinet/components/ui/empty-state.tsx`
- Modify: `frontend/src/cabinet/components/ui/index.ts`

**Interfaces (Produces):**
- `AnimatedNumber({ value, format? })` — формат по умолчанию `toLocaleString("ru-RU")`; пружинная анимация значения.
- `Progress({ value, max = 100, tone?, className })` — tone `default | amber`; анимация заполнения.
- `OptionCard({ selected, badge?, className, ...buttonProps, children })` — compact select-карточка, selected-glow.
- `Stepper({ value, min = 0, max, onChange, hint? })` — «− N +».
- `EmptyState({ icon: Icon, title, description?, children? })`.

- [ ] **Step 1: animated-number.tsx**

```tsx
import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

/** Число, плавно «докручивающееся» до нового значения (баланс, дни) */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const motionValue = useMotionValue(value);
  const text = useTransform(motionValue, (v) => (format ?? ((n: number) => n.toLocaleString("ru-RU")))(v));

  useEffect(() => {
    const controls = animate(motionValue, value, { type: "spring", stiffness: 90, damping: 20 });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span className={className}>{text}</motion.span>;
}
```

- [ ] **Step 2: progress.tsx**

```tsx
import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

export function Progress({
  value,
  max = 100,
  tone = "default",
  className,
}: {
  value: number;
  max?: number;
  tone?: "default" | "amber";
  className?: string;
}) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-white/8 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]", className)}
    >
      <motion.div
        className={cn(
          "h-full rounded-full",
          tone === "default" && "bg-gradient-to-r from-accent-500 via-accent-400 to-mint-400 shadow-[0_0_12px_rgba(77,124,254,0.55)]",
          tone === "amber" && "bg-gradient-to-r from-amber-glow to-amber-500 shadow-[0_0_12px_rgba(255,181,69,0.5)]",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
```

- [ ] **Step 3: option-card.tsx**

```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface OptionCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Бейдж в правом верхнем углу, напр. «−33%» */
  badge?: ReactNode;
  glow?: "blue" | "violet";
}

/** Компактная карточка выбора (длительность, устройство, метод) */
export const OptionCard = forwardRef<HTMLButtonElement, OptionCardProps>(
  ({ selected, badge, glow = "blue", className, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "relative cursor-pointer rounded-2xl border p-3 text-center transition-all duration-200 active:scale-[0.98]",
        selected
          ? glow === "blue"
            ? "border-accent-400/60 bg-accent-500/15 shadow-neon-blue"
            : "border-violet-glow/60 bg-violet-glow/12 shadow-[0_0_24px_-6px_rgba(176,124,255,0.6)]"
          : "border-white/8 bg-white/3 hover:border-white/20",
        className,
      )}
      {...props}
    >
      {badge != null && (
        <span className="absolute -top-2 right-2 rounded-full border border-mint-400/40 bg-ink-950 px-1.5 py-0.5 text-[10px] font-extrabold text-mint-400">
          {badge}
        </span>
      )}
      {children}
    </button>
  ),
);
OptionCard.displayName = "OptionCard";
```

- [ ] **Step 4: stepper.tsx**

```tsx
import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";

/** «− N +» — выбор доп. устройств вместо сетки карточек */
export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  hint,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  /** Подпись справа (цена / скидка) */
  hint?: ReactNode;
  /** Доступное имя для aria */
  label: string;
}) {
  return (
    <div className="glass-inset flex items-center gap-3 rounded-2xl p-2">
      <Button variant="secondary" size="icon" aria-label={`Уменьшить: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus />
      </Button>
      <p className="min-w-14 text-center text-lg font-extrabold leading-none">{value === 0 ? "Без доп." : `+${value}`}</p>
      <Button variant="secondary" size="icon" aria-label={`Увеличить: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus />
      </Button>
      {hint && <div className="ml-auto pr-2 text-right text-xs text-fog-500">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 5: empty-state.tsx**

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconTile } from "./icon-tile";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <IconTile size="lg" className="h-16 w-16 rounded-2xl">
        <Icon className="h-7 w-7" />
      </IconTile>
      <h2 className="mt-5 text-xl font-extrabold">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-fog-500">{description}</p>}
      {children && <div className="mt-5 flex flex-col items-center gap-2">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 6: index.ts, сборка, коммит**

```ts
export * from "./animated-number";
export * from "./progress";
export * from "./option-card";
export * from "./stepper";
export * from "./empty-state";
```

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/components/ui
git commit -m "feat(cabinet): AnimatedNumber/Progress/OptionCard/Stepper/EmptyState"
```

---

### Task 4: Модальная система — Modal (Radix + vaul), SuccessDialog + useSuccess, prefetch

**Files:**
- Create: `frontend/src/cabinet/components/ui/modal.tsx`
- Create: `frontend/src/cabinet/components/ui/success-dialog.tsx`
- Create: `frontend/src/cabinet/components/ui/prefetch.ts`
- Modify: `frontend/src/cabinet/components/ui/index.ts`
- Modify: `frontend/src/cabinet/components/Layout.tsx` (подключить `SuccessProvider`)
- Create: `frontend/src/cabinet/lib/use-media-query.ts`

**Interfaces (Produces):**
- `useIsDesktop()` — `window.matchMedia("(min-width: 640px)")`.
- `Modal({ open, onOpenChange, className?, hideClose?, children })` — десктоп: центрированная glass-карточка (spring, fade), мобайл: vaul bottom-sheet (свайп вниз, grabber). Компаунды: `ModalBody` (скролл-область `p-5 sm:p-6`), `ModalTitle`, `ModalDescription`, `ModalFooter` — работают внутри обеих реализаций (через контекст выбирают Radix/Drawer примитив).
- `SuccessProvider` + `useSuccess().show({ title, description?, onDone? })` — глобальное окно успеха (галка + «Готово»).
- `prefetch(key, loader)`, `prefetchPublicConfig()`, `prefetchConversionPreview(token, args)` — кэш промисов на 60с; повторный вызов не дёргает сеть.

- [ ] **Step 1: use-media-query.ts**

```ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 640px)");
```

- [ ] **Step 2: modal.tsx**

```tsx
import { createContext, useContext, useEffect, type HTMLAttributes, type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useIsDesktop } from "../../lib/use-media-query";

const ModalKindContext = createContext<"radix" | "drawer">("radix");

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Ширина/доп. классы карточки (напр. «max-w-sm») */
  className?: string;
  hideClose?: boolean;
}

/** Единая модалка: десктоп — glass-карточка по центру, мобайл — vaul bottom-sheet со свайпом */
export function Modal({ open, onOpenChange, children, className, hideClose }: ModalProps) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    return (
      <ModalKindContext.Provider value="drawer">
        <Drawer.Root open={open} onOpenChange={onOpenChange}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md" />
            <Drawer.Content
              className={cn(
                "glass-strong fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-4xl outline-none",
                className,
              )}
            >
              <div className="mx-auto mt-2.5 mb-1 h-1 w-9 shrink-0 rounded-full bg-white/20" />
              {!hideClose && <ModalClose target="drawer" />}
              {children}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </ModalKindContext.Provider>
    );
  }

  return (
    <ModalKindContext.Provider value="radix">
      <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
        <AnimatePresence>
          {open && (
            <RadixDialog.Portal forceMount>
              <RadixDialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-md"
                />
              </RadixDialog.Overlay>
              <RadixDialog.Content
                asChild
                forceMount
                aria-describedby={undefined}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "calc(-50% + 18px)" }}
                  animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                  exit={{ opacity: 0, scale: 0.97, x: "-50%", y: "calc(-50% + 12px)" }}
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className={cn(
                    "glass-strong fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-4xl",
                    className,
                  )}
                >
                  {!hideClose && <ModalClose target="radix" />}
                  {children}
                </motion.div>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          )}
        </AnimatePresence>
      </RadixDialog.Root>
    </ModalKindContext.Provider>
  );
}

function ModalClose({ target }: { target: "radix" | "drawer" }) {
  const button = (
    <button
      aria-label="Закрыть"
      className="absolute top-4 right-4 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded-xl bg-white/6 text-fog-400 transition-colors hover:bg-white/12 hover:text-white"
    >
      <X className="h-4 w-4" />
    </button>
  );
  return target === "drawer" ? <Drawer.Close asChild>{button}</Drawer.Close> : <RadixDialog.Close asChild>{button}</RadixDialog.Close>;
}

/** Скролл-область модалки */
export function ModalBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto p-5 sm:p-6", className)} {...props} />;
}

/** Закреплённый низ (кнопки оплаты и т.п.) */
export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 border-t border-white/8 bg-ink-950/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6", className)}
      {...props}
    />
  );
}

function useModalKind() {
  return useContext(ModalKindContext);
}

/** Title/Description — корректный примитив Radix/Drawer для a11y */
export function ModalTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const kind = useModalKind();
  const Comp = kind === "drawer" ? Drawer.Title : RadixDialog.Title;
  return <Comp asChild><h2 className={cn("text-lg font-extrabold tracking-tight", className)} {...props} /></Comp>;
}

export function ModalDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const kind = useModalKind();
  const Comp = kind === "drawer" ? Drawer.Description : RadixDialog.Description;
  return <Comp asChild><p className={cn("text-sm text-fog-500", className)} {...props} /></Comp>;
}
```

Примечания:
- vaul (v1+) сам обрабатывает drag-to-dismiss на `Drawer.Content`; `rounded-t-4xl` + grabber — наш стиль шторки.
- `aria-describedby={undefined}` на Radix Content — чтобы не было warning при отсутствии Description.

- [ ] **Step 3: prefetch.ts**

```ts
import { api } from "@/lib/api";

/** Кэш промисов, чтобы модалки открывались с уже загруженными данными */
type Entry = { at: number; promise: Promise<unknown> };
const cache = new Map<string, Entry>();
const TTL = 60_000;

export function prefetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise as Promise<T>;
  const promise = loader().catch((cause) => {
    cache.delete(key);
    throw cause;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export const prefetchPublicConfig = () => prefetch("public-config", () => api.getPublicConfig());

export const prefetchConversionPreview = (
  token: string,
  args: Parameters<typeof api.clientTariffConversionPreview>[1],
) =>
  prefetch(
    `conversion:${args.tariffId}:${args.priceOptionId ?? ""}`,
    () => api.clientTariffConversionPreview(token, args),
  );
```

- [ ] **Step 4: success-dialog.tsx**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "./button";
import { Modal, ModalBody, ModalDescription, ModalTitle } from "./modal";

interface SuccessPayload {
  title: string;
  description?: string;
  onDone?: () => void;
}

const SuccessContext = createContext<{ show: (payload: SuccessPayload) => void } | null>(null);

/** Глобальное окно успеха: галка + заголовок + «Готово» (после покупок/зачислений) */
export function SuccessProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<SuccessPayload | null>(null);
  const show = useCallback((next: SuccessPayload) => setPayload(next), []);
  const close = useCallback(() => {
    setPayload((current) => {
      current?.onDone?.();
      return null;
    });
  }, []);

  return (
    <SuccessContext.Provider value={{ show }}>
      {children}
      <Modal open={payload !== null} onOpenChange={(open) => !open && close()} className="max-w-sm">
        <ModalBody className="p-7 text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-mint-500/15 text-mint-400 shadow-neon-mint"
          >
            <Check className="h-8 w-8" strokeWidth={3} />
          </motion.div>
          <ModalTitle className="mt-5 text-xl">{payload?.title ?? ""}</ModalTitle>
          {payload?.description && <ModalDescription className="mt-2">{payload.description}</ModalDescription>}
          <Button size="lg" className="mt-6 w-full" onClick={close}>
            Готово
          </Button>
        </ModalBody>
      </Modal>
    </SuccessContext.Provider>
  );
}

export function useSuccess() {
  const context = useContext(SuccessContext);
  if (!context) throw new Error("useSuccess must be used within SuccessProvider");
  return context;
}
```

- [ ] **Step 5: index.ts и подключение провайдера**

`ui/index.ts` дополнить:

```ts
export * from "./modal";
export * from "./success-dialog";
export * from "./prefetch";
```

В `frontend/src/cabinet/components/Layout.tsx`:
- импорт: `import { SuccessProvider } from "./ui/success-dialog";`
- в `Layout()` обернуть возвращаемый JSX: `<SuccessProvider>…существующее дерево…</SuccessProvider>`.

- [ ] **Step 6: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/components/ui frontend/src/cabinet/components/Layout.tsx frontend/src/cabinet/lib/use-media-query.ts
git commit -m "feat(cabinet): unified Modal (Radix+vaul), SuccessDialog, prefetch cache"
```

---

### Task 5: AppContext — softRefresh; сайдбар — анимированный баланс + «Пополнить»

**Files:**
- Modify: `frontend/src/cabinet/store/AppContext.tsx`
- Modify: `frontend/src/cabinet/components/Layout.tsx` (Sidebar: balance plate)

**Interfaces:**
- Consumes: `AnimatedNumber`, `Button`, `IconTile` (Task 1/3).
- Produces: `reload(opts?: { soft?: boolean })` — при `soft: true` не выставляет `loading` (без мигания). Все последующие таски используют `reload({ soft: true })` после мутаций.

- [ ] **Step 1: soft-режим reload**

В `AppContext.tsx`:
1. Сигнатура: `const reload = useCallback(async (opts?: { soft?: boolean }) => { if (!state.token) return; if (opts?.soft !== true) { setLoading(true); } setError(null); …` — остальное без изменений (`finally { setLoading(false); }` остаётся: при soft он просто выставит false поверх false).
2. В интерфейсе `AppState`: `reload: (opts?: { soft?: boolean }) => Promise<void>;`

- [ ] **Step 2: Баланс-плейт в Sidebar (Layout.tsx)**

Заменить текущий `NavLink`-блок «balance plate» (строки ~109-121) на:

```tsx
{/* balance plate */}
<div className="glass-inset mb-3 rounded-2xl p-4">
  <div className="flex items-center gap-3">
    <IconTile size="sm">
      <Wallet className="h-4 w-4" />
    </IconTile>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-wider text-fog-500 uppercase">Баланс</p>
      <p className="truncate text-lg font-extrabold">
        <AnimatedNumber value={user.balance} format={(v) => formatCurrency(v, user.currency)} />
      </p>
    </div>
  </div>
  <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate("/cabinet/profile#topup")}>
    Пополнить
  </Button>
</div>
```

Импорты в Layout.tsx: `import { AnimatedNumber } from "./ui/animated-number"; import { Button } from "./ui/button"; import { IconTile } from "./ui/icon-tile";`

- [ ] **Step 3: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/store/AppContext.tsx frontend/src/cabinet/components/Layout.tsx
git commit -m "feat(cabinet): soft refresh + animated balance with top-up in sidebar"
```

---

### Task 6: Дашборд (Cabinet.tsx) — «Быстрые действия», компактная подписка, устройства

**Files:**
- Modify: `frontend/src/cabinet/pages/Cabinet.tsx`

**Interfaces:**
- Consumes: `Card`-плейты через классы, `Button`, `IconTile`, `Progress`, `AnimatedNumber`, `EmptyState` (Tasks 1-4). `PlanDialog` из Tariffs остаётся как есть (обновляется в Tasks 7-8).

**Дизайн-решения:**
- Правая колонка: glass-плейт «Быстрые действия» — заголовок `text-base font-extrabold`, primary-кнопка «Продлить подписку» (size lg, иконка RefreshCw), ниже secondary-кнопки (size md, full-width): Докупить трафик (PackagePlus), Ключи доступа (KeyRound), Пробный период (Gift, если есть), Все тарифы (ShoppingBag). Иконки слева, текст по левому краю (`justify-start`).
- Главная карточка: масштаб по шкале — дни `text-5xl sm:text-6xl` через `AnimatedNumber`, `Progress` вместо `TrafficBar`, секции через `Separator`.
- Устройства: строки `IconTile size="sm"` + имя/статус + `Button variant="ghost" size="sm"` «Отключить».
- Пустые состояния (нет подписки / истёкший trial) — `EmptyState`.

- [ ] **Step 1: Удалить локальные дубли, заменить на ui-kit**

В `Cabinet.tsx`:
1. Удалить функцию `TrafficBar` — заменить использования на `<Progress value={sub.trafficUsedGB} max={limit} />` и `<Progress value={sub.whitelistUsedGB} max={sub.whitelistGB} tone="amber" />` (whitelist — amber-вариант: цвет как у chips whitelist).
2. `MainSubscriptionCard`: `glass-strong liquid … rounded-4xl p-5 min-[380px]:p-6 sm:p-7` → `glass-strong liquid … rounded-4xl p-5 sm:p-6`; блок цифры:
   ```tsx
   <span className="bg-gradient-to-br from-white to-fog-300 bg-clip-text text-5xl leading-none font-extrabold tracking-tight text-transparent min-[380px]:text-6xl">
     <AnimatedNumber value={sub.daysLeft} />
   </span>
   ```
   (остальная разметка дней/«до {expiresAt}» сохраняется).
3. Устройства `motion.li` — заменить кнопку «Отключить» на `<Button variant="ghost" size="sm" className="text-fog-500 hover:bg-red-500/10 hover:text-red-400" onClick={() => disconnectDevice(sub.id, d.id)}>Отключить</Button>`, иконку в `IconTile size="sm"`, `gap-4` → `gap-3`, стаггер `delay: 0.3 + i * 0.08` → `0.2 + i * 0.05`.
4. Блок истёкшего trial и «Подписка ещё не выбрана» → `EmptyState` (icon `Gift`/`Package`) с `Button`-экшенами внутри `children`.
5. Быстрые действия (правая колонка) — заменить список из `Link className="btn-primary/btn-ghost px-6 py-4 text-base"` на:

   ```tsx
   <section className="glass rounded-4xl p-5">
     <h3 className="text-base font-extrabold">Быстрые действия</h3>
     <div className="mt-4 flex flex-col gap-2.5">
       <Button size="lg" className="w-full justify-start" asChild={false} onClick={...}>
   ```
   Внимание: сейчас это `Link`-элементы с навигацией. Оставить их `Link`, но стилизованными через `buttonVariants`. Экспортировать из `button.tsx` хелпер: `export { buttonVariants };` и использовать:
   ```tsx
   <Link to="/cabinet/tariffs" className={cn(buttonVariants({ size: "lg" }), "w-full justify-start")}>
     <RefreshCw /> Продлить подписку
   </Link>
   <Link to="/cabinet/tariffs#traffic" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full justify-start")}>
     <PackagePlus /> Докупить трафик
   </Link>
   ```
   Логика «продлить» через `renewOpen`-диалог сохраняется: для «Продлить подписку» оставить `onClick` с `preventDefault` при `renewalPlan`.
6. Общие отступы страницы `gap-5` → `gap-4`, заголовок `text-3xl` → `text-2xl sm:text-3xl`.

- [ ] **Step 2: Сборка, визуальная проверка**

Run: `cd frontend && npm run build` → 0 ошибок. (Визуальная проверка — в Task 12.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/cabinet/pages/Cabinet.tsx frontend/src/cabinet/components/ui/button.tsx
git commit -m "feat(cabinet): dashboard quick actions + compact subscription card on ui-kit"
```

---

### Task 7: PlanDialog — шаг config (длительности + Stepper устройств)

**Files:**
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`

**Interfaces:**
- Consumes: `Modal/ModalBody/ModalTitle/ModalDescription`, `OptionCard`, `Stepper`, `Badge`, `Separator`, `Button`, `IconTile`, `prefetchPublicConfig`, `prefetchConversionPreview`, `useIsDesktop` не нужен напрямую.
- Produces: `PlanDialog` с теми же пропсами `{ plan, open, onOpenChange }` и неизменным `purchasePayload`/`purchaseMode` (логика выбора `days/extra/promo` сохраняется).

**Структура config-шага (компактная, пример #4 в сдержанной подаче):**

- [ ] **Step 1: Каркас модалки на Modal**

В `PlanDialog` заменить `Dialog.Root/Portal/Overlay/Content` на `Modal` (обёртка та же, `className="max-w-lg"`), `Dialog.Title/Description/Close` → `ModalTitle/ModalDescription` (крестик встроен в Modal, локальный `Dialog.Close` удалить), шаги `config/checkout/success` внутри `AnimatePresence` сохраняются. Успешный шаг (`step === "success"`) удаляется — вместо него `useSuccess().show(...)` (Task 8, Step 3).

- [ ] **Step 2: Prefetch вместо запросов при открытии**

1. `useEffect(() => { if (open) void api.getPublicConfig().then(setConfig)… }, [open])` → заменить на `useEffect(() => { void prefetchPublicConfig().then(setConfig).catch(() => undefined); }, [open])` (кэш делает повторные открытия мгновенными).
2. В `Tariffs.tsx` (страница) при монтировании: `useEffect(() => { void prefetchPublicConfig().catch(() => undefined); }, []);`
3. В `PlanRow` кнопку «Оплатить» — греть кэш конвертации до открытия: `onPointerDown={() => state.token && plan && void prefetchConversionPreview(state.token, { tariffId: plan.id, priceOptionId: plan.durationOptions[0]?.id }).catch(() => undefined)}` (в `PlanRow` добавить `const { state } = useClientAuth();`). Эффект conversion-preview в `PlanDialog` перевести на `prefetchConversionPreview` с тем же ключом.
4. Чтобы заголовок не прыгал, когда preview ещё не готов: блок конвертации рендерить только если `conversion` уже есть (текущее поведение), а высоту summary не зависящей от него — «Добавится конвертацией» показывать внутри существующей строки summary (не добавлять новые блоки после откры­тия).

- [ ] **Step 3: Длительности на OptionCard**

Заменить ручные кнопки длительности на:

```tsx
<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
  {plan.durationOptions.map((d) => {
    const p = durationPrice(plan, d.days, extra);
    // скидка показываем только если она реально уменьшает цену/день относительно 30-дневного уровня
    const discount = d.discountPercent ?? 0;
    return (
      <OptionCard key={d.days} selected={days === d.days} badge={discount > 0 ? `−${discount}%` : undefined} onClick={() => setDays(d.days)}>
        <p className="text-sm font-extrabold">{d.days} дней</p>
        <p className="mt-0.5 text-xs font-bold text-fog-300">{formatMoney(p, plan.currency)}</p>
        <p className="text-[10px] text-fog-600">{formatMoney(p / d.days, plan.currency)}/день</p>
      </OptionCard>
    );
  })}
</div>
```

Проверить тип `TariffDuration` в `model.ts`: если у опции нет поля `discountPercent` — вычислять на месте: `const discount = Math.round((1 - d.price / d.days / (plan.durationOptions[0].price / plan.durationOptions[0].days)) * 100)` и показывать бейдж при `discount >= 5` (порог осмысленности). Использовать этот вариант, если поле отсутствует (не добавлять новых полей в API-типы).

Заголовки секций — сдержанный стиль: `<p className="mb-2 text-xs font-semibold text-fog-500">Длительность</p>` (без caps/uppercase, без иконки).

- [ ] **Step 4: Устройства — Stepper вместо сетки карточек**

Заменить сетку `Array.from({ length: plan.maxExtraDevices + 1 }…)` на:

```tsx
<div className="mt-4 mb-2 flex items-baseline justify-between">
  <p className="text-xs font-semibold text-fog-500">Доп. устройства</p>
  <span className="text-xs text-fog-600">+{formatMoney(plan.pricePerExtraDevice, plan.currency)}/мес за устройство</span>
</div>
<Stepper
  label="Дополнительные устройства"
  value={extra}
  max={plan.maxExtraDevices}
  onChange={setExtra}
  hint={
    extraQuote.discountPercent > 0
      ? <span className="font-bold text-mint-400">скидка {extraQuote.discountPercent}%</span>
      : <span>{plan.baseDevices + extra} устр. всего</span>
  }
/>
```

где `const extraQuote = quoteTariff(plan, days, extra);` считается от текущего значения. Скидка по мере добавления применяется сама (`quoteTariff` учитывает tiers) — цена в итоге растёт уменьшающимися шагами, бейджи не нужны.

- [ ] **Step 5: Итог + оферта + кнопка**

1. Summary-блок (`glass-inset`): строки «Длительность / Тариф (N устр)» — сохранить; крупную градиентную цифру `text-3xl` уменьшить до `text-2xl`; конвертацию оставить строкой.
2. Чекбокс оферты → компонент `Checkbox` (Task 2), текст без изменений.
3. Кнопка «Перейти к оплате · {price}» → `<Button size="lg" disabled={!agreed} className="mt-4 w-full" onClick={() => setStep("checkout")}>Перейти к оплате · {formatMoney(priceBeforePromo, plan.currency)}</Button>`.

- [ ] **Step 6: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/pages/Tariffs.tsx
git commit -m "feat(cabinet): PlanDialog config step — OptionCard durations + device Stepper"
```

---

### Task 8: PlanDialog — шаг checkout и SuccessDialog

**Files:**
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`

**Interfaces:**
- Consumes: `Modal*`, `Button(loading)`, `Field`, `Input`, `AnimatedNumber`, `useSuccess`, `Separator`.
- Produces: checkout-шаг структурой как пример #15: «← Изменить конфигурацию», сводка, промокод (Enter), «С баланса», Platega-блок (СБП/Карта — крупный, сохраняем), ряды CryptoBot/RollyPay. Успех — через `useSuccess`.

- [ ] **Step 1: Сводка и промокод**

1. «Итого к оплате» — вместо `text-4xl` цифры и плиток «Срок/Трафик» (пример #14 перегружен) сделать компактную сводку-плейт (как #15):

```tsx
<div className="glass-inset rounded-2xl p-4">
  <div className="flex justify-between text-sm"><span className="text-fog-500">Тариф, {days} дней</span><span className="font-bold">{formatMoney(basePrice, plan.currency)}</span></div>
  {extra > 0 && <div className="mt-1 flex justify-between text-sm"><span className="text-fog-500">Доп. устройства ×{extra}</span><span className="font-bold">{formatMoney(quote.extras, plan.currency)}</span></div>}
  {conversionExtraCost > 0 && <div className="mt-1 flex justify-between text-sm"><span className="text-fog-500">Сохранение устройств</span><span className="font-bold">{formatMoney(conversionExtraCost, plan.currency)}</span></div>}
  <Separator className="my-3" />
  <div className="flex items-baseline justify-between"><span className="font-bold">Итого</span><span className="text-xl font-extrabold">{formatMoney(price, plan.currency)}{discountPercent > 0 && <span className="ml-2 text-sm font-bold text-mint-400">−{discountPercent}%</span>}</span></div>
</div>
```

2. Информеры (продление `ownedSub`, конвертация, keep/drop extras, выбор trial) — сохранить логику и пейлоады, но сверстать компактнее: `rounded-2xl p-3.5`, `text-xs` описания, иконки в `IconTile size="sm"`.
3. Промокод — форма с Enter:

```tsx
<form onSubmit={(e) => { e.preventDefault(); void applyPromo(); }} className="mt-4 flex gap-2">
  <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Промокод" className="flex-1" />
  <Button variant="secondary" type="submit">Применить</Button>
</form>
```

- [ ] **Step 2: Способы оплаты**

1. «С баланса» — строка (не оранжевый гигант):

```tsx
{user.balance > 0 && (
  <Button variant="secondary" size="lg" className="w-full justify-between" loading={paying} loadingText="Оплата…" disabled={user.balance < price} onClick={payBalance}>
    <span className="flex items-center gap-2"><Wallet /> С баланса</span>
    <AnimatedNumber value={user.balance} format={(v) => `${v.toLocaleString("ru-RU")} ₽`} />
  </Button>
)}
```

2. Platega-блок — сохранить существующую разметку (icon-tile + «Рекомендуем» + крупные `СБП`/`Карта`), но кнопки перевести на `<Button size="lg" loading={paying} loadingText="Оплата…">` с сохранением под-подписей (`по QR-коду`, `RUB · любой банк`) как `block text-[10px]`. Кнопки имеют вертикальную компоновку — обернуть содержимое в `<span className="flex flex-col items-center">`.
3. «Оплатить криптой через Platega» и `otherPlategaMethods` — `Button variant="link"`/`variant="outline" size="sm"`.
4. CryptoBot / RollyPay — ряды `Button variant="secondary" size="lg" className="w-full justify-start"` c `IconTile size="sm"` тоном amber/emerald внутри ( tones через className) и подписью справа (`USDT · TON · BTC` / `Оплата в рублях`).
5. Все платёжные обработчики (`payBalance`, `openPayment`, `payPlatega`, `payCryptoBot`, `payRollyPay`) — без изменений, кроме успешной ветки баланса (Step 3).

- [ ] **Step 3: Успех через SuccessDialog**

В `payBalance` после успешной оплаты вместо `onOpenChange(false); reset(); navigate(...); toast(...)`:

```tsx
toast.dismiss не нужен; заменить toast на:
show({
  title: "Оплата прошла",
  description: result.message,
  onDone: () => {
    onOpenChange(false);
    reset();
    navigate("/cabinet/dashboard?payment=success");
  },
});
void Promise.all([refreshProfile(), reload({ soft: true })]).catch(() => undefined);
```

`const { show } = useSuccess();` в начале `PlanDialog`. Шаг `"success"` из union-типа state удалить вместе с его JSX. Модалка закрывается по `onDone` — баланс в сайдбаре доедет анимацией (Task 5).

- [ ] **Step 4: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/pages/Tariffs.tsx
git commit -m "feat(cabinet): PlanDialog checkout on ui-kit + SuccessDialog after purchase"
```

---

### Task 9: Services.tsx — трафик-диалог, CheckoutActions, формы

**Files:**
- Modify: `frontend/src/cabinet/pages/Services.tsx`

**Interfaces:**
- Consumes: `Modal*`, `Button`, `Input`, `Textarea`, `Field`, `IconTile`, `Progress` (не нужен), `useSuccess`, `prefetchPublicConfig`.

- [ ] **Step 1: TrafficOptionDialog на Modal + SuccessDialog**

1. Каркас `Dialog.*` → `Modal` (как в Task 7 Step 1).
2. Шаг `success` удалить; в `payBalance` при успехе: `show({ title: "Трафик зачислен", description: `Пакет «${option.name}» добавлен к выбранной подписке.`, onDone: () => onOpenChange(false) })` + `void Promise.all([refreshProfile(), reload({ soft: true })])` (уже есть — заменить `reload()` на `reload({ soft: true })`).
3. Способ оплаты — та же схема, что Task 8 Step 2 (баланс-строка, Platega-блок с крупными СБП/Карта, CryptoBot/RollyPay рядами). `onFocusOutside preventDefault` больше не нужен — убрать.
4. Prefetch: в `ExtraOptions` при монтировании `void prefetchPublicConfig().catch(...)`; `config` для методов брать из `useApp()` (уже берётся) — запрос при открытии диалога не выполняется, ничего не прыгает.

- [ ] **Step 2: CheckoutActions и формы страницы**

1. `CheckoutActions`: все 4 кнопки → `Button` (`С баланса` — `variant="secondary" className="w-full justify-between"`, Platega — `variant="primary"`, CryptoBot/RollyPay — `variant="ghost"`), `loading/оpлатa…` через `loading` + `loadingText="Оплата…"`, `disabled` сохраняется. Успех `finishBalance` → `show({ title: result.message, onDone: () => undefined })` (окно не закрыто, просто подтверждение) + `reload({ soft: true })`.
2. `Gifts`: «Активировать код» — `<form onSubmit>` (Enter), `Input` + `Button type="submit" loading={loading}`; остальные кнопки → `Button`.
3. `Tickets`: `input/textarea` → `Input`/`Textarea`; создать/ответить — `<form onSubmit>` + `Button type="submit" loading`.
4. `Range` (CustomBuild): стилизовать `accent-violet-500` вместо `accent-blue-500`; остальное без изменений.
5. `TrafficCard`/карточки тарифов: кнопка «Оплатить» → `Button variant={whitelist ? "success" : "secondary"}` (белая secondary-кнопка заменяет `bg-white/90`), `text-3xl` цены → `text-2xl`.

- [ ] **Step 3: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/pages/Services.tsx
git commit -m "feat(cabinet): services page on ui-kit — traffic dialog, loading buttons, forms"
```

---

### Task 10: Keys.tsx, Referrals.tsx, trials-picker-dialog

**Files:**
- Modify: `frontend/src/cabinet/pages/Keys.tsx`
- Modify: `frontend/src/cabinet/pages/Referrals.tsx`
- Modify: `frontend/src/components/cabinet/trials-picker-dialog.tsx`

- [ ] **Step 1: Keys.tsx**

1. Все `btn-primary/btn-ghost` кнопки → `Button` (механическая замена, размеры: рядовые — `sm`, главные CTA — `md`).
2. `input-glass` → `Input` (поля поиска/ссылок, если есть).
3. Карточки `glass rounded-… p-5` → сохранить классы (Card-плейт на классах допустим, компонент `Card` не вводим — YAGNI: UI-плейты уже единообразны классами).
4. Скалярные `Loader2`-паттерны при наличии — через `Button loading`.

- [ ] **Step 2: trials-picker-dialog.tsx**

1. `Dialog.*` → `Modal` + `ModalBody/Title/Description`.
2. Кнопки активации → `Button loading` (состояние загрузки триала: `activatingId === trial.id`).
3. Успех остаётся через колбэк `onActivated` (тост в Cabinet) — дополнительно вызвать `useSuccess().show({ title: message })` нельзя (провайдер вне — он в Layout, доступен): вызвать `show` и убрать toast-дублирование в `Cabinet.tsx` (оставить только `show`).

- [ ] **Step 3: Referrals.tsx**

1. Форма вывода — `<form onSubmit>`: `Input` (сумма), `Input` (TRC20-кошелёк), `Button type="submit" loading={withdrawing}` «Отправить заявку»; валидации в `disabled` сохранить.
2. Кнопки копирования → `CopyButton`/`Button variant="ghost" size="sm"`.

- [ ] **Step 4: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/pages/Keys.tsx frontend/src/cabinet/pages/Referrals.tsx frontend/src/components/cabinet/trials-picker-dialog.tsx frontend/src/cabinet/pages/Cabinet.tsx
git commit -m "feat(cabinet): keys/referrals/trials on ui-kit"
```

---

### Task 11: Profile.tsx — SecurityDialog, Switch, TopUp, формы

**Files:**
- Modify: `frontend/src/cabinet/pages/Profile.tsx`

- [ ] **Step 1: Каркас и модалки**

1. `SecurityDialog` и второй диалог (строка ~647) → `Modal`/`ModalBody`/`ModalTitle/Description`; кнопки → `Button loading`.
2. `Switch.Root/Thumb` (строки ~497-503) → компонент `Switch`.
3. Ручные чекбоксы/инпуты (`input-glass` ~27 использований на странице в т.ч. TopUp/AccountData) → `Input`/`Field`.
4. Секция `TopUp`: добавить `id="topup"` и `scroll-mt-6` на корневой элемент секции (цель кнопки «Пополнить» из сайдбара). В `Profile` при монтировании: если `location.hash === "#topup"` — `document.getElementById("topup")?.scrollIntoView({ block: "start" })`.
5. Все сабмиты (смена email/пароля/2FA, вывод) — `<form onSubmit>` с Enter.

- [ ] **Step 2: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet/pages/Profile.tsx
git commit -m "feat(cabinet): profile on ui-kit — modal, switch, forms with Enter, #topup anchor"
```

---

### Task 12: Auth.tsx + AccountFlows.tsx + финальная шкала и зачистка

**Files:**
- Modify: `frontend/src/cabinet/pages/Auth.tsx`
- Modify: `frontend/src/cabinet/pages/AccountFlows.tsx`
- Modify: `frontend/src/cabinet.css`
- Modify: `frontend/src/cabinet/pages/Tariffs.tsx`, `Keys.tsx`, `Referrals.tsx`, `Profile.tsx` (заголовки страниц)

- [ ] **Step 1: Auth/AccountFlows**

1. Все `input-glass` → `Input`; все `btn-primary` → `Button` (с `loading` и `loadingText` вместо тернарников «Отправляем…»).
2. Каждая форма → `<form onSubmit={submit}>` (Enter): логин, регистрация, 2FA-код, forgot/reset password, настройка аккаунта.
3. Инпут 2FA (6 цифр, `tracking-[0.5em]`) — `Input` с теми же классами.
4. Диалоги в Auth (если есть `Dialog`) → `Modal`.

- [ ] **Step 2: Шкала заголовков и зачистка**

1. По всем кабинетным страницам: `h1 … text-3xl` → `text-2xl sm:text-3xl`; подзаголовки `mt-1 text-fog-500` оставить.
2. В `cabinet.css` поправить масштаб кнопок под новые heights: `btn-primary`/`btn-ghost` больше не несут вертикальный паддинг из страниц (высоту задаёт `Button size`), проверить, что в CSS нет `padding` в `btn-primary` (его нет — паддинги были утилитами) — убедиться, что нигде не осталось `px-6 py-4` рядом с `Button`.
3. `grep -rn "btn-primary\|btn-ghost\|input-glass" frontend/src/cabinet` — ожидаются только вхождения внутри `components/ui/*` (и `Services.tsx` `Range`, если оставлен акцент) — прямое использование в страницах устранить.

- [ ] **Step 3: Сборка, коммит**

Run: `cd frontend && npm run build` → 0 ошибок.

```bash
git add frontend/src/cabinet
git commit -m "feat(cabinet): auth flows on ui-kit + restrained type scale"
```

---

### Task 13: Сквозная проверка (Playwright MCP) и фиксы

**Files:**
- Modify: любые файлы кабинета по результатам проверки (точечные фиксы).

- [ ] **Step 1: Поднять стенд**

```bash
cd frontend && npm run build && npm run preview &   # или npm run dev, если нужен реальный бэкенд
```

Если для API нужен прод-бэкенд — проверять на `https://bot.lazeika.xyz/cabinet/dashboard` (Playwright MCP), локальные правки оценивать визуально на dev-сборке с моками не требуется: минимальный набор проверок выполняется на проде после деплоя ветки владельцем; локально — dev-сервер с доступным API.

- [ ] **Step 2: Чек-лист Playwright (desktop 1440×900 и mobile 390×844)**

1. `/cabinet/dashboard`: сетка 2 колонки, «Быстрые действия» справа; баланс в сайдбаре с кнопкой «Пополнить»; цифры дней читаются, ничего не обрезано.
2. Открыть «Продлить подписку»: модалка открывается мгновенно (без появления блоков), длительности — компактные карточки, устройства — Stepper; нажать «−/+» — подсказка скидки меняется.
3. «Перейти к оплате»: сводка/промокод (Enter применяет)/«С баланса»/Platega-блок на месте; повторный клик по кнопке с `loading` невозможен.
4. На мобильном: модалка — bottom-sheet, свайп вниз закрывает с пружиной; футер «К оплате» закреплён.
5. Alt-путь: если есть тестовый баланс — купить с баланса: SuccessDialog с галкой, после «Готово» — редирект на дашборд, баланс в сайдбаре анимированно меняется, данные обновились без мигания (нет скелетона).
6. «Докупить трафик» → карточка пакета → диалог → SUCCESS-диалог после оплаты балансом.
7. Профиль: «Пополнить» из сайдбара скроллит к `#topup`; SecurityDialog открывается; Switch переключается; смена пароля сабмитится Enter-ом.
8. Клавиатура: Tab по модалке — фокус не выходит за неё; Esc закрывает.

- [ ] **Step 3: Зафиксировать результаты**

Каждый пункт чек-листа: passes → отметить; fail → точечный фикс + `npm run build` + повторная проверка пункта.

- [ ] **Step 4: Финальный коммит**

```bash
git add -A frontend/src/cabinet
git commit -m "fix(cabinet): polish pass after end-to-end ui review"
```

---

## Self-Review

- **Spec coverage:** ui-kit полный (Tasks 1-4) ✓; сдержанный масштаб (Tasks 6, 12) ✓; модалки+vaul+prefetch (Task 4, 7, 8, 9) ✓; SuccessDialog+анимированный баланс+«Пополнить» (Tasks 4, 5, 8, 9) ✓; дашборд «Быстрые действия» (Task 6) ✓; Stepper устройств со скидкой (Task 7) ✓; checkout как #15 с нашей компоновкой (Task 8) ✓; Enter-формы и cursor-pointer (Tasks 1, 2, 8-12) ✓; soft-refresh (Task 5, применяется в 8-9) ✓.
- **Placeholders:** нет «TBD»; шаги с кодом содержат код; для механических замен указан точный маппинг класс → компонент.
- **Type consistency:** `reload({ soft: true })` введён в Task 5 и используется далее; `Modal/ModalBody/ModalTitle/ModalDescription/ModalFooter` — единые имена во всех тасках; `useSuccess().show({title, description?, onDone?})` — одинаково в 8/9/10.
