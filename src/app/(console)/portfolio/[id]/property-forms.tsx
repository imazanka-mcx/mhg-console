'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  deliverNowAction,
  moveStatusAction,
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
