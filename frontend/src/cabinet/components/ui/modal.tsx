import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
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
