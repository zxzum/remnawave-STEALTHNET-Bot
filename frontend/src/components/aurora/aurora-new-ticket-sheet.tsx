import type { ReactNode } from "react";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";

export interface AuroraNewTicketSheetProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  onCreated?: (id: string) => void;
}

/** Presentation-only ticket sheet; the existing Tickets page owns ticket mutations. */
export function AuroraNewTicketSheet({ open, onClose, children, footer }: AuroraNewTicketSheetProps) {
  return (
    <AuroraSheet open={open} onClose={onClose} title="Новое обращение" footer={footer}>
      {children ?? <p className="py-6 text-sm text-[var(--au-muted)]">Создайте обращение через текущую форму поддержки.</p>}
    </AuroraSheet>
  );
}
