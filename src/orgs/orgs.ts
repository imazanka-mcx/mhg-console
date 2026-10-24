import { prisma } from '../db.ts';
import {
  blocks,
  checkAsset,
  checkAssignmentStart,
  checkOptionalDate,
  checkOrganization,
  checkPrincipal,
  checkTerm,
  managementFindings,
  openFindings,
  slugForOrgName,
  type AssetInput,
  type Finding,
  type OrgFacts,
  type OrgInput,
  type OrgKind,
  type PrincipalInput,
} from './rules.ts';

/**
 * Ownership and control, against the database (docs/01 §1.7).
 *
 * Console-only data: nothing here publishes to the shell stream or bumps
 * shellVersion. Every write is audited. The rules live in rules.ts; this file
 * gathers the facts they need and refuses what they refuse, so the property
 * page, the organization page and the lifecycle gate all decide the same way.
 */

type Client = typeof prisma;

function firstError(errors: Record<string, string | undefined>): string {
  return Object.values(errors).filter(Boolean).join(' ');
}

// ─────────────────────────────── reading ──────────────────────────────────

const LIVE_PRINCIPALS = { where: { removedAt: null }, orderBy: { addedAt: 'asc' } } as const;

type OrgWithPrincipals = {
  id: string;
  kind: string;
  name: string;
  registeredState: string;
  registrationNumber: string;
  archivedAt: Date | null;
  principals: { name: string; email: string }[];
};

export function factsOf(org: OrgWithPrincipals): OrgFacts {
  return {
    id: org.id,
    kind: org.kind as OrgKind,
    name: org.name,
    registeredState: org.registeredState,
    registrationNumber: org.registrationNumber,
    archived: org.archivedAt !== null,
    principals: org.principals.map((p) => ({ name: p.name, email: p.email })),
  };
}

export function listOrganizations(includeArchived = false) {
  return prisma.organization.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          ownerships: { where: { effectiveTo: null } },
          managements: { where: { effectiveTo: null } },
          principals: { where: { removedAt: null } },
        },
      },
    },
  });
}

export function organizationDetail(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: {
      principals: { orderBy: { addedAt: 'asc' } },
      ownerships: {
        orderBy: { effectiveFrom: 'desc' },
        include: { property: { select: { id: true, code: true, name: true, status: true } } },
      },
      managements: {
        orderBy: { effectiveFrom: 'desc' },
        include: { property: { select: { id: true, code: true, name: true, status: true } } },
      },
    },
  });
}

/** Everything the property page and the open gate need, in one read. */
export async function controlFor(propertyId: string, client: Client = prisma) {
  const property = await client.property.findUnique({
    where: { id: propertyId },
    select: { id: true, code: true, status: true, streetAddress: true, keyCount: true },
  });
  if (!property) throw new Error('No such property.');

  const orgInclude = { organization: { include: { principals: LIVE_PRINCIPALS } } } as const;
  const [ownership, management, ownershipHistory, managementHistory] = await Promise.all([
    client.propertyOwnership.findFirst({ where: { propertyId, effectiveTo: null }, include: orgInclude }),
    client.propertyManagement.findFirst({ where: { propertyId, effectiveTo: null }, include: orgInclude }),
    client.propertyOwnership.findMany({
      where: { propertyId, effectiveTo: { not: null } },
      orderBy: { effectiveFrom: 'desc' },
      include: { organization: { select: { id: true, name: true } } },
    }),
    client.propertyManagement.findMany({
      where: { propertyId, effectiveTo: { not: null } },
      orderBy: { effectiveFrom: 'desc' },
      include: { organization: { select: { id: true, name: true } } },
    }),
  ]);

  const findings: Finding[] = openFindings({
    owner: ownership ? factsOf(ownership.organization) : null,
    manager: management ? factsOf(management.organization) : null,
    streetAddress: property.streetAddress,
    keyCount: property.keyCount,
  });

  return { property, ownership, management, ownershipHistory, managementHistory, findings };
}

