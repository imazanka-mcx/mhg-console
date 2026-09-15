'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { signInAction, type LoginState } from './actions.ts';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useFormState<LoginState, FormData>(signInAction, {});
  const input =
    'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <form action={action} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow-sm">
      <div>
        <div className="text-sm font-semibold text-slate-900">MHG Corporate Console</div>
        <p className="mt-1 text-xs text-slate-500">
          Access is granted by someone who already has it. There is no sign-up.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={input} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>

      {state.error ? <p className="text-xs text-danger-600">{state.error}</p> : null}

      <Submit />
    </form>
  );
}
