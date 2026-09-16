import { prisma } from '../db.ts';
import { slugForGroupName } from './ids.ts';
import {
  describeRule,
  matches,
  parseRule,
  type GroupRule,
  type PropertySubject,
} from './rules.ts';

/**
 * The group service (docs/01 §2.2).
 *
 * Everything that changes membership goes through here, because membership is
 * now an ACCESS decision: dropping a hotel into Midwest widens the reach of
 * everyone holding a grant on Midwest, without a grant being touched. That is
 * the feature — redrawing a region must not migrate grants — and it is also
 * exactly why every write below lands in the audit log with a count.
 *
 * No `next/headers` reachable from this file, at any depth: the CLI imports it.
 */

export type GroupKind = 'region' | 'brand' | 'entity' | 'ad_hoc' | 'audit';
export const GROUP_KINDS: GroupKind[] = ['region', 'brand', 'entity', 'ad_hoc', 'audit'];

/** Reporting labels only — nothing in access resolution reads `kind` (§2.2). */
export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  region: 'Region',
  brand: 'Brand',
  entity: 'Entity',
  ad_hoc: 'Ad hoc',
  audit: 'Audit',
};

export { slugForGroupName };

async function uniqueGroupId(name: string): Promise<string> {
  const base = slugForGroupName(name);
  for (let n = 1; n < 50; n += 1) {
    const id = n === 1 ? base : `${base}_${n}`;
    if (!(await prisma.propertyGroup.findUnique({ where: { id } }))) return id;
  }
  throw new Error(`Too many groups already named something like "${name}".`);
}

function subjectOf(p: {
  brandCode: string;
  chainCode: string;
  state: string;
  city: string;
  status: string;
}): PropertySubject {
  return {
    brandCode: p.brandCode,
    chainCode: p.chainCode,
    state: p.state,
    city: p.city,
    status: p.status,
  };
}

export interface CreateGroupInput {
  kind: GroupKind;
  name: string;
  description?: string;
  /** Present makes this a rule group; absent makes it manual. */
  rule?: unknown;
  actorId: string | null;
}

export async function createGroup(input: CreateGroupInput) {
  const name = input.name.trim();
  if (!name) throw new Error('A group needs a name.');

  const rule = input.rule === undefined || input.rule === null ? null : parseRule(input.rule);
  const id = await uniqueGroupId(name);

  const group = await prisma.propertyGroup.create({
    data: {
      id,
      kind: input.kind,
      name,
      description: input.description?.trim() ?? '',
      membershipMode: rule ? 'rule' : 'manual',
      ruleJson: rule ?? undefined,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: 'group.create',
      subject: id,
      detail: {
        kind: input.kind,
        name,
        membershipMode: group.membershipMode,
        rule: rule ? describeRule(rule) : null,
      },
    },
  });

  if (rule) await materializeGroup(id, input.actorId);
  return group;
}

/** Display fields only. The id and the membership mode are not editable. */
export async function updateGroup(
  id: string,
  patch: { name?: string; description?: string },
  actorId: string | null,
) {
  const group = await requireGroup(id);
  const name = patch.name?.trim();
  if (name !== undefined && !name) throw new Error('A group needs a name.');

  const updated = await prisma.propertyGroup.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'group.update',
      subject: id,
      detail: { from: { name: group.name, description: group.description }, to: { name: updated.name, description: updated.description } },
    },
  });
  return updated;
}

/**
 * Archive or restore. Archiving hides a group from the pickers; it does NOT
 * stop it resolving, and that is deliberate — access is closed by closing a
 * grant, and a group that silently stopped covering its members would revoke
 * people's access through a display action.
 */
export async function setGroupArchived(id: string, archived: boolean, actorId: string | null) {
  await requireGroup(id);
  const updated = await prisma.propertyGroup.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: archived ? 'group.archive' : 'group.restore',
      subject: id,
      detail: { liveGrants: await liveGrantCount(id) },
    },
  });
  return updated;
}

async function requireGroup(id: string) {
  const group = await prisma.propertyGroup.findUnique({ where: { id } });
  if (!group) throw new Error(`No such group: ${id}`);
  return group;
}

/** Resolve an inn code OR an internal property id. Downstream holds ids; grants hold codes. */
export async function resolveProperty(ref: string) {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  return prisma.property.findFirst({
    where: { OR: [{ code: trimmed.toUpperCase() }, { id: trimmed }] },
  });
}

export async function addMember(groupId: string, propertyRef: string, actorId: string | null) {
  const group = await requireGroup(groupId);
  if (group.membershipMode === 'rule') {
    throw new Error(
      `${group.name} is rule-backed — its membership comes from the rule. Edit the rule, or make a manual group.`,
    );
  }
  const property = await resolveProperty(propertyRef);
  if (!property) throw new Error(`No property with code or id "${propertyRef}".`);

  const existing = await prisma.propertyGroupMember.findUnique({
    where: { groupId_propertyId: { groupId, propertyId: property.id } },
  });
  if (existing) return existing;

  const member = await prisma.propertyGroupMember.create({
    data: { groupId, propertyId: property.id, addedById: actorId },
  });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'group.member.add',
      subject: groupId,
      detail: { propertyId: property.id, code: property.code, name: property.name },
    },
  });
  return member;
}

