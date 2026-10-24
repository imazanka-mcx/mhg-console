'use client';

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { inviteAction, type ProvisionState } from './actions.ts';
import { GrantFields, INPUT, LABEL, type GroupOption, type RoleOption } from './grant-fields.tsx';

export type { GroupOption } from './grant-fields.tsx';

const SECONDARY =
  'rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Granting…' : 'Grant access'}
    </button>
  );
}

/**
 * The grant form lives behind "+ New user" rather than sitting open at the top
 * of the page — granting is occasional, reading the list is constant. A native
 * <dialog> gives the focus trap, Escape and the backdrop for free.
 */
export function ProvisionForms({
  roles,
  groups,
}: {
  roles: RoleOption[];
  groups: GroupOption[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Bumped on every close so the next open starts from an empty form and no
  // leftover one-time password.
  const [session, setSession] = useState(0);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="shrink-0 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        + New user
      </button>

      <dialog
        ref={dialog}
        onClose={() => setSession((s) => s + 1)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        aria-labelledby="new-user-title"
        className="w-full max-w-2xl rounded-lg bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
      >
        <ProvisionForm key={session} roles={roles} groups={groups} onClose={close} />
      </dialog>
    </>
  );
}

function ProvisionForm({
  roles,
  groups,
  onClose,
}: {
  roles: RoleOption[];
  groups: GroupOption[];
  onClose: () => void;
}) {
  const [state, action] = useFormState<ProvisionState, FormData>(inviteAction, {});
  const done = Boolean(state.ok);

  return (
    <form action={action} className="max-h-[85vh] overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="new-user-title" className="text-sm font-semibold text-slate-900">
            Grant access
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            An existing person gets another grant. A new one is created and invited.
          </p>
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

      {done ? null : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="name">
                Name
              </label>
              <input id="name" name="name" required maxLength={120} autoFocus className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="email">
                Email
              </label>
              <input id="email" name="email" type="email" required className={INPUT} />
            </div>
          </div>

          <GrantFields roles={roles} groups={groups} />

          <div className="mt-4">
            <label className={LABEL} htmlFor="reason">
              Reason
            </label>
            <input
              id="reason"
              name="reason"
              required
              maxLength={280}
              placeholder="Joining corporate as registrar"
              className={INPUT}
            />
            <p className="mt-1 text-xs text-slate-400">
              Recorded against the grant. This is the audit trail.
            </p>
          </div>
        </>
      )}

      {state.error ? <p className="mt-4 text-sm text-danger-700">{state.error}</p> : null}
      {state.ok ? <p className="mt-4 text-sm text-success-700">{state.ok}</p> : null}
      {state.tempPassword ? (
        <div className="mt-3 rounded border border-warning-200 bg-warning-50 p-4">
          <p className="text-xs font-medium text-warning-800">
            One-time password — shown once, and not recoverable.
          </p>
          <p className="mt-2 select-all font-mono text-lg tracking-tight text-slate-900">
            {state.tempPassword}
          </p>
          <p className="mt-2 text-xs text-warning-700">
            Pass it on directly, not by email. They change it under Account on first sign-in.
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-3">
        {done ? (
          <button type="button" onClick={onClose} className={SECONDARY}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={SECONDARY}>
              Cancel
            </button>
            <Submit />
          </>
        )}
      </div>
    </form>
  );
}
