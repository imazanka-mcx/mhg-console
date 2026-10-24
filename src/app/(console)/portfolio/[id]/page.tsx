import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PropertyStatus } from '@mcx/inn-code';

import { permissionsAt } from '../../../../auth/access.ts';
import { currentActor } from '../../../../auth/actor.ts';
import { prisma } from '../../../../db.ts';
import { TRANSITION_LABELS, nextStatuses } from '../../../../lifecycle.ts';
import { controlFor, listOrganizations } from '../../../../orgs/orgs.ts';
import {
  PIP_LABELS,
  PIP_STATUSES,
  SERVICE_LEVELS,
  SERVICE_LEVEL_LABELS,
  blocks,
  type Finding,
  type ServiceLevel,
} from '../../../../orgs/rules.ts';
import { COMMON_TIMEZONES } from '../../../../setup.ts';
import { provisioningFor } from '../../../../shell/publish.ts';
import {
  AssetForm,
  AssignManagementForm,
  AssignOwnershipForm,
  DeliverNow,
  EndAssignmentForm,
  LifecycleForm,
  ManagementTermsForm,
  OwnershipTermsForm,
  SetupForm,
} from './property-forms.tsx';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  pipeline: 'bg-warning-50 text-warning-700 ring-warning-200',
  active: 'bg-success-50 text-success-700 ring-success-200',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATE_STYLE: Record<string, string> = {
  current: 'text-success-700',
  behind: 'text-warning-700',
  never: 'text-slate-400',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="w-40 shrink-0 text-slate-400">{label}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {findings.map((f) => (
        <li key={f.code + f.message} className={f.level === 'block' ? 'text-danger-700' : 'text-warning-700'}>
          {f.level === 'block' ? '✕' : '!'} {f.message}
        </li>
      ))}
    </ul>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400">{children}</span>;
}

function term(from: string, to: string): string {
  if (!from && !to) return '—';
  return `${from || '?'} → ${to || 'open-ended'}`;
}