/**
 * Throws unless the property may open. Called by changeStatus on the `open`
 * transition, so the UI and the CLI share one gate.
 */
export async function assertReadyToOpen(propertyId: string, client: Client = prisma): Promise<void> {
  const { property, findings } = await controlFor(propertyId, client);
  const stop = blocks(findings);
  if (stop.length) {
    throw new Error(`${property.code} cannot open yet: ${stop.map((f) => f.message).join(' ')}`);
  }
}

// ─────────────────────────────── organizations ────────────────────────────

async function uniqueOrgId(name: string): Promise<string> {
  const base = slugForOrgName(name);
  for (let n = 1; n < 100; n++) {
    const id = n === 1 ? base : `${base}_${n}`;
    if (!(await prisma.organization.findUnique({ where: { id }, select: { id: true } }))) return id;
  }
  throw new Error('Could not mint an organization id — too many with that name.');
}

export async function createOrganization(
  input: Partial<Record<keyof OrgInput, string | undefined>>,
  actorId: string | null,
) {
  const checked = checkOrganization(input);
  if (!checked.ok) throw new Error(firstError(checked.errors));
  const id = await uniqueOrgId(checked.value.name);
  const org = await prisma.organization.create({ data: { id, ...checked.value } });
  await prisma.auditEvent.create({
    data: { actorId, action: 'org.create', subject: id, detail: { ...checked.value } },
  });
  return org;
}

/**
 * Edits details. Kind is fixed at creation: an ownership group that became a
 * manager would silently change what every assignment on it means. Removing a
 * management company's registration is refused while it runs a hotel.
 */
export async function updateOrganization(
  id: string,
  input: Partial<Record<keyof OrgInput, string | undefined>>,
  actorId: string | null,
) {
  const before = await prisma.organization.findUnique({ where: { id } });
  if (!before) throw new Error('No such organization.');
  const checked = checkOrganization({ ...input, kind: before.kind });
  if (!checked.ok) throw new Error(firstError(checked.errors));

  const { kind: _kind, ...data } = checked.value;
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== before[k]);
  if (!changed.length) return before;

  const org = await prisma.organization.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'org.update',
      subject: id,
      detail: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: data[k] }])),
    },
  });
  return org;
}

/**
 * Archiving a management company that still runs a hotel is refused — it
 * would put that hotel out of compliance by a click.
 */
export async function setOrganizationArchived(id: string, archived: boolean, actorId: string | null) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: { _count: { select: { managements: { where: { effectiveTo: null } }, ownerships: { where: { effectiveTo: null } } } } },
  });
  if (!org) throw new Error('No such organization.');
  if (archived && (org._count.managements || org._count.ownerships)) {
    throw new Error(`${org.name} is still assigned to ${org._count.managements + org._count.ownerships} propert(ies). Reassign them first.`);
  }
  await prisma.organization.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await prisma.auditEvent.create({
    data: { actorId, action: archived ? 'org.archive' : 'org.restore', subject: id, detail: {} },
  });
}

/**
 * Every live owner–manager pairing this organization is part of. Adding a
 * principal can break the management rule on any of them, so each one is
 * re-checked before the principal is written.
 */
async function livePairingsFor(orgId: string) {
  const orgInclude = { organization: { include: { principals: LIVE_PRINCIPALS } } } as const;
  const [asOwner, asManager] = await Promise.all([
    prisma.propertyOwnership.findMany({ where: { organizationId: orgId, effectiveTo: null }, select: { propertyId: true } }),
    prisma.propertyManagement.findMany({ where: { organizationId: orgId, effectiveTo: null }, select: { propertyId: true } }),
  ]);
  const propertyIds = [...new Set([...asOwner, ...asManager].map((r) => r.propertyId))];
  const pairs: { code: string; owner: OrgFacts; manager: OrgFacts }[] = [];
  for (const propertyId of propertyIds) {
    const [o, m, p] = await Promise.all([
      prisma.propertyOwnership.findFirst({ where: { propertyId, effectiveTo: null }, include: orgInclude }),
      prisma.propertyManagement.findFirst({ where: { propertyId, effectiveTo: null }, include: orgInclude }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { code: true } }),
    ]);
    if (o && m && p) pairs.push({ code: p.code, owner: factsOf(o.organization), manager: factsOf(m.organization) });
  }
  return pairs;
}

