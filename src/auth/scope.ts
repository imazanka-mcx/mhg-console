/**
 * Scope arithmetic and the direct-bill firewall (docs/01 §2.2, §2.3).
 *
 * Deliberately free of Prisma imports: this is the rule, and the rule should be
 * testable without a database or a generated client.
 */

export const SCOPES = ['property', 'group', 'portfolio'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * How much a scope covers. Higher is wider.
 *
 * `group` sits above `property` even when a group holds exactly one property.
 * That is not an oversight: a one-member group must not become a way to hold a
 * property-capped permission above property. Cardinality is not the test —
 * being a set is.
 */
const RANK: Record<Scope, number> = { property: 1, group: 2, portfolio: 3 };

export function rank(scope: Scope): number {
  return RANK[scope];
}

export function isWiderThan(a: Scope, b: Scope): boolean {
  return RANK[a] > RANK[b];
}

export interface PermissionLike {
  key: string;
  /** The widest scope this permission may ever be granted at. */
  scopeMax: Scope;
}

/** True when this permission may be held at this scope. */
export function permittedAt(permission: PermissionLike, scope: Scope): boolean {
  return RANK[scope] <= RANK[permission.scopeMax];
}

/**
 * The firewall check. Returns the permissions that would be carried too wide —
 * empty means the grant is legal.
 *
 * This is what turns `docs/29 §3` from a rule people remember into a write the
 * database layer refuses: a role carrying `ar.view` simply cannot be granted at
 * portfolio scope, so nobody acquires A/R authority over every hotel by being
 * made a corporate admin.
 */
export function firewallViolations(
  permissions: PermissionLike[],
  scope: Scope,
): PermissionLike[] {
  return permissions.filter((p) => !permittedAt(p, scope));
}

export class ScopeViolation extends Error {
  readonly violations: PermissionLike[];
  readonly scope: Scope;

  constructor(scope: Scope, violations: PermissionLike[]) {
    const names = violations.map((v) => `${v.key} (max ${v.scopeMax})`).join(', ');
    super(`Cannot grant at ${scope} scope — capped permissions: ${names}`);
    this.name = 'ScopeViolation';
    this.scope = scope;
    this.violations = violations;
  }
}

/** Does a grant at `grantScope` cover `target`? */
export function covers(
  grant: { scope: Scope; scopeRef: string | null },
  target: { scope: Scope; scopeRef: string | null },
): boolean {
  if (grant.scope === 'portfolio') return true;
  if (grant.scope !== target.scope) return false;
  return grant.scopeRef === target.scopeRef;
}

/** A grant is live when it has started and has not been closed. */
export function isLive(
  grant: { effectiveFrom: Date; effectiveTo: Date | null },
  at: Date = new Date(),
): boolean {
  if (grant.effectiveFrom > at) return false;
  return grant.effectiveTo === null || grant.effectiveTo > at;
}
