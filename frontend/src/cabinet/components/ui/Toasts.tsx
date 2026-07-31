import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useApp } from "../../store/AppContext";
import { cn } from "../../lib/cn";

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-mint-400" />,
  error: <AlertCircle className="h-5 w-5 text-red-400" />,
  info: <Info className="h-5 w-5 text-accent-400" />,
};

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className={cn(
              "glass-strong pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3",
              t.variant === "success" && "border-mint-400/30 shadow-neon-mint",
              t.variant === "error" && "border-red-400/30",
            )}
          >
            {icons[t.variant]}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{t.title}</p>
              {t.description && <p className="truncate text-xs text-fog-500">{t.description}</p>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="rounded-lg p-1 text-fog-600 transition-colors hover:bg-white/10 hover:text-fog-100"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
