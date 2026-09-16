import { prisma } from '../db.ts';
import { groupIdsForProperty, resolveProperty } from '../groups/groups.ts';
import { ScopeViolation, covers, firewallViolations, isLive, type Scope } from './scope.ts';

/**
 * Resolving and issuing access (docs/01 §2).
 *
 * Effective permission at a target = the union of every LIVE grant whose scope
 * covers it. Union only, no deny rules — deny logic is where RBAC stops being
 * auditable, and "who could do what on 3 March" is the question this table
 * exists to answer.
 */

export interface Target {
  scope: Scope;
  scopeRef: string | null;
}

export const PORTFOLIO: Target = { scope: 'portfolio', scopeRef: null };

export interface Actor {
  id: string;
  email: string;
  name: string;
  status: string;
}

// Anything that reads the session lives in actor.ts, not here. `next/headers`
// only resolves inside the Next bundler, so importing it from this module
// would make every CLI that touches access — sunrise included — unloadable.

const NO_GROUPS: ReadonlySet<string> = new Set();

/**
 * Every permission key this person holds at `target`, right now.
 *
 * A group grant reaches a property through membership (docs/01 §2.2), so a
 * property target needs to know which groups that property is in. That lookup
 * is skipped unless it can change the answer — nobody holding only portfolio
 * and property grants pays for it — which keeps the common path one query.
 */
export async function permissionsAt(
  personId: string,
  target: Target = PORTFOLIO,
): Promise<Set<string>> {
  const grants = await prisma.grant.findMany({
    where: { personId, effectiveTo: null },
    include: { role: { include: { permissions: true } } },
  });

  const now = new Date();
  const live = grants.filter((g) => isLive(g, now));

  const needsGroups =
    target.scope === 'property' && !!target.scopeRef && live.some((g) => g.scope === 'group');
  const targetGroups = needsGroups ? await groupIdsForProperty(target.scopeRef!) : NO_GROUPS;

  const keys = new Set<string>();
  for (const g of live) {
    if (!covers({ scope: g.scope as Scope, scopeRef: g.scopeRef }, target, targetGroups)) continue;
    for (const rp of g.role.permissions) keys.add(rp.permissionKey);
  }
  return keys;
}

/** Convenience for the common downstream question: what can they do at this hotel? */
export function permissionsAtProperty(personId: string, ref: string): Promise<Set<string>> {
  return permissionsAt(personId, { scope: 'property', scopeRef: ref });
}

export async function can(
  personId: string,
  permission: string,
  target: Target = PORTFOLIO,
): Promise<boolean> {
  return (await permissionsAt(personId, target)).has(permission);
}

export interface GrantInput {
  personId: string;
  roleKey: string;
  scope: Scope;
  scopeRef?: string | null;
  grantedById: string | null;
  reason: string;
}

/**
 * Open a grant.
 *
 * Two checks, both refusals rather than warnings:
 *   - the role must be assignable at this scope (its own declaration)
 *   - no permission it carries may be capped below this scope (the firewall)
 *
 * The second is what `docs/29 §3` has been asking for: A/R authority cannot ride
 * on a portfolio-scoped role, because the write is refused, not because someone
 * remembered the rule.
 */
export async function grantAccess(input: GrantInput) {
  const role = await prisma.role.findUnique({
    where: { key: input.roleKey },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw new Error(`Unknown role: ${input.roleKey}`);

  if (!role.assignableAt.includes(input.scope)) {
    throw new Error(
      `The ${role.name} role is not assignable at ${input.scope} scope (allowed: ${role.assignableAt.join(', ')}).`,
    );
  }

  const violations = firewallViolations(
    role.permissions.map((rp) => ({
      key: rp.permission.key,
      scopeMax: rp.permission.scopeMax as Scope,
    })),
    input.scope,
  );
  if (violations.length) throw new ScopeViolation(input.scope, violations);

  let scopeRef = input.scope === 'portfolio' ? null : (input.scopeRef?.trim() || null);
  if (input.scope !== 'portfolio' && !scopeRef) {
    throw new Error(`A ${input.scope} grant needs something to point at.`);
  }

  // A grant whose ref points at nothing is worse than a refused one: it looks
  // like access on the People page and confers none. Both narrow scopes are
  // therefore resolved before the row is written, and the property ref is
  // normalized to the canonical code so coverage is a string match later.
  if (input.scope === 'group' && scopeRef) {
    const group = await prisma.propertyGroup.findUnique({ where: { id: scopeRef } });
    if (!group) throw new Error(`No such group: ${scopeRef}`);
    if (group.archivedAt) {
      throw new Error(`${group.name} is archived. Restore it before granting access on it.`);
    }
  }
  if (input.scope === 'property' && scopeRef) {
    const property = await resolveProperty(scopeRef);
    if (!property) throw new Error(`No property with code or id "${scopeRef}".`);
    scopeRef = property.code;
  }

  const grant = await prisma.grant.create({
    data: {
      personId: input.personId,
      roleKey: role.key,
      roleVersion: role.version,
      scope: input.scope,
      scopeRef,
      grantedById: input.grantedById,
      reason: input.reason,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: input.grantedById,
      action: 'grant.open',
      subject: input.personId,
      detail: {
        grantId: grant.id,
        role: role.key,
        roleVersion: role.version,
        scope: input.scope,
        scopeRef,
        reason: input.reason,
      },
    },
  });

  return grant;
}

/**
 * Close a grant. The row stays — nothing is deleted, so history stays readable.
 *
 * Refuses to close the last live portfolio-scoped grant that can manage people.
 * Otherwise the registry can be locked out of itself with one click, and the
 * only way back in is a database console.
 */
export async function revokeGrant(grantId: string, actorId: string, reason: string) {
  const grant = await prisma.grant.findUnique({
    where: { id: grantId },
    include: { role: { include: { permissions: true } } },
  });
  if (!grant) throw new Error('No such grant.');
  if (grant.effectiveTo) return grant;

  const managesPeople = grant.role.permissions.some((p) => p.permissionKey === 'people.manage');
  if (managesPeople && grant.scope === 'portfolio') {
    const others = await prisma.grant.count({
      where: {
        id: { not: grantId },
        effectiveTo: null,
        scope: 'portfolio',
        person: { status: 'active' },
        role: { permissions: { some: { permissionKey: 'people.manage' } } },
      },
    });
    if (others === 0) {
      throw new Error(
        'This is the last account that can grant access. Give someone else that role first, or the registry locks itself out.',
      );
    }
  }

  const closed = await prisma.grant.update({
    where: { id: grantId },
    data: { effectiveTo: new Date() },
  });

  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'grant.close',
      subject: grant.personId,
      detail: { grantId, role: grant.roleKey, scope: grant.scope, reason },
    },
  });

  return closed;
}

/** True when nobody has ever been created — the only moment sunrise may run. */
export async function registryHasNoPeople(): Promise<boolean> {
  return (await prisma.person.count()) === 0;
}
