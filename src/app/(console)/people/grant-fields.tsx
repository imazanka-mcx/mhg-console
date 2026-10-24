'use client';

import { useState } from 'react';

/**
 * Role, scope, target and per-app role — the part of a grant every People form
 * asks for (docs/01 §2.5, §2.7). Shared by Grant access and Change grant so
 * both offer exactly the same choices, and grantAccess refuses the same things.
 */

export interface RoleOption {
  key: string;
  name: string;
  description: string;
  assignableAt: readonly string[];
  /** What the role becomes in each app (docs/01 §2.7). */
  links: Partial<Record<'inspire' | 'inspiredrev', { role: string; also?: string[] }>>;
}

export interface GroupOption {
  id: string;
  name: string;
  kind: string;
  members: number;
}

export const APPS = [
  { key: 'inspire', label: 'Inspire' },
  { key: 'inspiredrev', label: 'InspiredREV' },
] as const;

export const pretty = (k: string) => k.replace(/_/g, ' ');

export const INPUT =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
export const LABEL = 'mb-1 block text-xs font-medium text-slate-500';

export interface GrantInitial {
  roleKey?: string;
  scope?: string;
  scopeRef?: string;
  downstream?: Partial<Record<'inspire' | 'inspiredrev', string>>;
}

export function GrantFields({
  roles,
  groups,
  initial = {},
  idPrefix = '',
}: {
  roles: RoleOption[];
  groups: GroupOption[];
  initial?: GrantInitial;
  /** Keeps element ids unique when several forms share a page. */
  idPrefix?: string;
}) {
  const [roleKey, setRoleKey] = useState(initial.roleKey ?? roles[0]?.key ?? '');
  const role = roles.find((r) => r.key === roleKey);
  const scopes = role?.assignableAt ?? ['portfolio'];
  const [scope, setScope] = useState<string>(initial.scope ?? scopes[0] ?? 'portfolio');
  const effectiveScope = scopes.includes(scope) ? scope : (scopes[0] ?? 'portfolio');
  const sameAsInitial = roleKey === initial.roleKey;

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`${idPrefix}roleKey`}>
            Role
          </label>
          <select
            id={`${idPrefix}roleKey`}
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
          <label className={LABEL} htmlFor={`${idPrefix}scope`}>
            Scope
          </label>
          <select
            id={`${idPrefix}scope`}
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

      {role ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {APPS.map((app) => {
            const link = role.links[app.key];
            const options = link ? [link.role, ...(link.also ?? [])] : [];
            return (
              <div key={`${role.key}-${app.key}`}>
                <label className={LABEL} htmlFor={`${idPrefix}downstream_${app.key}`}>
                  In {app.label}
                </label>
                {options.length > 1 ? (
                  <select
                    id={`${idPrefix}downstream_${app.key}`}
                    name={`downstream_${app.key}`}
                    defaultValue={(sameAsInitial && initial.downstream?.[app.key]) || options[0]}
                    className={INPUT}
                  >
                    {options.map((o, i) => (
                      <option key={o} value={o}>
                        {pretty(o)}
                        {i === 0 ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {options[0] ? pretty(options[0]) : 'No access'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {effectiveScope === 'property' ? (
        <div className="mt-4">
          <label className={LABEL} htmlFor={`${idPrefix}scopeRef`}>
            Inn code
          </label>
          <input
            id={`${idPrefix}scopeRef`}
            name="scopeRef"
            maxLength={64}
            placeholder="EVVBC"
            defaultValue={effectiveScope === initial.scope ? (initial.scopeRef ?? '') : ''}
            className={`${INPUT} font-mono`}
          />
          <p className="mt-1 text-xs text-slate-400">
            Checked against the registry — a grant pointing at nothing looks like access and confers
            none.
          </p>
        </div>
      ) : null}

      {effectiveScope === 'group' ? (
        <div className="mt-4">
          <label className={LABEL} htmlFor={`${idPrefix}scopeRef`}>
            Group
          </label>
          {groups.length === 0 ? (
            <p className="rounded border border-warning-200 bg-warning-50 p-3 text-xs text-warning-800">
              There are no groups yet, so there is nothing to grant at group scope. Draw one under
              Groups first — a region is a set of properties, not a tier.
            </p>
          ) : (
            <>
              <select
                id={`${idPrefix}scopeRef`}
                name="scopeRef"
                className={INPUT}
                defaultValue={(effectiveScope === initial.scope && initial.scopeRef) || groups[0]?.id}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — {g.kind}, {g.members} propert{g.members === 1 ? 'y' : 'ies'}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Covers whatever is in the group today, and whatever is in it tomorrow. Redrawing the
                group does not touch this grant — that is the point.
              </p>
            </>
          )}
        </div>
      ) : null}

    </>
  );
}
