import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '../../../../db.ts';
import { permissionsAt, hasConsoleAccess } from '../../../../auth/access.ts';
import { currentActor } from '../../../../auth/actor.ts';
import { ROLES } from '../../../../auth/catalog.ts';
import { listGroups } from '../../../../groups/groups.ts';
import { peopleProvisioningFor } from '../../../../people/publish.ts';
import { RevokeButton } from '../revoke-button.tsx';
import { ChangeGrant, ProfileForm, ResetPasswordForm, StatusForm } from './person-forms.tsx';

export const dynamic = 'force-dynamic';

const APP_LABEL: Record<string, string> = { inspire: 'Inspire', inspiredrev: 'InspiredREV' };
const pretty = (k: string) => k.replace(/_/g, ' ');

export default async function PersonPage({ params }: { params: { id: string } }) {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  if (!held.has('people.read')) notFound();
  const canManage = held.has('people.manage');

  const person = await prisma.person.findUnique({
    where: { id: params.id },
    include: {
      grants: {
        orderBy: { effectiveFrom: 'desc' },
        include: { role: true, grantedBy: { select: { name: true } }, downstream: true },
      },
    },
  });
  if (!person) notFound();

  const [groups, delivery, usesConsole] = await Promise.all([
    listGroups(),
    peopleProvisioningFor(person.id),
    hasConsoleAccess(person.id),
  ]);
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind as string, members: g._count.members }));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const live = person.grants.filter((g) => g.effectiveTo === null);
  const closed = person.grants.filter((g) => g.effectiveTo !== null);

  return (
    <div className="max-w-4xl">
      <Link href="/people" className="text-sm text-brand-600 hover:underline">← People</Link>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{person.name}</h1>
        <span className="text-sm text-slate-500">{person.status}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {person.email} · {usesConsole ? 'uses the MHG Console' : 'Inspire and InspiredREV only — no console access'}
      </p>

      <section className="mt-6 rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Access</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {live.map((g) => {
            const down = Object.fromEntries(g.downstream.map((d) => [d.consumer, d.consumerRole])) as Record<string, string>;
            return (
              <li key={g.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-slate-800">{g.role.name}</span>
                  <span className="text-xs text-slate-500">
                    {g.scope}
                    {g.scopeRef ? ` · ${g.scope === 'group' ? (groupName.get(g.scopeRef) ?? g.scopeRef) : g.scopeRef}` : ''}
                  </span>
                  {Object.keys(down).length ? (
                    <span className="text-xs text-slate-500">
                      {Object.entries(down)
                        .map(([app, role]) => `${APP_LABEL[app] ?? app}: ${pretty(role)}`)
                        .join(' · ')}
                    </span>
                  ) : null}
                  <span className="text-xs text-slate-400">
                    since {g.effectiveFrom.toISOString().slice(0, 10)}
                    {g.grantedBy ? ` · by ${g.grantedBy.name}` : ' · sunrise'}
                  </span>
                  {canManage ? (
                    <span className="ml-auto flex gap-3">
                      <RevokeButton grantId={g.id} />
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-400">{g.reason}</p>
                {canManage ? (
                  <ChangeGrant
                    personId={person.id}
                    grantId={g.id}
                    roles={ROLES}
                    groups={groupOptions}
                    initial={{
                      roleKey: g.roleKey,
                      scope: g.scope,
                      scopeRef: g.scopeRef ?? '',
                      downstream: down as Partial<Record<'inspire' | 'inspiredrev', string>>,
                    }}
                  />
                ) : null}
              </li>
            );
          })}
          {live.length === 0 ? <li className="py-3 text-sm text-slate-400">No live access.</li> : null}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          To add another grant, use Grant access on People with this email.
        </p>
      </section>

      <section className="mt-4 rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Delivered to</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {delivery.map((d) => (
            <li key={d.subscriber}>
              <span className="font-medium">{APP_LABEL[d.subscriber] ?? d.subscriber}</span>{' '}
              <span className={d.state === 'current' ? 'text-success-700' : 'text-warning-700'}>{d.state}</span>
              {d.lastError ? <span className="ml-2 text-xs text-danger-600">{d.lastError}</span> : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          Changes take effect in Inspire and InspiredREV at the person’s next sign-in.
        </p>
      </section>

      {canManage ? (
        <div className="mt-4 grid gap-4">
          <ProfileForm personId={person.id} name={person.name} email={person.email} />
          <div className="grid gap-4 sm:grid-cols-2">
            <StatusForm personId={person.id} status={person.status} isSelf={actor?.id === person.id} />
            <ResetPasswordForm personId={person.id} disabled={person.status === 'offboarded'} />
          </div>
        </div>
      ) : null}

      {closed.length > 0 ? (
        <details className="mt-4 rounded-lg bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm text-slate-500">
            {closed.length} closed grant{closed.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((g) => (
              <li key={g.id} className="text-xs text-slate-400">
                {g.role.name} · {g.scope}
                {g.scopeRef ? ` · ${g.scopeRef}` : ''} · {g.effectiveFrom.toISOString().slice(0, 10)} →{' '}
                {g.effectiveTo?.toISOString().slice(0, 10)} · {g.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
