'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  changeGrantAction,
  resetPasswordAction,
  setStatusAction,
  updateProfileAction,
  type PersonState,
} from './actions.ts';
import { GrantFields, INPUT, LABEL, type GrantInitial, type GroupOption, type RoleOption } from '../grant-fields.tsx';

function Submit({ label, busy, tone = 'brand' }: { label: string; busy: string; tone?: 'brand' | 'danger' | 'plain' }) {
  const { pending } = useFormStatus();
  const cls =
    tone === 'danger'
      ? 'rounded border border-danger-300 px-3 py-1.5 text-sm font-medium text-danger-700 hover:bg-danger-50'
      : tone === 'plain'
        ? 'rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
        : 'rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700';
  return (
    <button type="submit" disabled={pending} className={`${cls} disabled:opacity-50`}>
      {pending ? busy : label}
    </button>
  );
}

function Feedback({ state }: { state: PersonState }) {
  return (
    <>
      {state.error ? <p className="mt-3 text-sm text-danger-700">{state.error}</p> : null}
      {state.ok ? <p className="mt-3 text-sm text-success-700">{state.ok}</p> : null}
      {state.tempPassword ? (
        <div className="mt-3 rounded border border-warning-200 bg-warning-50 p-4">
          <p className="text-xs font-medium text-warning-800">One-time password — shown once, and not recoverable.</p>
          <p className="mt-2 select-all font-mono text-lg tracking-tight text-slate-900">{state.tempPassword}</p>
          <p className="mt-2 text-xs text-warning-700">
            Pass it on directly, not by email. They change it under Account in Inspire, InspiredREV or here.
          </p>
        </div>
      ) : null}
    </>
  );
}

export function ProfileForm({ personId, name, email }: { personId: string; name: string; email: string }) {
  const [state, action] = useFormState<PersonState, FormData>(updateProfileAction, {});
  return (
    <form action={action} className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
      <input type="hidden" name="personId" value={personId} />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="p-name">Name</label>
          <input id="p-name" name="name" defaultValue={name} required maxLength={120} className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="p-email">Email</label>
          <input id="p-email" name="email" type="email" defaultValue={email} required className={INPUT} />
          <p className="mt-1 text-xs text-slate-400">Their sign-in name in the console, Inspire and InspiredREV.</p>
        </div>
      </div>
      <div className="mt-4">
        <Submit label="Save profile" busy="Saving…" />
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function ChangeGrant({
  personId,
  grantId,
  roles,
  groups,
  initial,
}: {
  personId: string;
  grantId: string;
  roles: RoleOption[];
  groups: GroupOption[];
  initial: GrantInitial;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState<PersonState, FormData>(changeGrantAction, {});
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-600 hover:underline">
        Change
      </button>
    );
  }
  return (
    <form action={action} className="mt-3 rounded border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="personId" value={personId} />
      <p className="text-xs text-slate-500">
        Closes this grant and opens the replacement in one step. The old one stays on the record.
      </p>
      <GrantFields roles={roles} groups={groups} initial={initial} idPrefix={`g-${grantId}-`} />
      <div className="mt-4">
        <label className={LABEL} htmlFor={`g-${grantId}-reason`}>Reason</label>
        <input id={`g-${grantId}-reason`} name="reason" required maxLength={280} placeholder="Promoted to GM" className={INPUT} />
      </div>
      <div className="mt-4 flex gap-3">
        <Submit label="Change access" busy="Changing…" />
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function StatusForm({ personId, status, isSelf }: { personId: string; status: string; isSelf: boolean }) {
  const [state, action] = useFormState<PersonState, FormData>(setStatusAction, {});
  const changes =
    status === 'active' || status === 'invited'
      ? [
          { value: 'suspend', label: 'Suspend', tone: 'plain' as const },
          { value: 'offboard', label: 'Offboard', tone: 'danger' as const },
        ]
      : status === 'suspended'
        ? [
            { value: 'reactivate', label: 'Reactivate', tone: 'brand' as const },
            { value: 'offboard', label: 'Offboard', tone: 'danger' as const },
          ]
        : [];

  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Status</h2>
      <p className="mt-1 text-xs text-slate-500">
        Suspend freezes access everywhere and keeps every grant. Offboard closes every grant; coming back later is a
        new grant from Grant access.
      </p>
      {isSelf ? (
        <p className="mt-3 text-sm text-slate-400">You can’t change your own status.</p>
      ) : changes.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          Offboarded. To bring them back, grant access again with this email on People.
        </p>
      ) : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="personId" value={personId} />
          <input name="reason" required maxLength={280} placeholder="Reason" className={INPUT} />
          <div className="flex gap-3">
            {changes.map((c) => (
              <button
                key={c.value}
                type="submit"
                name="change"
                value={c.value}
                className={
                  c.tone === 'danger'
                    ? 'rounded border border-danger-300 px-3 py-1.5 text-sm font-medium text-danger-700 hover:bg-danger-50'
                    : c.tone === 'brand'
                      ? 'rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700'
                      : 'rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </form>
      )}
      <Feedback state={state} />
    </div>
  );
}

export function ResetPasswordForm({ personId, disabled }: { personId: string; disabled: boolean }) {
  const [state, action] = useFormState<PersonState, FormData>(resetPasswordAction, {});
  return (
    <form action={action} className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Password</h2>
      <p className="mt-1 text-xs text-slate-500">
        Issues a one-time password that replaces theirs in the console, Inspire and InspiredREV.
      </p>
      <input type="hidden" name="personId" value={personId} />
      <div className="mt-3">
        {disabled ? (
          <p className="text-sm text-slate-400">Offboarded — nothing to reset.</p>
        ) : (
          <Submit label="Reset password" busy="Resetting…" tone="plain" />
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}