export default async function PropertyPage({ params }: { params: { id: string } }) {
  const actor = await currentActor();
  const held = actor ? await permissionsAt(actor.id) : new Set<string>();
  if (!held.has('property.read')) notFound();

  const property = await prisma.property.findUnique({
    where: { id: params.id },
    include: {
      codes: { orderBy: { issuedAt: 'asc' } },
      groups: { include: { group: { select: { id: true, name: true, kind: true } } } },
    },
  });
  if (!property) notFound();

  const canSeeControl = held.has('org.read');
  const canControl = held.has('org.manage');

  const [claim, provisioning, events, control, orgs] = await Promise.all([
    prisma.marketClaim.findUnique({ where: { marketCode: property.marketCode } }),
    provisioningFor(property.id),
    prisma.shellEvent.findMany({ where: { propertyId: property.id }, orderBy: { seq: 'desc' }, take: 8 }),
    controlFor(property.id),
    canControl ? listOrganizations() : Promise.resolve([]),
  ]);
  const owners = orgs.filter((o) => o.kind === 'ownership').map((o) => ({ id: o.id, name: o.name }));
  const managers = orgs.filter((o) => o.kind === 'management').map((o) => ({ id: o.id, name: o.name }));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: property.timezone }).format(new Date());
  const { ownership, management } = control;
  const openBlocks = blocks(control.findings);

  const status = property.status as PropertyStatus;
  const moves = nextStatuses(status).map((m) => ({ to: m.to, label: TRANSITION_LABELS[m.transition] }));
  const pastOpening =
    status === 'pipeline' &&
    property.expectedOpenDate !== '' &&
    property.expectedOpenDate < new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold text-slate-900">{property.code}</h1>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status] ?? ''}`}>
              {status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{property.name}</p>
        </div>
        <Link href="/portfolio" className="text-sm text-brand-600 hover:underline">
          ← Portfolio
        </Link>
      </div>

      {pastOpening ? (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Expected to open {property.expectedOpenDate} and still pipeline. Open it, move the date, or abandon it.
        </div>
      ) : null}

      <Panel title="Identity" note="What the shell carries. The property ID is what consumers key on — never the code (G1).">
        <dl>
          <Fact label="Property ID">
            <span className="font-mono text-xs">{property.id}</span>
          </Fact>
          <Fact label="Brand">
            <span className="font-mono">{property.brandCode}</span> {property.brandName}{' '}
            <span className="text-slate-400">({property.chainCode})</span>
          </Fact>
          <Fact label="Market">
            <span className="font-mono">{property.marketCode}</span>{' '}
            <span className="text-slate-400">via {claim?.source ?? 'unknown'}</span> · {property.city}, {property.state}
            {property.submarket ? ` · ${property.submarket}` : ''}
          </Fact>
          <Fact label="Code issued">{property.effectiveDate}</Fact>
          {property.predecessorCode ? (
            <Fact label="Replaces">
              <span className="font-mono">{property.predecessorCode}</span>
            </Fact>
          ) : null}
          {property.franchisorCode ? (
            <Fact label="Franchisor ref">
              <span className="font-mono">{property.franchisorCode}</span>{' '}
              <span className="text-slate-400">cross-reference only (G5)</span>
            </Fact>
          ) : null}
          <Fact label="Groups">
            {property.groups.length
              ? property.groups.map((m, i) => (
                  <span key={m.groupId}>
                    {i ? ', ' : ''}
                    <Link href={`/groups/${m.groupId}`} className="text-brand-600 hover:underline">
                      {m.group.name}
                    </Link>
                  </span>
                ))
              : <span className="text-slate-400">none</span>}
          </Fact>
        </dl>
      </Panel>


      {canSeeControl ? (
        <Panel
          title="Ownership & control"
          note="Who owns the building and who runs it. Every MHG hotel is run by a registered third-party management company that is not one of its owner's principals — opening is refused until that holds. Console-only: not in the shell."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ownership</h3>
              {ownership ? (
                <dl className="mt-2">
                  <Fact label="Ownership group">
                    <Link href={`/organizations/${ownership.organizationId}`} className="text-brand-600 hover:underline">
                      {ownership.organization.name}
                    </Link>{' '}
                    <Muted>since {ownership.effectiveFrom}</Muted>
                  </Fact>
                  <Fact label="Title entity">
                    {ownership.titleEntity || <Muted>not recorded</Muted>}
                    {ownership.titleEntityState ? <Muted> · {ownership.titleEntityState}</Muted> : null}
                  </Fact>
                  <Fact label="MHG licence">{term(ownership.licenseEffectiveDate, ownership.licenseExpiryDate)}</Fact>
                  {ownership.organization.contactName ? (
                    <Fact label="Owner contact">
                      {ownership.organization.contactName}
                      {ownership.organization.contactEmail ? <Muted> · {ownership.organization.contactEmail}</Muted> : null}
                    </Fact>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No ownership group assigned.</p>
              )}
              {canControl ? (
                <>
                  {ownership ? (
                    <OwnershipTermsForm
                      propertyId={property.id}
                      terms={{
                        titleEntity: ownership.titleEntity,
                        titleEntityState: ownership.titleEntityState,
                        licenseEffectiveDate: ownership.licenseEffectiveDate,
                        licenseExpiryDate: ownership.licenseExpiryDate,
                      }}
                    />
                  ) : null}
                  <AssignOwnershipForm propertyId={property.id} owners={owners} today={today} replacing={!!ownership} />
                  {ownership && status !== 'active' && !management ? (
                    <EndAssignmentForm propertyId={property.id} which="ownership" today={today} />
                  ) : null}
                </>
              ) : null}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Management</h3>
              {management ? (
                <dl className="mt-2">
                  <Fact label="Management company">
                    <Link href={`/organizations/${management.organizationId}`} className="text-brand-600 hover:underline">
                      {management.organization.name}
                    </Link>{' '}
                    <Muted>since {management.effectiveFrom}</Muted>
                  </Fact>
                  <Fact label="Registration">
                    {management.organization.registrationNumber ? (
                      <>
                        <span className="font-mono text-xs">{management.organization.registrationNumber}</span>{' '}
                        <Muted>{management.organization.registeredState}</Muted>
                      </>
                    ) : (
                      <span className="text-danger-700">none on file</span>
                    )}
                  </Fact>
                  <Fact label="Agreement">
                    {term(management.effectiveFrom, management.agreementExpiryDate)}
                    {management.terminationNoticeDays !== null ? <Muted> · {management.terminationNoticeDays}-day notice</Muted> : null}
                  </Fact>
                  {management.organization.contactName ? (
                    <Fact label="Manager contact">
                      {management.organization.contactName}
                      {management.organization.contactEmail ? <Muted> · {management.organization.contactEmail}</Muted> : null}
                    </Fact>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No management company assigned{ownership ? '.' : ' — assign the owner first; the manager is checked against it.'}
                </p>
              )}
              {canControl && ownership ? (
                <>
                  {management ? (
                    <ManagementTermsForm
                      propertyId={property.id}
                      terms={{
                        agreementExpiryDate: management.agreementExpiryDate,
                        terminationNoticeDays: management.terminationNoticeDays,
                      }}
                    />
                  ) : null}
                  <AssignManagementForm propertyId={property.id} managers={managers} today={today} replacing={!!management} />
                  {management && status !== 'active' ? (
                    <EndAssignmentForm propertyId={property.id} which="management" today={today} />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            {openBlocks.length === 0 && control.findings.length === 0 ? (
              <p className="text-xs text-success-700">✓ Owner and management company pass the management rule.</p>
            ) : (
              <Findings findings={control.findings} />
            )}
          </div>

          {control.ownershipHistory.length || control.managementHistory.length ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-slate-400">Earlier owners and managers</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {control.ownershipHistory.map((h) => (
                  <li key={h.id}>
                    owner · {h.organization.name} · {h.effectiveFrom} → {h.effectiveTo} · <Muted>{h.reason}</Muted>
                  </li>
                ))}
                {control.managementHistory.map((h) => (
                  <li key={h.id}>
                    manager · {h.organization.name} · {h.effectiveFrom} → {h.effectiveTo} · <Muted>{h.reason}</Muted>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Lifecycle"
          note="Forward only: pipeline → active → retired, or pipeline → retired if the deal dies. Flag changes are a rebrand, not a status."
        >
          {status === 'pipeline' && openBlocks.length ? (
            <div className="mb-4 rounded border border-warning-200 bg-warning-50 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-warning-800">Cannot open yet</p>
              <Findings findings={openBlocks} />
            </div>
          ) : null}
          {held.has('property.status') ? (
            <LifecycleForm propertyId={property.id} code={property.code} moves={moves} />
          ) : (
            <p className="text-sm text-slate-500">You can view this lifecycle but not move it.</p>
          )}
        </Panel>

        <Panel title="Stand-up details" note="Not part of the code. Consumers stand the hotel up on these.">
          {held.has('property.issue') ? (
            <SetupForm
              propertyId={property.id}
              timezone={property.timezone}
              currency={property.currency}
              expectedOpenDate={property.expectedOpenDate}
              timezones={COMMON_TIMEZONES}
            />
          ) : (
            <dl>
              <Fact label="Timezone">{property.timezone}</Fact>
              <Fact label="Currency">{property.currency}</Fact>
              <Fact label="Expected opening">{property.expectedOpenDate || '—'}</Fact>
            </dl>
          )}
        </Panel>
      </div>


      <Panel
        title="The asset"
        note="The building and its brand compliance. Console-only — room types and inventory stay in Inspire."
      >
        {held.has('property.issue') ? (
          <AssetForm
            propertyId={property.id}
            values={{
              streetAddress: property.streetAddress,
              postalCode: property.postalCode,
              keyCount: property.keyCount,
              serviceLevel: property.serviceLevel,
              yearOpened: property.yearOpened,
              yearRenovated: property.yearRenovated,
              pipStatus: property.pipStatus,
              pipDueDate: property.pipDueDate,
              qaLastDate: property.qaLastDate,
              qaLastResult: property.qaLastResult,
            }}
            serviceLevels={SERVICE_LEVELS.map((k) => ({ id: k, name: SERVICE_LEVEL_LABELS[k] }))}
            pipStatuses={PIP_STATUSES.map((k) => ({ id: k, name: PIP_LABELS[k] }))}
          />
        ) : (
          <dl>
            <Fact label="Address">
              {property.streetAddress ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.postalCode}` : <Muted>—</Muted>}
            </Fact>
            <Fact label="Keys">{property.keyCount ?? <Muted>—</Muted>}</Fact>
            <Fact label="Service level">
              {property.serviceLevel ? SERVICE_LEVEL_LABELS[property.serviceLevel as ServiceLevel] ?? property.serviceLevel : <Muted>—</Muted>}
            </Fact>
            <Fact label="Opened / renovated">
              {property.yearOpened ?? '—'} / {property.yearRenovated ?? '—'}
            </Fact>
            <Fact label="PIP">
              {PIP_LABELS[property.pipStatus as keyof typeof PIP_LABELS] ?? property.pipStatus}
              {property.pipDueDate ? <Muted> · due {property.pipDueDate}</Muted> : null}
            </Fact>
            <Fact label="Last brand QA">
              {property.qaLastDate ? `${property.qaLastDate} · ${property.qaLastResult}` : <Muted>never</Muted>}
            </Fact>
          </dl>
        )}
      </Panel>

      <Panel
        title="Provisioning"
        note={`Who mirrors this property, and whether they have its latest shell (v${property.shellVersion}). The console is never on their critical path — a consumer that is behind keeps running from its own copy.`}
      >
        {provisioning.length === 0 ? (
          <p className="text-sm text-slate-500">
            No consumers registered yet. <span className="font-mono text-xs">npm run shell -- subscribe --name inspire …</span>
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {provisioning.map((row) => (
                <tr key={row.subscriber} className="border-b border-slate-100 align-top last:border-0">
                  <td className="py-2 pr-4 font-medium text-slate-700">{row.subscriber}</td>
                  <td className={`py-2 pr-4 ${STATE_STYLE[row.state] ?? ''}`}>
                    {row.active ? row.state : 'paused'}
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {row.lastError ? <span className="text-danger-600">{row.lastError}</span> : null}
                    {!row.lastError && row.lastDeliveredAt ? `last delivered ${row.lastDeliveredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {held.has('property.status') && provisioning.length ? (
          <div className="mt-4">
            <DeliverNow propertyId={property.id} />
          </div>
        ) : null}
      </Panel>

      <Panel title="History" note="The ledger never deletes. Every code this hotel has flown, and its recent shell changes.">
        <ul className="space-y-1 text-sm">
          {property.codes.map((c) => (
            <li key={c.code} className="flex gap-3">
              <span className="font-mono font-semibold text-slate-800">{c.code}</span>
              <span className="text-slate-500">{c.status}</span>
              <span className="text-slate-400">issued {c.effectiveDate}</span>
            </li>
          ))}
        </ul>
        {events.length ? (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {events.map((e) => (
              <li key={e.seq} className="flex gap-3">
                <span className="w-12 font-mono text-slate-400">#{e.seq}</span>
                <span className="w-10">v{e.shellVersion}</span>
                <span className="w-16">{e.reason}</span>
                <span className="text-slate-400">{e.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}
