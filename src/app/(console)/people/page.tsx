import { prisma } from '../../../db.ts';
import { permissionsAt } from '../../../auth/access.ts';
import { currentActor } from '../../../auth/actor.ts';
import { ROLES } from '../../../auth/catalog.ts';
import { ProvisionForms } from './provision-forms.tsx';
import { RevokeButton } from './revoke-button.tsx';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  invited: 'bg-warning-50 text-warning-700 ring-warning-200',
  active: 'bg-success-50 text-success-700 ring-success-200',
  suspended: 'bg-danger-50 text-danger-700 ring-danger-200',
  offboarded: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export default async function PeoplePage() {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  const canManage = held.has('people.manage');

  const people = await prisma.person.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      grants: {
        orderBy: { effectiveFrom: 'desc' },
        include: { role: true, grantedBy: { select: { name: true } } },
      },
    },
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">People</h1>
      <p className="mt-1 text-sm text-slate-500">
        One identity per person, for life. Access is a grant on top of it — so moving between
        properties, or coming back later, is a new grant rather than a new account.
      </p>

      {canManage ? <ProvisionForms roles={ROLES} /> : null}

      <div className="mt-8 space-y-4">
        {people.map((p) => {
          const live = p.grants.filter((g) => g.effectiveTo === null);
          const closed = p.grants.filter((g) => g.effectiveTo !== null);
          return (
            <div key={p.id} className="rounded-lg bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="ml-2 text-sm text-slate-500">{p.email}</span>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    STATUS_STYLE[p.status] ?? ''
                  }`}
                >
                  {p.status}
                </span>
              </div>

              {p.status === 'invited' ? (
                <p className="mt-2 text-xs text-warning-700">
                  Invited but has never set a password, so cannot sign in yet.
                </p>
              ) : null}

              <ul className="mt-3 space-y-1.5">
                {live.map((g) => (
                  <li key={g.id} className="flex items-baseline gap-3 text-sm">
                    <span className="font-medium text-slate-800">{g.role.name}</span>
                    <span className="text-xs text-slate-500">
                      {g.scope}
                      {g.scopeRef ? ` · ${g.scopeRef}` : ''} · v{g.roleVersion}
                    </span>
                    <span className="text-xs text-slate-400">
                      since {g.effectiveFrom.toISOString().slice(0, 10)}
                      {g.grantedBy ? ` · by ${g.grantedBy.name}` : ' · sunrise'}
                    </span>
                    {canManage ? <RevokeButton grantId={g.id} /> : null}
                  </li>
                ))}
                {live.length === 0 ? (
                  <li className="text-sm text-slate-400">No live access.</li>
                ) : null}
              </ul>

              {live.length > 0 ? (
                <p className="mt-2 text-xs text-slate-400">{live[0]?.reason}</p>
              ) : null}

              {closed.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-400">
                    {closed.length} closed grant{closed.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {closed.map((g) => (
                      <li key={g.id} className="text-xs text-slate-400">
                        {g.role.name} · {g.scope}
                        {g.scopeRef ? ` · ${g.scopeRef}` : ''} ·{' '}
                        {g.effectiveFrom.toISOString().slice(0, 10)} →{' '}
                        {g.effectiveTo?.toISOString().slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Nothing is deleted. Closing a grant sets its end date and leaves the row, so who had access
        on any given day stays answerable.
      </p>
    </div>
  );
}
