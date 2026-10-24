import type { Links } from './consumer-roles.ts';
import type { Scope } from './scope.ts';

/**
 * The role and permission catalog (docs/01 §2.3, §2.4).
 *
 * This is the seed, not the source of truth — the tables are. It lives in code
 * so a change is reviewable in a diff, and is applied by `npm run db:seed`.
 *
 * Roles are VERSIONED, never edited in place. Editing `registrar` would
 * silently rewrite what every registrar was granted, and the audit trail would
 * then be lying. Change the permission set, bump `version`, re-seed.
 */

export interface PermissionSeed {
  key: string;
  name: string;
  scopeMax: Scope;
  /** Which system enforces it. The console owns the catalog either way. */
  ownedBy: 'console' | 'inspire' | 'inspiredrev';
}

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  version: number;
  assignableAt: Scope[];
  permissions: string[];
  /**
   * The role this becomes inside each consumer (docs/01 §2.7). A missing
   * consumer means no access there. Part of the role's meaning, so a change
   * here bumps the version exactly like a change to `permissions`.
   */
  links: Links;
}

export const PERMISSIONS: PermissionSeed[] = [
  // ── the registry ────────────────────────────────────────────────────────
  { key: 'property.read', name: 'View the portfolio', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.issue', name: 'Issue an inn code', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.rebrand', name: 'Rebrand a property', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'property.status', name: 'Move a code through its lifecycle', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── people ──────────────────────────────────────────────────────────────
  { key: 'people.read', name: 'View people and their access', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'people.manage', name: 'Invite people and grant access', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── groups ──────────────────────────────────────────────────────────────
  // Group membership decides who a group grant reaches, so editing it is an
  // access action even though it touches no grant (§2.2). Split from
  // people.manage on purpose: drawing regions and provisioning people are
  // different jobs, and a registrar should be able to do the first without the
  // second. Both are portfolio-capped — there is no such thing as managing
  // groups from inside one group.
  { key: 'group.read', name: 'View groups and their membership', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'group.manage', name: 'Create groups and edit membership', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── ownership and control ───────────────────────────────────────────────
  // Who owns and who runs each hotel (§1.7). Reading it is part of seeing the
  // portfolio; changing it decides whether a hotel may open, so it is its own
  // authority rather than riding on property.issue.
  { key: 'org.read', name: 'View ownership and management', scopeMax: 'portfolio', ownedBy: 'console' },
  { key: 'org.manage', name: 'Maintain organizations and assign ownership and management', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── standards ───────────────────────────────────────────────────────────
  { key: 'standards.manage', name: 'Edit the brand table and market claims', scopeMax: 'portfolio', ownedBy: 'console' },

  // ── property-capped, enforced downstream ────────────────────────────────
  // These are the firewall's reason for existing (docs/29 §3). The console owns
  // the catalog; Inspire enforces them once §4 step 5 moves its Role enum here.
  // Capped at `property` so no portfolio- or group-scoped role can ever carry
  // them — above-property has zero oversight of direct billables, and that is
  // now a constraint rather than a convention.
  { key: 'ar.view', name: 'View A/R and direct-bill exposure', scopeMax: 'property', ownedBy: 'inspire' },
  { key: 'ar.manage', name: 'Invoice, receipt and write off A/R', scopeMax: 'property', ownedBy: 'inspire' },
  { key: 'folio.post', name: 'Post to a folio', scopeMax: 'property', ownedBy: 'inspire' },
];

export const ROLES: RoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    description:
      'Full control of the registry, including who else has access. The sunrise account holds this. Portfolio only — there is no such thing as an owner of one hotel.',
    version: 1,
    assignableAt: ['portfolio'],
    permissions: [
      'property.read',
      'property.issue',
      'property.rebrand',
      'property.status',
      'group.read',
      'group.manage',
      'org.read',
      'org.manage',
      'people.read',
      'people.manage',
      'standards.manage',
    ],
    links: {
      inspire: {
        role: 'corporate_admin',
        exception:
          'Inspire has no middle tier (§2.6): corporate_admin is the only role that can stand up a property, and it is admin at every hotel. Retire when Inspire takes its roles from grants (§4 step 5).',
      },
      inspiredrev: { role: 'admin' },
    },
  },
  {
    key: 'registrar',
    name: 'Registrar',
    description:
      'Issues codes, maintains the standard, and draws the groups the portfolio is sliced by. Cannot change who has access — provisioning is a separate authority on purpose.',
    version: 1,
    assignableAt: ['portfolio'],
    permissions: [
      'property.read',
      'property.issue',
      'property.rebrand',
      'property.status',
      'group.read',
      'group.manage',
      'org.read',
      'org.manage',
      'standards.manage',
    ],
    links: {
      inspire: { role: 'corporate_viewer' },
      inspiredrev: { role: 'readonly' },
    },
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description:
      'Reads the portfolio. Grantable narrowly, which is what makes a regional or single-property seat possible without inventing a role per tier.',
    version: 1,
    assignableAt: ['portfolio', 'group', 'property'],
    permissions: ['property.read', 'group.read', 'org.read'],
    links: {
      inspire: { role: 'readonly' },
      inspiredrev: { role: 'readonly' },
    },
  },

  // ── property operations ─────────────────────────────────────────────────
  // Roles whose work happens in Inspire and InspiredREV, not here. They exist
  // in the console so a person is provisioned once, in one place, and the
  // crosswalk (§2.7) decides what they become downstream. Their console
  // permissions are exactly what their Inspire role carries — which is what
  // puts the A/R and posting authority under the firewall: each one that
  // touches money is property-only, by its own permissions, not by a promise.
  {
    key: 'property_admin',
    name: 'Property admin',
    description:
      'Runs one hotel’s Inspire instance — users, taxes, configuration — with full A/R and posting authority there. Property only.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['ar.view', 'ar.manage', 'folio.post'],
    links: {
      inspire: { role: 'admin' },
      inspiredrev: { role: 'readonly' },
    },
  },
  {
    key: 'property_owner',
    name: 'Property owner',
    description:
      'A principal of the hotel’s ownership group: GM-level access to that hotel in Inspire, never corporate authority. Read-only in InspiredREV, or revenue manager if chosen at grant time. Property only.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['ar.view', 'ar.manage', 'folio.post'],
    links: {
      inspire: { role: 'gm' },
      inspiredrev: { role: 'readonly', also: ['revenue_manager'] },
    },
  },
  {
    key: 'gm',
    name: 'General manager',
    description:
      'Runs one hotel: front office, A/R and the night audit in Inspire. Revenue manager for its hotel in InspiredREV, or read-only if chosen at grant time. Property only.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['ar.view', 'ar.manage', 'folio.post'],
    links: {
      inspire: { role: 'gm' },
      inspiredrev: { role: 'revenue_manager', also: ['readonly'] },
    },
  },
  {
    key: 'director_of_sales',
    name: 'Director of sales',
    description:
      'Runs one hotel commercially with a GM’s authority in Inspire — A/R, groups, companies, the night audit — but not its configuration. Sales in InspiredREV, or revenue manager if chosen at grant time. Property only.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['ar.view', 'ar.manage', 'folio.post'],
    links: {
      inspire: { role: 'sales' },
      inspiredrev: { role: 'sales', also: ['revenue_manager'] },
    },
  },
  {
    key: 'front_desk',
    name: 'Front desk',
    description: 'Reservations, check-in and folio posting at one hotel. No InspiredREV access.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['folio.post'],
    links: {
      inspire: { role: 'front_desk' },
    },
  },
  {
    key: 'housekeeping',
    name: 'Housekeeping',
    description: 'Room status and task sheets at one hotel. No InspiredREV access.',
    version: 1,
    assignableAt: ['property'],
    permissions: [],
    links: {
      inspire: { role: 'housekeeping' },
    },
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description:
      'Works the desk overnight at one hotel in Inspire — everything front desk can do, plus the night audit and read-only A/R and GL; read-only audit access in InspiredREV. Property only, because it posts and sees direct-bill exposure.',
    version: 1,
    assignableAt: ['property'],
    permissions: ['ar.view', 'folio.post'],
    links: {
      inspire: { role: 'auditor' },
      inspiredrev: { role: 'auditor' },
    },
  },
  {
    key: 'revenue_manager',
    name: 'Revenue manager',
    description:
      'Authors rates, inventory controls, restrictions and yield in InspiredREV, for one hotel, a group or the portfolio. Read-only in Inspire: Inspire’s own revenue_manager can post to folios, which cannot ride a wider grant.',
    version: 1,
    assignableAt: ['portfolio', 'group', 'property'],
    permissions: [],
    links: {
      inspire: { role: 'readonly' },
      inspiredrev: { role: 'revenue_manager' },
    },
  },
  {
    key: 'sales',
    name: 'Sales',
    description:
      'Authors partner (LNR) rates in InspiredREV for one hotel, a group or the portfolio. Read-only in Inspire.',
    version: 1,
    assignableAt: ['portfolio', 'group', 'property'],
    permissions: [],
    links: {
      inspire: { role: 'readonly' },
      inspiredrev: { role: 'sales' },
    },
  },
];

export const ROLE_KEYS = ROLES.map((r) => r.key);

export function roleByKey(key: string): RoleSeed | undefined {
  return ROLES.find((r) => r.key === key);
}

export function permissionsFor(roleKey: string): PermissionSeed[] {
  const role = roleByKey(roleKey);
  if (!role) return [];
  return PERMISSIONS.filter((p) => role.permissions.includes(p.key));
}

/** The role the sunrise account is created with. */
export const SUNRISE_ROLE = 'owner';
