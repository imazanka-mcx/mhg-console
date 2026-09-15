'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { revokeAction, type ProvisionState } from './actions.ts';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-slate-400 underline-offset-2 hover:text-danger-600 hover:underline disabled:opacity-50"
    >
      {pending ? 'Closing…' : 'Close'}
    </button>
  );
}

export function RevokeButton({ grantId }: { grantId: string }) {
  const [state, action] = useFormState<ProvisionState, FormData>(revokeAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="grantId" value={grantId} />
      <Submit />
      {state.error ? <span className="ml-2 text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}
