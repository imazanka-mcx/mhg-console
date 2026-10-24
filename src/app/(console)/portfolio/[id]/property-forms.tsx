'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  assignManagementAction,
  assignOwnershipAction,
  deliverNowAction,
  endAssignmentAction,
  managementTermsAction,
  moveStatusAction,
  ownershipTermsAction,
  updateAssetAction,
  updateSetupAction,
  type PropertyActionState,
} from './actions.ts';

const LABEL = 'mb-1 block text-xs font-medium text-slate-500';
const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function Submit({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'quiet' | 'danger' }) {
  const { pending } = useFormStatus();
  const style =
    tone === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : tone === 'danger'
        ? 'bg-danger-600 text-white hover:bg-danger-700'
        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <button type="submit" disabled={pending} className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${style}`}>
      {pending ? 'Working…' : children}
    </button>
  );
}

function Result({ state }: { state: PropertyActionState }) {
  if (state.error) return <p className="mt-2 text-xs text-danger-600">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-xs text-success-700">{state.ok}</p>;
  return null;
}

export function LifecycleForm({
  propertyId,
  code,
  moves,
}: {
  propertyId: string;
  code: string;
  moves: { to: string; label: string }[];
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(moveStatusAction, {});
  const [to, setTo] = useState(moves[0]?.to ?? '');
  if (!moves.length) {
    return (
      <p className="text-sm text-slate-500">
        Retired is terminal. The code stays claimed and is never reissued (G3); a returning hotel gets a
        new one.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="code" value={code} />
      <div className="space-y-1.5">
        {moves.map((m) => (
          <label key={m.to} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="to" value={m.to} checked={to === m.to} onChange={() => setTo(m.to)} />
            <span className="font-mono text-xs text-slate-500">→ {m.to}</span> {m.label}
          </label>
        ))}
      </div>
      <div>
        <label className={LABEL} htmlFor="reason">
          Reason
        </label>
        <input id="reason" name="reason" required maxLength={240} placeholder="Opened 3 Nov — first night sold" className={INPUT} />
      </div>
      {to === 'retired' ? (
        <div>
          <label className={LABEL} htmlFor="confirmCode">
            Type {code} to retire it permanently
          </label>
          <input id="confirmCode" name="confirmCode" autoComplete="off" className={`${INPUT} font-mono uppercase`} />
        </div>
      ) : null}
      <Submit tone={to === 'retired' ? 'danger' : 'primary'}>Move to {to}</Submit>
      <Result state={state} />
    </form>
  );
}

export function SetupForm({
  propertyId,
  timezone,
  currency,
  expectedOpenDate,
  timezones,
}: {
  propertyId: string;
  timezone: string;
  currency: string;
  expectedOpenDate: string;
  timezones: readonly string[];
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(updateSetupAction, {});
  const zones = timezones.includes(timezone) ? timezones : [timezone, ...timezones];
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="timezone">
            Timezone
          </label>
          <select id="timezone" name="timezone" defaultValue={timezone} className={INPUT}>
            {zones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="currency">
            Currency
          </label>
          <input id="currency" name="currency" defaultValue={currency} maxLength={3} className={`${INPUT} uppercase`} />
        </div>
        <div>
          <label className={LABEL} htmlFor="expectedOpenDate">
            Expected opening
          </label>
          <input id="expectedOpenDate" name="expectedOpenDate" type="date" defaultValue={expectedOpenDate} className={INPUT} />
        </div>
      </div>
      <Submit tone="quiet">Save</Submit>
      <Result state={state} />
    </form>
  );
}

export function DeliverNow({ propertyId }: { propertyId: string }) {
  const [state, action] = useFormState<PropertyActionState, FormData>(deliverNowAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <Submit tone="quiet">Deliver now</Submit>
      <Result state={state} />
    </form>
  );
}

// ─────────────────────────── ownership and control (§1.7) ─────────────────

type Option = { id: string; name: string };

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function OrgSelect({ name, options, empty }: { name: string; options: Option[]; empty: string }) {
  if (!options.length) {
    return <p className="text-xs text-slate-500">{empty}</p>;
  }
  return (
    <select id={name} name={name} required className={INPUT} defaultValue="">
      <option value="" disabled>
        Choose…
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Disclose({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 rounded border border-slate-200 bg-slate-50/50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-brand-600">{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export interface OwnershipTerms {
  titleEntity: string;
  titleEntityState: string;
  licenseEffectiveDate: string;
  licenseExpiryDate: string;
}

function OwnershipTermFields({ terms }: { terms?: OwnershipTerms }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="titleEntity" label="Title-holding entity (on the deed)">
        <input id="titleEntity" name="titleEntity" defaultValue={terms?.titleEntity ?? ''} placeholder="Riverfront Hotel Owner, LLC" className={INPUT} />
      </Field>
      <Field id="titleEntityState" label="Entity state">
        <input id="titleEntityState" name="titleEntityState" defaultValue={terms?.titleEntityState ?? ''} maxLength={2} placeholder="DE" className={`${INPUT} uppercase`} />
      </Field>
      <Field id="licenseEffectiveDate" label="MHG licence effective">
        <input id="licenseEffectiveDate" name="licenseEffectiveDate" type="date" defaultValue={terms?.licenseEffectiveDate ?? ''} className={INPUT} />
      </Field>
      <Field id="licenseExpiryDate" label="MHG licence expires">
        <input id="licenseExpiryDate" name="licenseExpiryDate" type="date" defaultValue={terms?.licenseExpiryDate ?? ''} className={INPUT} />
      </Field>
    </div>
  );
}

export function AssignOwnershipForm({
  propertyId,
  owners,
  today,
  replacing,
}: {
  propertyId: string;
  owners: Option[];
  today: string;
  replacing: boolean;
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(assignOwnershipAction, {});
  return (
    <Disclose label={replacing ? 'Change owner (sale or transfer)' : 'Assign ownership group'}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="organizationId" label="Ownership group">
            <OrgSelect name="organizationId" options={owners} empty="No ownership groups yet — add one under Organizations." />
          </Field>
          <Field id="effectiveFrom" label="Effective from">
            <input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={today} className={INPUT} />
          </Field>
        </div>
        <OwnershipTermFields />
        <Field id="ownReason" label="Reason">
          <input id="ownReason" name="reason" required maxLength={240} placeholder={replacing ? 'Sold to … closing 1 Dec' : 'Signed at LOI'} className={INPUT} />
        </Field>
        <Submit tone="quiet">{replacing ? 'Change owner' : 'Assign owner'}</Submit>
        <Result state={state} />
      </form>
    </Disclose>
  );
}

export function OwnershipTermsForm({ propertyId, terms }: { propertyId: string; terms: OwnershipTerms }) {
  const [state, action] = useFormState<PropertyActionState, FormData>(ownershipTermsAction, {});
  return (
    <Disclose label="Edit title entity and licence">
      <form action={action} className="space-y-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <OwnershipTermFields terms={terms} />
        <Submit tone="quiet">Save</Submit>
        <Result state={state} />
      </form>
    </Disclose>
  );
}

export interface ManagementTerms {
  agreementExpiryDate: string;
  terminationNoticeDays: number | null;
}

function ManagementTermFields({ terms }: { terms?: ManagementTerms }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="agreementExpiryDate" label="Management agreement expires">
        <input id="agreementExpiryDate" name="agreementExpiryDate" type="date" defaultValue={terms?.agreementExpiryDate ?? ''} className={INPUT} />
      </Field>
      <Field id="terminationNoticeDays" label="Termination notice (days)">
        <input
          id="terminationNoticeDays"
          name="terminationNoticeDays"
          inputMode="numeric"
          defaultValue={terms?.terminationNoticeDays ?? ''}
          placeholder="90"
          className={INPUT}
        />
      </Field>
    </div>
  );
}

export function AssignManagementForm({
  propertyId,
  managers,
  today,
  replacing,
}: {
  propertyId: string;
  managers: Option[];
  today: string;
  replacing: boolean;
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(assignManagementAction, {});
  return (
    <Disclose label={replacing ? 'Change management company' : 'Assign management company'}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="mgmtOrganizationId" label="Management company">
            <OrgSelect name="organizationId" options={managers} empty="No management companies yet — add one under Organizations." />
          </Field>
          <Field id="mgmtEffectiveFrom" label="Effective from">
            <input id="mgmtEffectiveFrom" name="effectiveFrom" type="date" required defaultValue={today} className={INPUT} />
          </Field>
        </div>
        <ManagementTermFields />
        <Field id="mgmtReason" label="Reason">
          <input id="mgmtReason" name="reason" required maxLength={240} placeholder="Management agreement signed" className={INPUT} />
        </Field>
        <Submit tone="quiet">{replacing ? 'Change manager' : 'Assign manager'}</Submit>
        <Result state={state} />
      </form>
    </Disclose>
  );
}

export function ManagementTermsForm({ propertyId, terms }: { propertyId: string; terms: ManagementTerms }) {
  const [state, action] = useFormState<PropertyActionState, FormData>(managementTermsAction, {});
  return (
    <Disclose label="Edit agreement terms">
      <form action={action} className="space-y-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <ManagementTermFields terms={terms} />
        <Submit tone="quiet">Save</Submit>
        <Result state={state} />
      </form>
    </Disclose>
  );
}

export function EndAssignmentForm({
  propertyId,
  which,
  today,
}: {
  propertyId: string;
  which: 'ownership' | 'management';
  today: string;
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(endAssignmentAction, {});
  return (
    <Disclose label={`End ${which} with no successor`}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="which" value={which} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${which}EffectiveTo`} label="Ends on">
            <input id={`${which}EffectiveTo`} name="effectiveTo" type="date" required defaultValue={today} className={INPUT} />
          </Field>
          <Field id={`${which}EndReason`} label="Reason">
            <input id={`${which}EndReason`} name="reason" required maxLength={240} placeholder="Deal did not close" className={INPUT} />
          </Field>
        </div>
        <Submit tone="danger">End {which}</Submit>
        <Result state={state} />
      </form>
    </Disclose>
  );
}

