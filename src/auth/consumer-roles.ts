import type { Scope } from './scope.ts';

/**
 * The role crosswalk (docs/01 §2.7) — how a console role becomes a role inside
 * Inspire and inside InspiredREV, so one person, one grant, reaches all three.
 *
 * Two halves:
 *   - CONSUMER_ROLES mirrors the roles each consumer enforces in its own code
 *     (Inspire's Role and OrgRole enums, InspiredREV's Role enum). It is a copy
 *     of their code, not a design: when a consumer adds or changes a role, this
 *     list follows in the same change.
 *   - Each console role in catalog.ts names, per consumer, the one role it
 *     becomes there (`RoleSeed.links`). No link means no access in that app.
 *
 * `carries` is what makes the crosswalk safe. It lists the console permission
 * keys a consumer role implies downstream — Inspire's `gm` posts to folios and
 * manages A/R, so it carries `folio.post`, `ar.view` and `ar.manage`. A console
 * role may only link to a consumer role whose `carries` it also holds itself,
 * which puts the link under the direct-bill firewall (§2.3): a role carrying
 * `ar.manage` is property-only, so nothing can link a portfolio grant to an
 * Inspire role with A/R authority by accident.
 *
 * Deliberately free of Prisma imports, like scope.ts: the rule should be
 * testable without a database.
 */

export const CONSUMERS = ['inspire', 'inspiredrev'] as const;
export type Consumer = (typeof CONSUMERS)[number];

/**
 * `org` — held once, applies across the consumer's whole organization
 * (Inspire's corporate_admin / corporate_viewer).
 * `property` — held per property (Inspire's property roles). InspiredREV has a
 * single role per user with its grants deciding where, so every InspiredREV
 * role is `property` tier: the console grant's scope becomes its AccessGrant.
 */
export type ConsumerTier = 'org' | 'property';

export interface ConsumerRoleSeed {
  consumer: Consumer;
  key: string;
  name: string;
  tier: ConsumerTier;
  /** The consumer's own ordering — higher is more privilege. Lateral roles are low. */
  rank: number;
  /** Console permission keys this role implies inside the consumer. */
  carries: string[];
}

export const CONSUMER_ROLES: ConsumerRoleSeed[] = [
  // ── Inspire — mhotels-inspire/src/lib/rbac.ts ───────────────────────────
  // carries follows what Inspire actually checks: canManageAr is gm+, the
  // ar module admits admin/gm/sales/auditor, folio posting is front_desk+ — and
  // revenue_manager (rank 70) clears front_desk (60), so it posts too. sales
  // ranks with gm and auditor with front_desk, so each carries what its peer does.
  { consumer: 'inspire', key: 'corporate_admin', name: 'Corporate admin', tier: 'org', rank: 100, carries: ['ar.view', 'ar.manage', 'folio.post'] },
  { consumer: 'inspire', key: 'corporate_viewer', name: 'Corporate viewer', tier: 'org', rank: 10, carries: [] },
  { consumer: 'inspire', key: 'admin', name: 'Property admin', tier: 'property', rank: 100, carries: ['ar.view', 'ar.manage', 'folio.post'] },
  { consumer: 'inspire', key: 'gm', name: 'General manager', tier: 'property', rank: 80, carries: ['ar.view', 'ar.manage', 'folio.post'] },
  { consumer: 'inspire', key: 'sales', name: 'Sales', tier: 'property', rank: 80, carries: ['ar.view', 'ar.manage', 'folio.post'] },
  { consumer: 'inspire', key: 'revenue_manager', name: 'Revenue manager', tier: 'property', rank: 70, carries: ['folio.post'] },
  { consumer: 'inspire', key: 'front_desk', name: 'Front desk', tier: 'property', rank: 60, carries: ['folio.post'] },
  { consumer: 'inspire', key: 'auditor', name: 'Auditor', tier: 'property', rank: 60, carries: ['ar.view', 'folio.post'] },
  { consumer: 'inspire', key: 'housekeeping', name: 'Housekeeping', tier: 'property', rank: 40, carries: [] },
  { consumer: 'inspire', key: 'readonly', name: 'Read-only', tier: 'property', rank: 10, carries: [] },

  // ── InspiredREV — mhg-inspiredrev/src/lib/rbac.ts ───────────────────────
  // Authoring rates and inventory is not a direct-bill authority, so nothing
  // here is capped: an InspiredREV role can ride a portfolio grant.
  { consumer: 'inspiredrev', key: 'admin', name: 'Admin', tier: 'property', rank: 100, carries: [] },
  { consumer: 'inspiredrev', key: 'revenue_manager', name: 'Revenue manager', tier: 'property', rank: 70, carries: [] },
  { consumer: 'inspiredrev', key: 'sales', name: 'Sales', tier: 'property', rank: 60, carries: [] },
  { consumer: 'inspiredrev', key: 'auditor', name: 'Auditor', tier: 'property', rank: 30, carries: [] },
  { consumer: 'inspiredrev', key: 'readonly', name: 'Read-only', tier: 'property', rank: 10, carries: [] },
];

