"use client";

import { useEffect, useRef } from "react";

/** The public site's dialog (the admin page keeps using Modal): a bottom sheet on a phone, a centred card on a desktop. Esc or a tap outside closes it. */
export default function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog className="x-dialog" ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="x-sheet">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