export interface AssetValues {
  streetAddress: string;
  postalCode: string;
  keyCount: number | null;
  serviceLevel: string;
  yearOpened: number | null;
  yearRenovated: number | null;
  pipStatus: string;
  pipDueDate: string;
  qaLastDate: string;
  qaLastResult: string;
}

export function AssetForm({
  propertyId,
  values,
  serviceLevels,
  pipStatuses,
}: {
  propertyId: string;
  values: AssetValues;
  serviceLevels: Option[];
  pipStatuses: Option[];
}) {
  const [state, action] = useFormState<PropertyActionState, FormData>(updateAssetAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <Field id="streetAddress" label="Street address">
            <input id="streetAddress" name="streetAddress" defaultValue={values.streetAddress} className={INPUT} />
          </Field>
        </div>
        <Field id="postalCode" label="Postal code">
          <input id="postalCode" name="postalCode" defaultValue={values.postalCode} className={INPUT} />
        </Field>
        <Field id="keyCount" label="Keys">
          <input id="keyCount" name="keyCount" inputMode="numeric" defaultValue={values.keyCount ?? ''} className={INPUT} />
        </Field>
        <Field id="serviceLevel" label="Service level">
          <select id="serviceLevel" name="serviceLevel" defaultValue={values.serviceLevel} className={INPUT}>
            <option value="">—</option>
            {serviceLevels.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="yearOpened" label="Year opened">
          <input id="yearOpened" name="yearOpened" inputMode="numeric" defaultValue={values.yearOpened ?? ''} className={INPUT} />
        </Field>
        <Field id="yearRenovated" label="Last renovated">
          <input id="yearRenovated" name="yearRenovated" inputMode="numeric" defaultValue={values.yearRenovated ?? ''} className={INPUT} />
        </Field>
      </div>
      <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
        <Field id="pipStatus" label="PIP">
          <select id="pipStatus" name="pipStatus" defaultValue={values.pipStatus} className={INPUT}>
            {pipStatuses.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pipDueDate" label="PIP due">
          <input id="pipDueDate" name="pipDueDate" type="date" defaultValue={values.pipDueDate} className={INPUT} />
        </Field>
        <Field id="qaLastDate" label="Last brand QA">
          <input id="qaLastDate" name="qaLastDate" type="date" defaultValue={values.qaLastDate} className={INPUT} />
        </Field>
        <Field id="qaLastResult" label="QA result">
          <select id="qaLastResult" name="qaLastResult" defaultValue={values.qaLastResult} className={INPUT}>
            <option value="">—</option>
            <option value="pass">Pass</option>
            <option value="conditional">Conditional</option>
            <option value="fail">Fail</option>
          </select>
        </Field>
      </div>
      <Submit tone="quiet">Save</Submit>
      <Result state={state} />
    </form>
  );
}