export function consumerRole(consumer: Consumer, key: string): ConsumerRoleSeed | undefined {
  return CONSUMER_ROLES.find((r) => r.consumer === consumer && r.key === key);
}

/**
 * One console role's link into one consumer: the role it becomes by default,
 * and any others a grant may pick instead. A GM is `readonly` in InspiredREV
 * unless the person granting it chooses `revenue_manager` — one console role,
 * not two, with the choice recorded on the grant (§2.7).
 */
export interface LinkSeed {
  /** The consumer role key a grant gets when nothing else is chosen. */
  role: string;
  /** Other consumer role keys a grant of this role may choose instead. */
  also?: string[];
  /**
   * Non-empty only for a link that knowingly breaks the carries rule, with the
   * reason. Listed by validateLinks on every seed so it cannot be forgotten,
   * and refused once the link no longer needs it.
   */
  exception?: string;
}

/** Every consumer role a link allows, the default first. */
export function allowedRoles(link: LinkSeed): string[] {
  return [link.role, ...(link.also ?? []).filter((k) => k !== link.role)];
}

export type Links = Partial<Record<Consumer, LinkSeed>>;

/** The slice of a console role the crosswalk rules need. */
export interface LinkableRole {
  key: string;
  assignableAt: Scope[];
  permissions: string[];
  links: Links;
}

export interface LinkFinding {
  level: 'error' | 'exception';
  role: string;
  consumer: Consumer;
  message: string;
}

/**
 * Check every link against the rules. `error` findings mean the catalog must
 * not be seeded; `exception` findings are the declared, reasoned breaks.
 *
 *   1. A link names a role that exists in that consumer.
 *   2. An `org`-tier consumer role (held org-wide) is only reachable from a
 *      console role assignable at portfolio and nowhere narrower — a
 *      property grant must never become corporate authority.
 *   3. The console role holds everything the consumer role carries, so the
 *      firewall that governs the console role governs the link too.
 *   4. A declared exception must still be needed.
 */
