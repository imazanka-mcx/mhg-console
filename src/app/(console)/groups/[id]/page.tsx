import Link from 'next/link';
import { notFound } from 'next/navigation';

import { permissionsAt } from '../../../../auth/access.ts';
import { currentActor } from '../../../../auth/actor.ts';
import {
  GROUP_KIND_LABELS,
  grantsOnGroup,
  groupDetail,
  type GroupKind,
} from '../../../../groups/groups.ts';
import { describeRule, parseRule } from '../../../../groups/rules.ts';
import { AddMemberForm, ArchiveButton, RemoveMemberButton, SyncButton } from './member-forms.tsx';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  pipeline: 'bg-warning-50 text-warning-700 ring-warning-200',
  active: 'bg-success-50 text-success-700 ring-success-200',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export default async function GroupPage({ params }: { params: { id: string } }) {
  const group = await groupDetail(params.id);
  if (!group) notFound();

  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  const canManage = held.has('group.manage');

  const grants = await grantsOnGroup(group.id);
  const isRule = group.membershipMode === 'rule';

  let ruleText: string | null = null;
  let ruleBroken: string | null = null;
  if (isRule && group.ruleJson) {
    try {
      ruleText = describeRule(parseRule(group.ruleJson));
    } catch (err) {
      ruleBroken = err instanceof Error ? err.message : 'Unreadable rule.';
    }
  }

  return (
    <div className="max-w-4xl">
      <Link href="/groups" className="text-xs text-slate-400 hover:underline">
        ← Groups
      </Link>

      <div className="mt-2 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{group.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-mono text-xs">{group.id}</span> ·{' '}
            {GROUP_KIND_LABELS[group.kind as GroupKind]} · {group.membershipMode}
            {group.archivedAt ? ' · archived' : ''}
          </p>
          {group.description ? (
            <p className="mt-2 max-w-xl text-sm text-slate-600">{group.description}</p>
          ) : null}
        </div>
        {canManage ? <ArchiveButton groupId={group.id} archived={group.archivedAt !== null} /> : null}
      </div>

      {group.archivedAt ? (
        <p className="mt-4 rounded border border-warning-200 bg-warning-50 p-3 text-xs text-warning-800">
          Archived groups are hidden from the pickers but still resolve. Access is closed by closing
          a grant, not by archiving — otherwise a display action would silently revoke people.
        </p>
      ) : null}

      {isRule ? (
        <div className="mt-6 rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Rule</h2>
          {ruleBroken ? (
            <p className="mt-1 text-sm text-danger-700">{ruleBroken}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{ruleText}</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Last synced{' '}
            {group.syncedAt ? group.syncedAt.toISOString().replace('T', ' ').slice(0, 16) : 'never'}.
            Membership materializes into rows rather than being evaluated on read, so who is in this
            group is inspectable — and so it can go stale, which is what this timestamp is for.
          </p>
          {canManage ? <SyncButton groupId={group.id} /> : null}
        </div>
      ) : null}

      <div className="mt-6 rounded-lg bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Properties <span className="font-normal text-slate-400">({group.members.length})</span>
          </h2>
          {grants.length > 0 ? (
            <span className="text-xs text-warning-700">
              {grants.length} live grant{grants.length === 1 ? '' : 's'} — changing membership
              changes what {grants.length === 1 ? 'that person' : 'those people'} can reach
            </span>
          ) : null}
        </div>

        <ul className="mt-3 divide-y divide-slate-100">
          {group.members.map((m) => (
            <li key={m.propertyId} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 font-mono font-semibold text-slate-900">{m.property.code}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  STATUS_STYLE[m.property.status] ?? ''
                }`}
              >
                {m.property.status}
              </span>
              <span className="flex-1 truncate text-slate-700">{m.property.name}</span>
              <span className="text-xs text-slate-400">
                {m.property.city}, {m.property.state}
              </span>
              {canManage && !isRule ? (
                <RemoveMemberButton groupId={group.id} propertyId={m.propertyId} />
              ) : null}
            </li>
          ))}
          {group.members.length === 0 ? (
            <li className="py-3 text-sm text-slate-400">
              {isRule ? 'Nothing matches the rule.' : 'Empty. Grants on this group reach nothing.'}
            </li>
          ) : null}
        </ul>

        {canManage && !isRule ? <AddMemberForm groupId={group.id} /> : null}
        {isRule ? (
          <p className="mt-3 text-xs text-slate-400">
            Rule-backed membership is not edited by hand — change the rule, or make a manual group.
          </p>
        ) : null}
      </div>

      <div className="mt-6 rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Who this group grants</h2>
        <p className="mt-1 text-xs text-slate-500">
          Live grants held at this group. Each one reaches every property above — which is why
          adding one here is an access change even though no grant was touched.
        </p>
        <ul className="mt-3 space-y-1.5">
          {grants.map((g) => (
            <li key={g.id} className="flex items-baseline gap-3 text-sm">
              <span className="font-medium text-slate-800">{g.person.name}</span>
              <span className="text-xs text-slate-500">{g.person.email}</span>
              <span className="text-xs text-slate-500">
                {g.role.name} · v{g.roleVersion}
              </span>
              <span className="text-xs text-slate-400">
                since {g.effectiveFrom.toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
          {grants.length === 0 ? (
            <li className="text-sm text-slate-400">
              Nobody yet. Grant it from <Link href="/people" className="hover:underline">People</Link>{' '}
              at <span className="font-mono text-xs">group</span> scope, pointing at{' '}
              <span className="font-mono text-xs">{group.id}</span>.
            </li>
          ) : null}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          No grant here can carry A/R or folio authority: those permissions are capped at property,
          and a group is above property however few hotels are in it.
        </p>
      </div>
    </div>
  );
}
