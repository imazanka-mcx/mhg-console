'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { createGroupAction, type GroupState } from './actions.ts';

const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-500';

const KINDS = [
  { key: 'region', label: 'Region', hint: 'A set somebody drew. Redraw it whenever — no grant is touched.' },
  { key: 'brand', label: 'Brand', hint: 'Usually rule-backed on brand code, so new hotels join themselves.' },
  { key: 'entity', label: 'Entity', hint: 'An ownership or management entity.' },
  { key: 'ad_hoc', label: 'Ad hoc', hint: 'A task force, a conversion, three hotels for one quarter.' },
  { key: 'audit', label: 'Audit', hint: 'An auditor assignment, usually time-boxed by the grant.' },
] as const;

const RULE_FIELDS = [
  { key: 'brandCode', label: 'Brand code', placeholder: 'HX, HP' },
  { key: 'chainCode', label: 'Chain code', placeholder: 'HI' },
  { key: 'state', label: 'State', placeholder: 'IN, KY' },
  { key: 'city', label: 'City', placeholder: 'Evansville' },
  { key: 'status', label: 'Status', placeholder: 'active, pipeline' },
] as const;

function Buttons({ mode }: { mode: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-5 flex items-center gap-3">
      {mode === 'rule' ? (
        <button
          type="submit"
          name="intent"
          value="preview"
          disabled={pending}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Preview
        </button>
      ) : null}
      <button
        type="submit"
        name="intent"
        value="create"
        disabled={pending}
        className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Create group'}
      </button>
    </div>
  );
}

export function CreateGroupForm() {
  const [state, action] = useFormState<GroupState, FormData>(createGroupAction, {});
  const [kind, setKind] = useState<string>('region');
  const [mode, setMode] = useState<string>('manual');

  const kindHint = KINDS.find((k) => k.key === kind)?.hint;

  return (
    <form action={action} className="mt-6 rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">New group</h2>
      <p className="mt-1 text-xs text-slate-500">
        A group is a set of properties that can be granted on. The id is minted from the name once
        and never changes, because grants point at it.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="name">
            Name
          </label>
          <input id="name" name="name" required maxLength={80} className={INPUT} placeholder="Midwest" />
        </div>
        <div>
          <label className={LABEL} htmlFor="kind">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={INPUT}
          >
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">{kindHint}</p>
        </div>
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="description">
          What it is for
        </label>
        <input
          id="description"
          name="description"
          maxLength={240}
          className={INPUT}
          placeholder="Indiana and Kentucky hotels under Rachel's oversight"
        />
      </div>

      <fieldset className="mt-5">
        <legend className={LABEL}>Membership</legend>
        <div className="flex gap-6">
          {(['manual', 'rule'] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{m === 'manual' ? 'Manual' : 'Rule-backed'}</span>
                <span className="block text-xs text-slate-400">
                  {m === 'manual'
                    ? 'You add and remove properties. Change your mind weekly.'
                    : 'Membership follows the portfolio. New matching hotels join on issuance.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'rule' ? (
        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-500">
            Values in a box are <span className="font-medium">or</span>; boxes are{' '}
            <span className="font-medium">and</span>. Comma-separated. Leave a box empty to not
            constrain it — but at least one is required, or the group is the whole portfolio.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {RULE_FIELDS.map((f) => (
              <div key={f.key}>
                <label className={LABEL} htmlFor={`rule_${f.key}`}>
                  {f.label}
                </label>
                <input
                  id={`rule_${f.key}`}
                  name={`rule_${f.key}`}
                  maxLength={200}
                  placeholder={f.placeholder}
                  className={`${INPUT} font-mono`}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Without a status condition, retired codes are excluded — a region that quietly
            accumulates dead hotels stops being a list of places anyone operates.
          </p>
        </div>
      ) : null}

      {state.error ? <p className="mt-4 text-sm text-danger-700">{state.error}</p> : null}
      {state.ok ? <p className="mt-4 text-sm text-success-700">{state.ok}</p> : null}

      {state.preview ? (
        <div className="mt-4 rounded border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-700">
            {state.preview.matched.length} of {state.preview.considered} properties match —{' '}
            <span className="text-slate-500">{state.preview.description}</span>
          </p>
          <ul className="mt-2 space-y-1">
            {state.preview.matched.map((m) => (
              <li key={m.code} className="text-xs text-slate-600">
                <span className="font-mono font-medium text-slate-900">{m.code}</span> · {m.status} ·{' '}
                {m.name}
              </li>
            ))}
            {state.preview.matched.length === 0 ? (
              <li className="text-xs text-warning-700">
                Nothing matches. A rule group that selects nothing looks exactly like a group nobody
                joined.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <Buttons mode={mode} />
    </form>
  );
}