export async function addPrincipal(
  orgId: string,
  input: Partial<Record<keyof PrincipalInput, string | undefined>>,
  actorId: string | null,
) {
  const checked = checkPrincipal(input);
  if (!checked.ok) throw new Error(checked.error);
  const p = checked.value;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { principals: LIVE_PRINCIPALS } });
  if (!org) throw new Error('No such organization.');
  if (org.principals.some((x) => x.email === p.email)) throw new Error(`${p.email} is already a principal of ${org.name}.`);

  // Would this principal break a live pairing? Check with them added.
  for (const pair of await livePairingsFor(orgId)) {
    const add = (f: OrgFacts) => (f.id === orgId ? { ...f, principals: [...f.principals, p] } : f);
    const stop = blocks(managementFindings(add(pair.owner), add(pair.manager)));
    if (stop.length) {
      throw new Error(`Refused — at ${pair.code} this would break the management rule. ${stop.map((f) => f.message).join(' ')}`);
    }
  }

  const row = await prisma.organizationPrincipal.create({
    data: { organizationId: orgId, name: p.name, email: p.email, title: p.title, addedById: actorId },
  });
  await prisma.auditEvent.create({
    data: { actorId, action: 'org.principal.add', subject: orgId, detail: { ...p } },
  });
  return row;
}

export async function removePrincipal(principalId: string, actorId: string | null) {
  const row = await prisma.organizationPrincipal.findUnique({ where: { id: principalId } });
  if (!row || row.removedAt) throw new Error('No such principal.');
  await prisma.organizationPrincipal.update({ where: { id: principalId }, data: { removedAt: new Date() } });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'org.principal.remove',
      subject: row.organizationId,
      detail: { name: row.name, email: row.email },
    },
  });
}

// ─────────────────────────────── assignments ──────────────────────────────

export interface OwnershipInput {
  organizationId: string;
  effectiveFrom: string;
  titleEntity: string;
  titleEntityState: string;
  licenseEffectiveDate: string;
  licenseExpiryDate: string;
  reason: string;
}

export interface ManagementInput {
  organizationId: string;
  effectiveFrom: string;
  agreementExpiryDate: string;
  terminationNoticeDays: string;
  reason: string;
}

async function orgFacts(id: string): Promise<OrgFacts> {
  const org = await prisma.organization.findUnique({ where: { id }, include: { principals: LIVE_PRINCIPALS } });
  if (!org) throw new Error('No such organization.');
  return factsOf(org);
}

function needReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 3) throw new Error('Say why — it goes in the audit trail.');
  return r.slice(0, 240);
}

function ownershipTerms(input: Pick<OwnershipInput, 'titleEntity' | 'titleEntityState' | 'licenseEffectiveDate' | 'licenseExpiryDate'>) {
  const titleEntityState = input.titleEntityState.trim().toUpperCase();
  const licenseEffectiveDate = input.licenseEffectiveDate.trim();
  const licenseExpiryDate = input.licenseExpiryDate.trim();
  const bad = [
    titleEntityState && !/^[A-Z]{2}$/.test(titleEntityState) ? 'Title entity state is a two-letter code.' : null,
    checkOptionalDate('Licence effective date', licenseEffectiveDate),
    checkOptionalDate('Licence expiry', licenseExpiryDate),
    checkTerm('The licence', licenseEffectiveDate, licenseExpiryDate),
  ].filter(Boolean);
  if (bad.length) throw new Error(bad.join(' '));
  return { titleEntity: input.titleEntity.trim().slice(0, 160), titleEntityState, licenseEffectiveDate, licenseExpiryDate };
}

