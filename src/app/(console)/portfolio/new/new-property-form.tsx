'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';

import {
  issueAction,
  proposeAction,
  type IssueState,
  type ProposeState,
} from './actions.ts';

const LABEL = 'mb-1 block text-xs font-medium text-slate-500';
const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function Submit({ children, variant }: { children: string; variant: 'primary' | 'quiet' }) {
  const { pending } = useFormStatus();
  const base = 'rounded px-4 py-2 text-sm font-medium disabled:opacity-50';
  const style =
    variant === 'primary'
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <button type="submit" disabled={pending} className={`${base} ${style}`}>
      {pending ? 'Working…' : children}
    </button>
  );
}

function Trace({ steps }: { steps: { rule: string; detail: string }[] }) {
  return (
    <dl className="mt-3 space-y-1">
      {steps.map((s, i) => (
        <div key={`${s.rule}-${i}`} className="flex gap-3 text-xs">
          <dt className="w-10 shrink-0 font-mono font-semibold text-slate-500">{s.rule}</dt>
          <dd className="text-slate-600">{s.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NewPropertyForm({ brands }: { brands: { code: string; name: string }[] }) {
  const [proposal, propose] = useFormState<ProposeState, FormData>(proposeAction, { kind: 'idle' });
  const [issue, confirm] = useFormState<IssueState, FormData>(issueAction, { kind: 'idle' });

  const errors = proposal.kind === 'invalid' ? proposal.errors : {};

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">New property</h1>
          <p className="mt-1 text-sm text-slate-500">
            The code is derived, not typed. You will see it and the rules that produced it before
            anything is claimed.
          </p>
        </div>
        <Link href="/portfolio" className="text-sm text-brand-600 hover:underline">
          ← Portfolio
        </Link>
      </div>

      <form action={propose} className="mt-6 space-y-5 rounded-lg bg-white p-6 shadow-sm">
        <div>
          <label className={LABEL} htmlFor="name">
            Property name
          </label>
          <input id="name" name="name" maxLength={120} className={INPUT} />
          <p className="mt-1 text-xs text-slate-400">
            Optional — defaults to the brand and city.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="city">
              City
            </label>
            <input id="city" name="city" required maxLength={80} className={INPUT} />
            {errors['city'] ? (
              <p className="mt-1 text-xs text-danger-600">{errors['city']}</p>
            ) : null}
          </div>
          <div>
            <label className={LABEL} htmlFor="state">
              State
            </label>
            <input
              id="state"
              name="state"
              required
              maxLength={2}
              placeholder="IN"
              className={`${INPUT} uppercase`}
            />
            {errors['state'] ? (
              <p className="mt-1 text-xs text-danger-600">{errors['state']}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="brandCode">
              Flag
            </label>
            <select id="brandCode" name="brandCode" required className={INPUT}>
              {brands.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              The closed brand table (B1). An unlisted flag gets added there first.
            </p>
          </div>
          <div>
            <label className={LABEL} htmlFor="submarket">
              Submarket
            </label>
            <input id="submarket" name="submarket" maxLength={80} placeholder="East" className={INPUT} />
            <p className="mt-1 text-xs text-slate-400">
              Only used if the market code is already taken (M5).
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="franchisorCode">
              Franchisor code
            </label>
            <input id="franchisorCode" name="franchisorCode" maxLength={20} className={INPUT} />
            <p className="mt-1 text-xs text-slate-400">Cross-reference only, never an identifier (G5).</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="status">
              Status at issue
            </label>
            <select id="status" name="status" defaultValue="pipeline" className={INPUT}>
              <option value="pipeline">pipeline — signed, not open</option>
              <option value="active">active — open</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">
              A code is issued at LOI, not at opening (G6).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Submit variant="quiet">Propose a code</Submit>
          <span className="text-xs text-slate-400">Reads the registry. Writes nothing.</span>
        </div>
      </form>

      {proposal.kind === 'refused' ? (
        <div className="mt-5 rounded-lg border border-danger-200 bg-danger-50 p-5">
          <p className="text-sm font-medium text-danger-800">
            <span className="font-mono">{proposal.rule}</span> — {proposal.message}
          </p>
          <Trace steps={proposal.trace} />
        </div>
      ) : null}

      {proposal.kind === 'proposed' ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
              {proposal.code}
            </span>
            <span className="text-xs text-slate-400">nothing has been written yet</span>
          </div>

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">
            How it got there
          </p>
          <Trace steps={proposal.trace} />

          <form action={confirm} className="mt-6 border-t border-slate-100 pt-5">
            {/* Replays the same inputs the proposal was derived from — the
                action re-derives rather than trusting the code shown above. */}
            {Object.entries(proposal.input).map(([k, v]) =>
              v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />,
            )}
            <p className="mb-3 text-sm text-slate-600">
              Claiming is permanent. A retired code is never reissued, and this market code binds
              to this place for good (G3, M7).
            </p>
            <Submit variant="primary">Claim {proposal.code}</Submit>
          </form>

          {issue.kind === 'refused' ? (
            <p className="mt-4 text-sm text-danger-700">
              <span className="font-mono">{issue.rule}</span> — {issue.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