export async function removeMember(groupId: string, propertyId: string, actorId: string | null) {
  const group = await requireGroup(groupId);
  if (group.membershipMode === 'rule') {
    throw new Error(`${group.name} is rule-backed — remove it by changing the rule.`);
  }
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  await prisma.propertyGroupMember.deleteMany({ where: { groupId, propertyId } });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'group.member.remove',
      subject: groupId,
      detail: { propertyId, code: property?.code ?? null },
    },
  });
}

export interface SyncResult {
  groupId: string;
  added: string[];
  removed: string[];
  total: number;
}

/**
 * Bring a rule group's rows in line with its rule.
 *
 * Rule groups materialize rather than evaluate on read, so resolving access is
 * one shape of query regardless of how a property got in — and so the
 * membership of a rule group is inspectable, which a live predicate never is.
 * The cost is that it can go stale; `syncedAt` is what makes that visible.
 */
export async function materializeGroup(
  groupId: string,
  actorId: string | null,
): Promise<SyncResult> {
  const group = await requireGroup(groupId);
  if (group.membershipMode !== 'rule' || !group.ruleJson) {
    throw new Error(`${group.name} is a manual group — there is no rule to apply.`);
  }
  const rule: GroupRule = parseRule(group.ruleJson);

  const properties = await prisma.property.findMany();
  const wanted = new Set(properties.filter((p) => matches(rule, subjectOf(p))).map((p) => p.id));
  const held = new Set(
    (await prisma.propertyGroupMember.findMany({ where: { groupId }, select: { propertyId: true } })).map(
      (m) => m.propertyId,
    ),
  );

  const added = [...wanted].filter((id) => !held.has(id));
  const removed = [...held].filter((id) => !wanted.has(id));

  if (added.length) {
    await prisma.propertyGroupMember.createMany({
      data: added.map((propertyId) => ({ groupId, propertyId, addedById: null })),
      skipDuplicates: true,
    });
  }
  if (removed.length) {
    await prisma.propertyGroupMember.deleteMany({
      where: { groupId, propertyId: { in: removed } },
    });
  }
  await prisma.propertyGroup.update({ where: { id: groupId }, data: { syncedAt: new Date() } });

  if (added.length || removed.length) {
    await prisma.auditEvent.create({
      data: {
        actorId,
        action: 'group.rule.sync',
        subject: groupId,
        detail: { rule: describeRule(rule), added: added.length, removed: removed.length, total: wanted.size },
      },
    });
  }

  return { groupId, added, removed, total: wanted.size };
}

/** Re-materialize every rule group. Called after issuance, and by `npm run groups:sync`. */
export async function materializeAll(actorId: string | null = null): Promise<SyncResult[]> {
  const groups = await prisma.propertyGroup.findMany({ where: { membershipMode: 'rule' } });
  const out: SyncResult[] = [];
  for (const g of groups) {
    try {
      out.push(await materializeGroup(g.id, actorId));
    } catch {
      // A group with an unparseable rule must not stop the rest from syncing.
      // It surfaces as a stale `syncedAt` in Oversight, which is the honest
      // signal — not an exception thrown at whoever happened to issue a code.
    }
  }
  return out;
}

/**
 * The group ids a property belongs to, for access resolution.
 *
 * Takes the same ref vocabulary a grant uses at property scope (an inn code),
 * and also accepts the internal id, because consumers downstream hold the id
 * and never the code (G1). This function is the seam between those two.
 */
export async function groupIdsForProperty(ref: string): Promise<Set<string>> {
  const property = await resolveProperty(ref);
  if (!property) return new Set();
  const rows = await prisma.propertyGroupMember.findMany({
    where: { propertyId: property.id },
    select: { groupId: true },
  });
  return new Set(rows.map((r) => r.groupId));
}

/**
 * What a rule would select, without saving anything.
 *
 * The same discipline as proposing an inn code before claiming it: a group is
 * an access object, so "show me what this does" and "do it" are separate acts.
 */
export async function previewRule(rule: unknown) {
  const parsed: GroupRule = parseRule(rule);
  const properties = await prisma.property.findMany({ orderBy: { code: 'asc' } });
  return {
    rule: parsed,
    description: describeRule(parsed),
    matched: properties.filter((p) => matches(parsed, subjectOf(p))),
    considered: properties.length,
  };
}

/** Live grants held ON this group — the "who does this change affect" answer (§3). */
export async function grantsOnGroup(groupId: string) {
  return prisma.grant.findMany({
    where: { scope: 'group', scopeRef: groupId, effectiveTo: null },
    include: { person: { select: { name: true, email: true, status: true } }, role: true },
    orderBy: { effectiveFrom: 'asc' },
  });
}

async function liveGrantCount(groupId: string): Promise<number> {
  return prisma.grant.count({ where: { scope: 'group', scopeRef: groupId, effectiveTo: null } });
}

export async function listGroups(includeArchived = false) {
  return prisma.propertyGroup.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { members: true } } },
  });
}

export async function groupDetail(id: string) {
  return prisma.propertyGroup.findUnique({
    where: { id },
    include: {
      members: {
        include: { property: true },
        orderBy: { property: { code: 'asc' } },
      },
    },
  });
}