function managementTerms(input: Pick<ManagementInput, 'agreementExpiryDate' | 'terminationNoticeDays'>, effectiveFrom: string) {
  const agreementExpiryDate = input.agreementExpiryDate.trim();
  const notice = input.terminationNoticeDays.trim();
  const bad = [
    checkOptionalDate('Agreement expiry', agreementExpiryDate),
    checkTerm('The management agreement', effectiveFrom, agreementExpiryDate),
    notice && !/^\d{1,4}$/.test(notice) ? 'Termination notice is a number of days.' : null,
  ].filter(Boolean);
  if (bad.length) throw new Error(bad.join(' '));
  return { agreementExpiryDate, terminationNoticeDays: notice ? Number(notice) : null };
}

/**
 * Assign (or change) who owns the building. The live row closes on the new
 * row's start date. If a manager is assigned, the rule is re-checked against
 * the NEW owner first — a sale to the manager's principals must not slip in
 * through the ownership door.
 */
export async function assignOwnership(propertyId: string, input: OwnershipInput, actorId: string | null) {
  const reason = needReason(input.reason);
  const { property, ownership, management } = await controlFor(propertyId);
  const owner = await orgFacts(input.organizationId);
  if (owner.kind !== 'ownership') throw new Error(`${owner.name} is not an ownership group.`);
  if (owner.archived) throw new Error(`${owner.name} is archived.`);
  if (ownership?.organizationId === owner.id) {
    throw new Error(`${owner.name} already owns ${property.code}. Edit the terms instead.`);
  }
  const startErr = checkAssignmentStart(input.effectiveFrom.trim(), ownership?.effectiveFrom ?? null);
  if (startErr) throw new Error(startErr);
  const terms = ownershipTerms(input);

  if (management) {
    const stop = blocks(managementFindings(owner, factsOf(management.organization)));
    if (stop.length) throw new Error(`Refused — ${stop.map((f) => f.message).join(' ')}`);
  }

  const effectiveFrom = input.effectiveFrom.trim();
  await prisma.$transaction(async (tx) => {
    await tx.propertyOwnership.updateMany({ where: { propertyId, effectiveTo: null }, data: { effectiveTo: effectiveFrom } });
    await tx.propertyOwnership.create({
      data: { propertyId, organizationId: owner.id, effectiveFrom, assignedById: actorId, reason, ...terms },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: 'property.ownership',
        subject: property.code,
        detail: { from: ownership?.organizationId ?? null, to: owner.id, effectiveFrom, reason, ...terms },
      },
    });
  });
}

/**
 * Assign (or change) the management company. Checked against the live owner,
 * so ownership comes first — there is nothing to check a manager against
 * until somebody owns the building.
 */
export async function assignManagement(propertyId: string, input: ManagementInput, actorId: string | null) {
  const reason = needReason(input.reason);
  const { property, ownership, management } = await controlFor(propertyId);
  if (!ownership) throw new Error('Assign the ownership group first — the management company is checked against it.');
  const manager = await orgFacts(input.organizationId);
  if (management?.organizationId === manager.id) {
    throw new Error(`${manager.name} already manages ${property.code}. Edit the terms instead.`);
  }
  const effectiveFrom = input.effectiveFrom.trim();
  const startErr = checkAssignmentStart(effectiveFrom, management?.effectiveFrom ?? null);
  if (startErr) throw new Error(startErr);
  const terms = managementTerms(input, effectiveFrom);

  const stop = blocks(managementFindings(factsOf(ownership.organization), manager));
  if (stop.length) throw new Error(`Refused — ${stop.map((f) => f.message).join(' ')}`);

  await prisma.$transaction(async (tx) => {
    await tx.propertyManagement.updateMany({ where: { propertyId, effectiveTo: null }, data: { effectiveTo: effectiveFrom } });
    await tx.propertyManagement.create({
      data: { propertyId, organizationId: manager.id, effectiveFrom, assignedById: actorId, reason, ...terms },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: 'property.management',
        subject: property.code,
        detail: { from: management?.organizationId ?? null, to: manager.id, effectiveFrom, reason, ...terms },
      },
    });
  });
}

