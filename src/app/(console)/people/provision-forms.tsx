'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { inviteAction, type ProvisionState } from './actions.ts';

interface RoleOption {
  key: string;
  name: string;
  description: string;
  assignableAt: readonly string[];
}

const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-500';

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

export function ProvisionForms({ roles }: { roles: RoleOption[] }) {
  const [state, action] = useFormState<ProvisionState, FormData>(inviteAction, {});
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? '');

  const role = roles.find((r) => r.key === roleKey);
  const scopes = role?.assignableAt ?? ['portfolio'];
  const [scope, setScope] = useState<string>(scopes[0] ?? 'portfolio');
  const effectiveScope = scopes.includes(scope) ? scope : (scopes[0] ?? 'portfolio');

  return (
    <form action={action} className="mt-6 rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Grant access</h2>
      <p className="mt-1 text-xs text-slate-500">
        An existing person gets another grant. A new one is created and invited.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="name">
            Name
          </label>
          <input id="name" name="name" required maxLength={120} className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className={INPUT} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="roleKey">
            Role
          </label>
          <select
            id="roleKey"
            name="roleKey"
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            className={INPUT}
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          {role ? <p className="mt-1 text-xs text-slate-400">{role.description}</p> : null}
        </div>
        <div>
          <label className={LABEL} htmlFor="scope">
            Scope
          </label>
          <select
            id="scope"
            name="scope"
            value={effectiveScope}
            onChange={(e) => setScope(e.target.value)}
            className={INPUT}
          >
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            {scopes.length === 1
              ? `This role is only assignable at ${scopes[0]}.`
              : 'Narrower is safer — a grant covers everything under its scope.'}
          </p>
        </div>
      </div>

      {effectiveScope !== 'portfolio' ? (
        <div className="mt-4">
          <label className={LABEL} htmlFor="scopeRef">
            {effectiveScope === 'property' ? 'Inn code' : 'Group'}
          </label>
          <input
            id="scopeRef"
            name="scopeRef"
            maxLength={64}
            placeholder={effectiveScope === 'property' ? 'EVVBC' : 'grp_midwest'}
            className={`${INPUT} font-mono`}
          />
        </div>
      ) : null}

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
        <p className="mt-1 text-xs text-slate-400">Recorded against the grant. This is the audit trail.</p>
      </div>

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

      <div className="mt-5">
        <Submit />
      </div>
    </form>
  );
}
