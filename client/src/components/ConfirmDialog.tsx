import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Verb-first label for the destructive action, e.g. "Leave match". */
  confirmLabel: string;
  /** Label for backing out, e.g. "Keep playing". */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation for destructive actions. Built on the native <dialog>
 * so focus is trapped, Escape cancels and focus returns to the opener for
 * free. The safe choice gets initial focus, so a stray Enter never confirms.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape fires "cancel"; keep React state in charge of open/closed.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A tap on the backdrop (outside the panel) backs out too.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-sm rounded-md border-2 border-ink bg-card p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="font-display text-2xl font-extrabold">
          {title}
        </h2>
        <div id={bodyId} className="space-y-2 text-sm leading-relaxed">
          {children}
        </div>
        <div className="flex flex-col gap-3 pt-1">
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