/** Edit the terms on the live assignment without changing who holds it. */
export async function updateOwnershipTerms(
  propertyId: string,
  input: Pick<OwnershipInput, 'titleEntity' | 'titleEntityState' | 'licenseEffectiveDate' | 'licenseExpiryDate'>,
  actorId: string | null,
) {
  const { property, ownership } = await controlFor(propertyId);
  if (!ownership) throw new Error('No ownership is assigned.');
  const terms = ownershipTerms(input);
  const changed = (Object.keys(terms) as (keyof typeof terms)[]).filter((k) => terms[k] !== ownership[k]);
  if (!changed.length) return;
  await prisma.propertyOwnership.update({ where: { id: ownership.id }, data: terms });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'property.ownership.terms',
      subject: property.code,
      detail: Object.fromEntries(changed.map((k) => [k, { from: ownership[k], to: terms[k] }])),
    },
  });
}

export async function updateManagementTerms(
  propertyId: string,
  input: Pick<ManagementInput, 'agreementExpiryDate' | 'terminationNoticeDays'>,
  actorId: string | null,
) {
  const { property, management } = await controlFor(propertyId);
  if (!management) throw new Error('No management company is assigned.');
  const terms = managementTerms(input, management.effectiveFrom);
  const changed = (Object.keys(terms) as (keyof typeof terms)[]).filter((k) => terms[k] !== management[k]);
  if (!changed.length) return;
  await prisma.propertyManagement.update({ where: { id: management.id }, data: terms });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'property.management.terms',
      subject: property.code,
      detail: Object.fromEntries(changed.map((k) => [k, { from: management[k], to: terms[k] }])),
    },
  });
}

/**
 * End an assignment with no successor. Refused on an active hotel: an
 * active MHG hotel always has an owner and a registered manager, so the only
 * way to change either is to assign the next one.
 */
export async function endAssignment(
  propertyId: string,
  which: 'ownership' | 'management',
  effectiveTo: string,
  reason: string,
  actorId: string | null,
) {
  const why = needReason(reason);
  const { property, ownership, management } = await controlFor(propertyId);
  if (property.status === 'active') {
    throw new Error(`${property.code} is active. Assign the next ${which === 'ownership' ? 'owner' : 'manager'} instead of ending this one.`);
  }
  const live = which === 'ownership' ? ownership : management;
  if (!live) throw new Error(`No ${which} is assigned.`);
  const startErr = checkAssignmentStart(effectiveTo.trim(), live.effectiveFrom);
  if (startErr) throw new Error(startErr);
  if (which === 'ownership' && management) {
    throw new Error('End the management assignment first — it is checked against this owner.');
  }

  if (which === 'ownership') {
    await prisma.propertyOwnership.update({ where: { id: live.id }, data: { effectiveTo: effectiveTo.trim() } });
  } else {
    await prisma.propertyManagement.update({ where: { id: live.id }, data: { effectiveTo: effectiveTo.trim() } });
  }
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: `property.${which}.end`,
      subject: property.code,
      detail: { organizationId: live.organizationId, effectiveTo: effectiveTo.trim(), reason: why },
    },
  });
}

// ─────────────────────────────── the asset ────────────────────────────────

export async function updateAsset(
  propertyId: string,
  input: Partial<Record<keyof AssetInput, string | undefined>>,
  actorId: string | null,
) {
  const checked = checkAsset(input);
  if (!checked.ok) throw new Error(firstError(checked.errors));
  const before = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!before) throw new Error('No such property.');

  const value = checked.value;
  const changed = (Object.keys(value) as (keyof AssetInput)[]).filter((k) => value[k] !== before[k]);
  if (!changed.length) return;

  await prisma.property.update({ where: { id: propertyId }, data: value });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'property.asset',
      subject: before.code,
      detail: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: value[k] ?? null }])),
    },
  });
}
