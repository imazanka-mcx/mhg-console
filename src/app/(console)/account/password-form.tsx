'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { changePasswordAction, type AccountState } from './actions.ts';

const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Changing…' : 'Change password'}
    </button>
  );
}

export function PasswordForm() {
  const [state, action] = useFormState<AccountState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="mt-6 max-w-md space-y-4 rounded-lg bg-white p-6 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="current">
          Current password
        </label>
        <input id="current" name="current" type="password" required autoComplete="current-password" className={INPUT} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="next">
          New password
        </label>
        <input id="next" name="next" type="password" required autoComplete="new-password" className={INPUT} />
        <p className="mt-1 text-xs text-slate-400">At least 12 characters. Length is what matters.</p>
      </div>
      {state.error ? <p className="text-sm text-danger-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-success-700">{state.ok}</p> : null}
      <Submit />
    </form>
  );
}
