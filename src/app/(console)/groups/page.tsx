import Link from 'next/link';

import { permissionsAt } from '../../../auth/access.ts';
import { currentActor } from '../../../auth/actor.ts';
import { GROUP_KIND_LABELS, listGroups, type GroupKind } from '../../../groups/groups.ts';
import { CreateGroupForm } from './create-group-form.tsx';

export const dynamic = 'force-dynamic';

const KIND_STYLE: Record<string, string> = {
  region: 'bg-brand-50 text-brand-700 ring-brand-200',
  brand: 'bg-success-50 text-success-700 ring-success-200',
  entity: 'bg-slate-100 text-slate-600 ring-slate-200',
  ad_hoc: 'bg-warning-50 text-warning-700 ring-warning-200',
  audit: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default async function GroupsPage() {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  const canManage = held.has('group.manage');

  const groups = await listGroups(true);
  const live = groups.filter((g) => g.archivedAt === null);
  const archived = groups.filter((g) => g.archivedAt !== null);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Groups</h1>
      <p className="mt-1 text-sm text-slate-500">
        The above-property axis, held as membership rather than schema. Scope stays{' '}
        <span className="font-mono text-xs">portfolio · group · property</span> permanently, so a
        new way of slicing the portfolio is a row here and never a migration.
      </p>

      {canManage ? <CreateGroupForm /> : null}

      {live.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-700">No groups yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Until there is one, the <span className="font-mono text-xs">group</span> scope resolves
            but has nothing to point at — which is why a Regional DOO can currently be given either
            one hotel or all of them.
          </p>
        </div>
      ) : (
        <table className="mt-8 w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Group</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Kind</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Membership</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Properties</th>
              <th className="border-b border-slate-200 py-2 font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {live.map((g) => (
              <tr key={g.id} className="align-top">
                <td className="border-b border-slate-100 py-2.5 pr-4">
                  <Link href={`/groups/${g.id}`} className="font-medium text-slate-900 hover:underline">
                    {g.name}
                  </Link>
                  {g.description ? (
                    <div className="max-w-sm text-xs text-slate-400">{g.description}</div>
                  ) : null}
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      KIND_STYLE[g.kind] ?? ''
                    }`}
                  >
                    {GROUP_KIND_LABELS[g.kind as GroupKind]}
                  </span>
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-600">
                  {g.membershipMode}
                  {g.membershipMode === 'rule' ? (
                    <div className="text-xs text-slate-400">
                      {g.syncedAt ? `synced ${g.syncedAt.toISOString().slice(0, 10)}` : 'never synced'}
                    </div>
                  ) : null}
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-700">
                  {g._count.members}
                </td>
                <td className="border-b border-slate-100 py-2.5 font-mono text-xs text-slate-400">
                  {g.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-slate-400">
            {archived.length} archived
          </summary>
          <ul className="mt-2 space-y-1">
            {archived.map((g) => (
              <li key={g.id} className="text-xs text-slate-400">
                <Link href={`/groups/${g.id}`} className="hover:underline">
                  {g.name}
                </Link>{' '}
                · <span className="font-mono">{g.id}</span> · {g._count.members} properties
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-6 text-xs text-slate-400">
        A group grant carries no property-capped permission, whatever its size — a one-property
        group is still a set, and cardinality is not the test (docs/29 §3).
      </p>
    </div>
  );
}
