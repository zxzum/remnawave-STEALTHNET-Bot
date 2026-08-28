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
