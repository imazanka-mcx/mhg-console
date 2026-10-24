import Link from 'next/link';
import { notFound } from 'next/navigation';

import { permissionsAt } from '../../../../auth/access.ts';
import { currentActor } from '../../../../auth/actor.ts';
import { organizationDetail } from '../../../../orgs/orgs.ts';
import { ORG_KIND_LABELS, type OrgKind } from '../../../../orgs/rules.ts';
import { AddPrincipalForm, ArchiveOrgForm, EditOrgForm, RemovePrincipalButton } from '../org-forms.tsx';

export const dynamic = 'force-dynamic';

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  if (!held.has('org.read')) notFound();
  const canManage = held.has('org.manage');

  const org = await organizationDetail(params.id);
  if (!org) notFound();

  const kind = org.kind as OrgKind;
  const assignments = kind === 'ownership' ? org.ownerships : org.managements;
  const live = assignments.filter((a) => a.effectiveTo === null);
  const past = assignments.filter((a) => a.effectiveTo !== null);
  const principals = org.principals.filter((p) => p.removedAt === null);
  const former = org.principals.filter((p) => p.removedAt !== null);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{org.name}</h1>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              {ORG_KIND_LABELS[kind]}
            </span>
            {org.archivedAt ? <span className="text-xs text-slate-400">archived</span> : null}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">{org.id}</p>
        </div>
        <Link href="/organizations" className="text-sm text-brand-600 hover:underline">
          ← Organizations
        </Link>
      </div>

      <Panel
        title="Details"
        note={
          kind === 'management'
            ? 'A management company must carry a registration — that is what makes it a registered third party.'
            : 'The group that owns the building. The single-asset entity on the deed is recorded per hotel.'
        }
      >
        {canManage ? (
          <EditOrgForm
            orgId={org.id}
            kind={kind}
            values={{
              name: org.name,
              legalName: org.legalName,
              registeredState: org.registeredState,
              registrationNumber: org.registrationNumber,
              contactName: org.contactName,
              contactEmail: org.contactEmail,
              contactPhone: org.contactPhone,
            }}
          />
        ) : (
          <dl className="space-y-1 text-sm text-slate-700">
            <div>Legal name: {org.legalName || '—'}</div>
            <div>
              Registration: {org.registrationNumber || '—'} {org.registeredState}
            </div>
            <div>
              Contact: {org.contactName || '—'} {org.contactEmail}
            </div>
          </dl>
        )}
      </Panel>

      <Panel
        title="Principals"
        note="The people who own or control this organization. The management rule refuses any pairing where one person (matched by email) is a principal of both the owner and the manager."
      >
        {principals.length ? (
          <ul className="space-y-1 text-sm">
            {principals.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="text-slate-800">{p.name}</span>
                <span className="text-xs text-slate-400">{p.email}</span>
                {p.title ? <span className="text-xs text-slate-500">{p.title}</span> : null}
                {canManage ? <RemovePrincipalButton orgId={org.id} principalId={p.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-warning-700">None recorded — the management rule has nothing to compare.</p>
        )}
        {former.length ? (
          <p className="mt-3 text-xs text-slate-400">
            Former: {former.map((p) => `${p.name} (removed ${p.removedAt!.toISOString().slice(0, 10)})`).join(', ')}
          </p>
        ) : null}
        {canManage ? <AddPrincipalForm orgId={org.id} /> : null}
      </Panel>

      <Panel title={kind === 'ownership' ? 'Hotels owned' : 'Hotels managed'}>
        {live.length ? (
          <ul className="space-y-1 text-sm">
            {live.map((a) => (
              <li key={a.id} className="flex gap-3">
                <Link href={`/portfolio/${a.property.id}`} className="font-mono font-semibold text-brand-600 hover:underline">
                  {a.property.code}
                </Link>
                <span className="text-slate-600">{a.property.name}</span>
                <span className="text-xs text-slate-400">
                  {a.property.status} · since {a.effectiveFrom}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">None right now.</p>
        )}
        {past.length ? (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {past.map((a) => (
              <li key={a.id}>
                <span className="font-mono">{a.property.code}</span> · {a.effectiveFrom} → {a.effectiveTo}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {canManage ? (
        <div>
          <ArchiveOrgForm orgId={org.id} archived={org.archivedAt !== null} />
        </div>
      ) : null}
    </div>
  );
}
