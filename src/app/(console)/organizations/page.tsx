import Link from 'next/link';
import { notFound } from 'next/navigation';

import { permissionsAt } from '../../../auth/access.ts';
import { currentActor } from '../../../auth/actor.ts';
import { listOrganizations } from '../../../orgs/orgs.ts';
import { ORG_KIND_LABELS, type OrgKind } from '../../../orgs/rules.ts';
import { CreateOrgForm } from './org-forms.tsx';

export const dynamic = 'force-dynamic';

const KIND_STYLE: Record<string, string> = {
  ownership: 'bg-slate-100 text-slate-600 ring-slate-200',
  management: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export default async function OrganizationsPage() {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  if (!held.has('org.read')) notFound();
  const canManage = held.has('org.manage');

  const orgs = await listOrganizations(true);
  const live = orgs.filter((o) => o.archivedAt === null);
  const archived = orgs.filter((o) => o.archivedAt !== null);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Organizations</h1>
      <p className="mt-1 text-sm text-slate-500">
        Ownership groups and management companies. One row each, however many hotels they hold — a
        property points at them through dated assignments, so a sale or a change of manager is a new
        row and never an edit.
      </p>

      {canManage ? <CreateOrgForm /> : null}

      {live.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-700">No organizations yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Until there is an owner and a registered management company to assign, no pipeline hotel can open.
          </p>
        </div>
      ) : (
        <table className="mt-8 w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Organization</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Kind</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Registration</th>
              <th className="border-b border-slate-200 py-2 pr-4 font-medium">Hotels</th>
              <th className="border-b border-slate-200 py-2 font-medium">Principals</th>
            </tr>
          </thead>
          <tbody>
            {live.map((o) => (
              <tr key={o.id} className="align-top">
                <td className="border-b border-slate-100 py-2.5 pr-4">
                  <Link href={`/organizations/${o.id}`} className="font-medium text-slate-900 hover:underline">
                    {o.name}
                  </Link>
                  <div className="font-mono text-xs text-slate-400">{o.id}</div>
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${KIND_STYLE[o.kind] ?? ''}`}>
                    {ORG_KIND_LABELS[o.kind as OrgKind]}
                  </span>
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4 text-xs text-slate-600">
                  {o.registrationNumber ? (
                    <>
                      <span className="font-mono">{o.registrationNumber}</span> {o.registeredState}
                    </>
                  ) : o.kind === 'management' ? (
                    <span className="text-danger-700">none — cannot manage</span>
                  ) : (
                    <span className="text-slate-400">{o.registeredState || '—'}</span>
                  )}
                </td>
                <td className="border-b border-slate-100 py-2.5 pr-4 text-slate-700">
                  {o.kind === 'ownership' ? o._count.ownerships : o._count.managements}
                </td>
                <td className="border-b border-slate-100 py-2.5 text-slate-700">
                  {o._count.principals || <span className="text-warning-700">none recorded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-slate-400">{archived.length} archived</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((o) => (
              <li key={o.id} className="text-xs text-slate-400">
                <Link href={`/organizations/${o.id}`} className="hover:underline">
                  {o.name}
                </Link>{' '}
                · <span className="font-mono">{o.id}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-6 text-xs text-slate-400">
        The management rule compares principals by email. Record every principal of both sides — a
        rule with no principals to compare passes, and proves nothing.
      </p>
    </div>
  );
}
