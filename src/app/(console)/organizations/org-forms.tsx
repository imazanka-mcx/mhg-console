'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  addPrincipalAction,
  archiveOrgAction,
  createOrgAction,
  removePrincipalAction,
  updateOrgAction,
  type OrgState,
} from './actions.ts';

const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-500';

function Submit({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'quiet' | 'danger' }) {
  const { pending } = useFormStatus();
  const style =
    tone === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : tone === 'danger'
        ? 'border border-danger-200 bg-white text-danger-700 hover:bg-danger-50'
        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <button type="submit" disabled={pending} className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${style}`}>
      {pending ? 'Working…' : children}
    </button>
  );
}

function Result({ state }: { state: OrgState }) {
  if (state.error) return <p className="mt-2 text-xs text-danger-600">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-xs text-success-700">{state.ok}</p>;
  return null;
}

export interface OrgDetails {
  name: string;
  legalName: string;
  registeredState: string;
  registrationNumber: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

function DetailFields({ kind, values }: { kind: string; values?: OrgDetails }) {
  const v = values;
  const management = kind === 'management';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL} htmlFor="name">Name</label>
        <input id="name" name="name" required defaultValue={v?.name ?? ''} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="legalName">Legal name</label>
        <input id="legalName" name="legalName" defaultValue={v?.legalName ?? ''} placeholder="As registered" className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="registeredState">
          Registered state{management ? ' (required)' : ''}
        </label>
        <input
          id="registeredState"
          name="registeredState"
          maxLength={2}
          required={management}
          defaultValue={v?.registeredState ?? ''}
          className={`${INPUT} uppercase`}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="registrationNumber">
          Registration number{management ? ' (required)' : ''}
        </label>
        <input
          id="registrationNumber"
          name="registrationNumber"
          required={management}
          defaultValue={v?.registrationNumber ?? ''}
          placeholder="State business-entity or licence no."
          className={`${INPUT} font-mono`}
        />
      </div>
      <div>
        <label className={LABEL} htmlFor="contactName">Primary contact</label>
        <input id="contactName" name="contactName" defaultValue={v?.contactName ?? ''} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="contactEmail">Contact email</label>
        <input id="contactEmail" name="contactEmail" type="email" defaultValue={v?.contactEmail ?? ''} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="contactPhone">Contact phone</label>
        <input id="contactPhone" name="contactPhone" defaultValue={v?.contactPhone ?? ''} className={INPUT} />
      </div>
    </div>
  );
}

export function CreateOrgForm() {
  const [state, action] = useFormState<OrgState, FormData>(createOrgAction, {});
  const [kind, setKind] = useState('ownership');
  return (
    <form action={action} className="mt-6 rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">New organization</h2>
      <div className="mt-3 flex gap-4 text-sm text-slate-700">
        {[
          { key: 'ownership', label: 'Ownership group', hint: 'Who owns the building.' },
          { key: 'management', label: 'Management company', hint: 'A registered third party that runs the hotel.' },
        ].map((k) => (
          <label key={k.key} className="flex items-start gap-2">
            <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="mt-1" />
            <span>
              {k.label}
              <span className="block text-xs text-slate-400">{k.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4">
        <DetailFields kind={kind} />
      </div>
      <div className="mt-4">
        <Submit>Add organization</Submit>
      </div>
      <Result state={state} />
    </form>
  );
}

export function EditOrgForm({ orgId, kind, values }: { orgId: string; kind: string; values: OrgDetails }) {
  const [state, action] = useFormState<OrgState, FormData>(updateOrgAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <DetailFields kind={kind} values={values} />
      <Submit tone="quiet">Save</Submit>
      <Result state={state} />
    </form>
  );
}

export function ArchiveOrgForm({ orgId, archived }: { orgId: string; archived: boolean }) {
  const [state, action] = useFormState<OrgState, FormData>(archiveOrgAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <Submit tone={archived ? 'quiet' : 'danger'}>{archived ? 'Restore' : 'Archive'}</Submit>
      <Result state={state} />
    </form>
  );
}

export function AddPrincipalForm({ orgId }: { orgId: string }) {
  const [state, action] = useFormState<OrgState, FormData>(addPrincipalAction, {});
  return (
    <form action={action} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="pName">Name</label>
          <input id="pName" name="name" required className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pEmail">Email</label>
          <input id="pEmail" name="email" type="email" required className={INPUT} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pTitle">Title</label>
          <input id="pTitle" name="title" placeholder="Managing member" className={INPUT} />
        </div>
      </div>
      <Submit tone="quiet">Add principal</Submit>
      <Result state={state} />
    </form>
  );
}

export function RemovePrincipalButton({ orgId, principalId }: { orgId: string; principalId: string }) {
  const [state, action] = useFormState<OrgState, FormData>(removePrincipalAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="principalId" value={principalId} />
      <button type="submit" className="text-xs text-slate-400 hover:text-danger-600">
        remove
      </button>
      {state.error ? <span className="ml-2 text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}
