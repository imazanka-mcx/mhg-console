import { prisma } from '../db.ts';
import { readSession } from './session.ts';
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

/** The signed-in person, or null. Suspended and offboarded people are not signed in. */
export async function currentActor(): Promise<Actor | null> {
  const session = await readSession();
  if (!session) return null;
  const person = await prisma.person.findUnique({ where: { id: session.personId } });
  if (!person || person.status !== 'active') return null;
  return { id: person.id, email: person.email, name: person.name, status: person.status };
}

/** Every permission key this person holds at `target`, right now. */
export async function permissionsAt(
  personId: string,
  target: Target = PORTFOLIO,
): Promise<Set<string>> {
  const grants = await prisma.grant.findMany({
    where: { personId, effectiveTo: null },
    include: { role: { include: { permissions: true } } },
  });

  const now = new Date();
  const keys = new Set<string>();
  for (const g of grants) {
    if (!isLive(g, now)) continue;
    if (!covers({ scope: g.scope as Scope, scopeRef: g.scopeRef }, target)) continue;
    for (const rp of g.role.permissions) keys.add(rp.permissionKey);
  }
  return keys;
}

export async function can(
  personId: string,
  permission: string,
  target: Target = PORTFOLIO,
): Promise<boolean> {
  return (await permissionsAt(personId, target)).has(permission);
}

/** Throws unless the signed-in person holds `permission`. Use at the top of any action.
 *  Named in full rather than `require` — that word already means something in Node. */
export async function requirePermission(permission: string, target: Target = PORTFOLIO): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new Error('Not signed in.');
  if (!(await can(actor.id, permission, target))) {
    throw new Error(`Not permitted: ${permission}`);
  }
  return actor;
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

  const scopeRef = input.scope === 'portfolio' ? null : (input.scopeRef ?? null);
  if (input.scope !== 'portfolio' && !scopeRef) {
    throw new Error(`A ${input.scope} grant needs something to point at.`);
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
