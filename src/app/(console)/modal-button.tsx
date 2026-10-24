'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * "+ New …" behind a button instead of a form that sits open on the page —
 * creating is occasional, reading the list is constant. A native <dialog>
 * gives the focus trap, Escape and the backdrop for free. The body remounts on
 * every close, so the next open starts empty with no leftover result.
 *
 * `children` gets `close`, so the form's Cancel and Done can dismiss it.
 */
export function ModalButton({
  label,
  labelledBy,
  children,
}: {
  label: string;
  /** id of the heading inside the dialog, for aria-labelledby. */
  labelledBy: string;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="shrink-0 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setSession((s) => s + 1)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        aria-labelledby={labelledBy}
        className="w-full max-w-2xl rounded-lg bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
      >
        <div key={session}>{children(close)}</div>
      </dialog>
    </>
  );
}

/** The dialog's title row: heading, a line of context, and the × button. */
export function ModalHeader({
  id,
  title,
  children,
  onClose,
}: {
  id: string;
  title: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {children ? <p className="mt-1 text-xs text-slate-500">{children}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-2 -mt-1 rounded px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
      >
        ×
      </button>
    </div>
  );
}

export const SECONDARY =
  'rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