export function validateLinks(
  roles: LinkableRole[],
  consumerRoles: ConsumerRoleSeed[] = CONSUMER_ROLES,
): LinkFinding[] {
  const findings: LinkFinding[] = [];

  for (const role of roles) {
    for (const consumer of CONSUMERS) {
      const link = role.links[consumer];
      if (!link) continue;
      if (new Set(link.also ?? []).size !== (link.also ?? []).length || (link.also ?? []).includes(link.role)) {
        findings.push({ level: 'error', role: role.key, consumer, message: `${role.key} → ${consumer} lists a role twice` });
      }

      const exception = link.exception?.trim() ?? '';
      let exceptionUsed = false;

      for (const key of allowedRoles(link)) {
        const target = consumerRoles.find((r) => r.consumer === consumer && r.key === key);
        if (!target) {
          findings.push({ level: 'error', role: role.key, consumer, message: `${consumer} has no role "${key}"` });
          continue;
        }

        if (target.tier === 'org' && !(role.assignableAt.length === 1 && role.assignableAt[0] === 'portfolio')) {
          findings.push({
            level: 'error',
            role: role.key,
            consumer,
            message: `${consumer} ${target.key} is held org-wide, but ${role.key} is assignable at ${role.assignableAt.join(', ')} — only a portfolio-only role may link to it`,
          });
        }

        const missing = target.carries.filter((k) => !role.permissions.includes(k));
        if (missing.length && !exception) {
          findings.push({
            level: 'error',
            role: role.key,
            consumer,
            message: `${consumer} ${target.key} carries ${missing.join(', ')}, which ${role.key} does not hold`,
          });
        } else if (missing.length) {
          exceptionUsed = true;
          findings.push({
            level: 'exception',
            role: role.key,
            consumer,
            message: `${consumer} ${target.key} carries ${missing.join(', ')} beyond ${role.key} — ${exception}`,
          });
        }
      }

      if (exception && !exceptionUsed) {
        findings.push({
          level: 'error',
          role: role.key,
          consumer,
          message: `the exception on ${role.key} → ${consumer} is no longer needed; remove it`,
        });
      }
    }
  }

  return findings;
}

export class DownstreamChoiceError extends Error {}

/**
 * What a grant of this role becomes in each consumer, given the choices made
 * when it was issued. A consumer with no choice gets the link's default; a
 * choice the link does not allow, or one for a consumer the role does not
 * reach, is refused — the grant form must not be a way around the crosswalk.
 */
export function resolveDownstream(
  role: { key: string; links: Links },
  choices: Partial<Record<Consumer, string>> = {},
): Partial<Record<Consumer, string>> {
  const out: Partial<Record<Consumer, string>> = {};
  for (const consumer of CONSUMERS) {
    const link = role.links[consumer];
    const chosen = choices[consumer]?.trim();
    if (!link) {
      if (chosen) {
        throw new DownstreamChoiceError(`${role.key} has no access in ${consumer}, so there is nothing to choose there.`);
      }
      continue;
    }
    const allowed = allowedRoles(link);
    if (chosen && !allowed.includes(chosen)) {
      throw new DownstreamChoiceError(
        `${role.key} can be ${allowed.join(' or ')} in ${consumer}, not ${chosen}.`,
      );
    }
    out[consumer] = chosen || link.role;
  }
  return out;
}

/**
 * The other direction (§2.9): a role as a consumer names it → the console role
 * that stands for it. Used when Inspire's Users flow provisions someone, and by
 * the one-time import of local accounts. One answer per consumer role, and
 * only the scopes it may arrive at — Inspire's property roles are only ever
 * granted at one hotel there, so they map to property-only console roles that
 * carry no console access. Anything missing here is not accepted from a
 * consumer: corporate seats are provisioned in the console, never from below.
 */
export const FROM_CONSUMER: Record<Consumer, Record<string, { roleKey: string; scopes: Scope[] }>> = {
  inspire: {
    admin: { roleKey: 'property_admin', scopes: ['property'] },
    gm: { roleKey: 'gm', scopes: ['property'] },
    sales: { roleKey: 'director_of_sales', scopes: ['property'] },
    revenue_manager: { roleKey: 'property_revenue_manager', scopes: ['property'] },
    front_desk: { roleKey: 'front_desk', scopes: ['property'] },
    housekeeping: { roleKey: 'housekeeping', scopes: ['property'] },
    auditor: { roleKey: 'auditor', scopes: ['property'] },
    readonly: { roleKey: 'property_readonly', scopes: ['property'] },
  },
  inspiredrev: {
    revenue_manager: { roleKey: 'revenue_manager', scopes: ['portfolio', 'property'] },
    sales: { roleKey: 'sales', scopes: ['portfolio', 'property'] },
    readonly: { roleKey: 'property_readonly', scopes: ['property'] },
  },
};

/** The console role for a consumer's role at a scope, or null if it is not accepted from below. */
export function consoleRoleFor(consumer: Consumer, role: string, scope: Scope): string | null {
  const m = FROM_CONSUMER[consumer][role];
  return m && m.scopes.includes(scope) ? m.roleKey : null;
}
