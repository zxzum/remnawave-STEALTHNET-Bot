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
