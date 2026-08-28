import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../../lib/cn";
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
  const text = value === 0 ? "Без доп." : `+${value}`;
  return (
    <div className="glass-inset flex items-center gap-3 rounded-2xl p-2">
      {/* Левая зона — фикс. ширины: значение не меняет ширину ряда, «+» не ездит */}
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="icon" aria-label={`Уменьшить: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus />
        </Button>
        {/* Значение — фикс. w-16 по центру, цифра «перетекает» при −/+ (popLayout: уходящая уходит из потока) */}
        <div className="relative flex h-9 w-16 items-center justify-center overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={text}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -6, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn("text-center font-extrabold leading-none", value === 0 ? "text-sm" : "text-lg")}
            >
              {text}
            </motion.span>
          </AnimatePresence>
        </div>
        <Button variant="secondary" size="icon" aria-label={`Увеличить: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus />
        </Button>
      </div>
      {/* Подсказка/цена — отдельная правая зона, не между кнопками */}
      {hint && <div className="ml-auto pr-2 text-right text-xs text-fog-500">{hint}</div>}
    </div>
  );
}
