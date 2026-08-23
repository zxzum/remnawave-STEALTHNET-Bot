import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export interface AuroraSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** Small accessible bottom-sheet primitive for the opt-in Aurora shell. */
export function AuroraSheet({ open, onClose, title, footer, children }: AuroraSheetProps) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[56] mx-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[28px] bg-[var(--au-bg)] pt-3 text-[var(--au-ink)] shadow-2xl outline-none"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-[var(--au-surface)]" />

          <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
            <Dialog.Title className={title ? "min-w-0 flex-1 truncate text-[19px] font-extrabold" : "sr-only"}>
              {title ?? "Лазейка ВПН"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрыть"
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--au-surface)] text-[var(--au-muted)] transition-transform active:scale-95"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5">{children}</div>
          {footer && <div className="shrink-0 px-5 pt-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
