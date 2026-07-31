import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn";
import { useApp } from "../../store/AppContext";

/** Большая кнопка копирования с анимацией успеха: зелёная, галочка, ripple-конфетти. */
export function CopyButton({
  text,
  label = "Скопировать ключ",
  successLabel = "Скопировано!",
  className,
}: {
  text: string;
  label?: string;
  successLabel?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  const { copy } = useApp();

  const handle = async () => {
    await copy(text, "Ключ скопирован в буфер обмена");
    setDone(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 2200);
  };

  return (
    <motion.button
      onClick={handle}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "relative w-full overflow-hidden rounded-[1.4rem] px-6 py-4 text-base font-bold transition-colors duration-300",
        done ? "btn-success" : "btn-primary",
        className,
      )}
    >
      {/* success burst */}
      <AnimatePresence>
        {done && (
          <motion.span
            key="burst"
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {[...Array(8)].map((_, i) => (
              <motion.span
                key={i}
                className="absolute h-1.5 w-1.5 rounded-full bg-white/90"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos((i / 8) * Math.PI * 2) * 64,
                  y: Math.sin((i / 8) * Math.PI * 2) * 30,
                  opacity: 0,
                  scale: 0.4,
                }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="ok"
            className="relative z-10 flex items-center justify-center gap-2"
            initial={{ opacity: 0, y: 12, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          >
            <motion.span
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 600, damping: 20, delay: 0.05 }}
            >
              <Check className="h-5 w-5" strokeWidth={3} />
            </motion.span>
            {successLabel}
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className="relative z-10 flex items-center justify-center gap-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.15 }}
          >
            <Copy className="h-5 w-5" />
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** Компактная иконка копирования с вспышкой галочки. */
export function CopyIconButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const { copy } = useApp();

  const handle = async () => {
    await copy(text, label);
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  };

  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={handle}
      aria-label={label ?? "Скопировать"}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors duration-300",
        done
          ? "border-mint-400/40 bg-mint-500/15 text-mint-400 shadow-neon-mint"
          : "border-white/10 bg-white/5 text-fog-300 hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "check" : "copy"}
          initial={{ scale: 0.4, opacity: 0, rotate: done ? -60 : 0 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 24 }}
        >
          {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Copy className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
