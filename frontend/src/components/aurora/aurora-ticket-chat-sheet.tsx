import type { ReactNode } from "react";
import { AuroraSheet } from "@/components/aurora/aurora-sheet";

export interface AuroraTicketChatSheetProps {
  open: boolean;
  ticketId: string | null;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Presentation-only ticket chat sheet; ticket API logic stays in the shared page. */
export function AuroraTicketChatSheet({ open, ticketId, onClose, children, footer }: AuroraTicketChatSheetProps) {
  return (
    <AuroraSheet open={open} onClose={onClose} title={ticketId ? "Обращение" : "Поддержка"} footer={footer}>
      {children ?? <p className="py-6 text-sm text-[var(--au-muted)]">Откройте обращение в текущем разделе поддержки.</p>}
    </AuroraSheet>
  );
}
