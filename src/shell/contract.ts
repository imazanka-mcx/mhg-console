/**
 * The shell contract — MHG registry → consumer (mhg-console docs/01 §1.3, §1.4).
 *
 * THIS FILE IS SHARED VERBATIM. The canonical copy lives in
 * mhg-console/src/shell/contract.ts; mhotels-inspire and mhg-inspiredrev each
 * carry an identical copy at src/lib/registry/contract.ts. There is no shared
 * package because there is no package registry in this ecosystem (see the
 * @mcx/inn-code pinning in mhg-console docs/01 §4 step 0), and a contract this
 * small is cheaper to copy than to publish. The rule that keeps the copies
 * honest: change the canonical one, bump SHELL_CONTRACT if the shape changed,
 * copy it over, and `diff` the three. A consumer refuses a batch whose
 * contract number it does not know, so a half-rolled change fails loudly.
 *
 * Constraints on this file, so all three repos can load it as-is:
 *   - no imports except node:crypto (no aliases, no relative paths)
 *   - erasable TypeScript only, so `node --experimental-strip-types` runs it
 *   - no runtime dependencies (no zod — the validator below is hand-written)
 *
 * The shell is IDENTITY, NOT CONFIGURATION. Rooms, rate plans, taxes, GL
 * mappings and A/R are consumer-side and never appear here. Neither does
 * businessDate — that is operational state the PMS owns from the moment it
 * stands a property up.
 *
 * The same file carries the PEOPLE stream (docs/01 §2.8): who may sign in to
 * each consumer, with what password and what access. Same signing, same
 * cursor discipline, its own contract number.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHELL_CONTRACT = 1;

export type ShellStatus = 'pipeline' | 'active' | 'retired';
export const SHELL_STATUSES: readonly ShellStatus[] = ['pipeline', 'active', 'retired'];

export interface Shell {
  contract: number;
  /** Immutable. The key every consumer holds — never the code (G1). */
  propertyId: string;
  /** The code this property flies today. A rebrand changes it (G2). */
  innCode: string;
  propCode: string;
  /** The code this one replaced on a rebrand; '' otherwise. */
  predecessorCode: string;
  name: string;
  brandCode: string;
  brandName: string;
  chainCode: string;
  marketCode: string;
  /** Which rung of the M ladder produced the market code (M7 audit). */
  marketSource: string;
  city: string;
  state: string;
  submarket: string;
  /** Cross-reference only, never an identifier (G5). */
  franchisorCode: string;
  timezone: string;
  currency: string;
  /** Group ids, sorted. Membership is registry-owned and flows down too. */
  groups: string[];
  status: ShellStatus;
  /** When the CODE was issued (G6), YYYY-MM-DD. */
  effectiveDate: string;
  /** Planned opening, YYYY-MM-DD, or '' when not yet known. */
  expectedOpenDate: string;
  /** Monotonic per property. Apply only if newer than what you hold. */
  shellVersion: number;
}

/** One shell in a batch, tagged with the stream position that produced it. */
export interface ShellEnvelope {
  seq: number;
  shell: Shell;
}

/** What the console POSTs to a consumer. */
export interface ShellBatch {
  contract: number;
  subscriber: string;
  /** The consumer's acknowledged cursor when this batch was cut. */
  after: number;
  /** The highest seq this batch covers. Acking it means "caught up to here". */
  through: number;
  /** Ascending by seq, at most one per property. */
  events: ShellEnvelope[];
  sentAt: string;
}

export type ApplyOutcome = 'applied' | 'stale' | 'failed';

/** What a consumer answers. */
export interface ShellAck {
  ok: boolean;
  /** Highest seq fully applied. Equals `through` on success, less on a partial failure. */
  appliedThrough: number;
  results: { propertyId: string; shellVersion: number; outcome: ApplyOutcome; detail?: string }[];
  error?: string;
}

// ── signing ────────────────────────────────────────────────────────────────

export const SIGNATURE_HEADER = 'x-mhg-registry-signature';
/** How far apart the two clocks may be before a signature is refused as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function mac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. The timestamp is inside
 * the MAC, so a captured delivery cannot be replayed later with a fresh one.
 */
export function signBody(secret: string, body: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${mac(secret, t, body)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyBody(
  secret: string,
  body: string,
  header: string | null | undefined,
  now: Date = new Date(),
): VerifyResult {
  if (!secret) return { ok: false, reason: 'No shell secret is configured on this side.' };
  if (!header) return { ok: false, reason: 'Missing signature.' };

  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=');
    if (i > 0) parts.set(piece.slice(0, i).trim(), piece.slice(i + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) {
    return { ok: false, reason: 'Malformed signature.' };
  }
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'Signature timestamp is outside the tolerance window.' };
  }

  const expected = Buffer.from(mac(secret, t, body), 'hex');
  const given = Buffer.from(v1, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'Signature does not match.' };
  }
  return { ok: true };
}

// ── shape checks (consumer side) ───────────────────────────────────────────

const STRING_FIELDS = [
  'propertyId', 'innCode', 'propCode', 'predecessorCode', 'name', 'brandCode', 'brandName',
  'chainCode', 'marketCode', 'marketSource', 'city', 'state', 'submarket', 'franchisorCode',
  'timezone', 'currency', 'effectiveDate', 'expectedOpenDate',
] as const;

/** Why a value is not a shell, or null if it is one. */
export function shellProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v['contract'] !== SHELL_CONTRACT) return `unknown contract ${String(v['contract'])}`;
  for (const f of STRING_FIELDS) {
    if (typeof v[f] !== 'string') return `${f} is not a string`;
  }
  if (!v['propertyId'] || !v['innCode'] || !v['name']) return 'propertyId, innCode and name are required';
  if (!SHELL_STATUSES.includes(v['status'] as ShellStatus)) return `unknown status ${String(v['status'])}`;
  if (!Array.isArray(v['groups']) || !v['groups'].every((g) => typeof g === 'string')) {
    return 'groups is not a list of ids';
  }
  if (!Number.isInteger(v['shellVersion']) || (v['shellVersion'] as number) < 1) {
    return 'shellVersion is not a positive integer';
  }
  return null;
}

/** Why a parsed body is not a batch, or null if it is one. Checks every shell in it. */
export function batchProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const b = value as Record<string, unknown>;
  if (b['contract'] !== SHELL_CONTRACT) return `unknown contract ${String(b['contract'])}`;
  if (!Number.isInteger(b['after']) || !Number.isInteger(b['through'])) return 'after/through missing';
  if (!Array.isArray(b['events'])) return 'events missing';
  let last = b['after'] as number;
  for (const e of b['events'] as unknown[]) {
    const env = e as Record<string, unknown>;
    if (!Number.isInteger(env?.['seq'])) return 'event without a seq';
    if ((env['seq'] as number) <= last) return 'events are not ascending';
    last = env['seq'] as number;
    const problem = shellProblem(env['shell']);
    if (problem) return `event ${String(env['seq'])}: ${problem}`;
  }
  if (last > (b['through'] as number)) return 'an event lies past `through`';
  return null;
}

/** The consumer's idempotency rule: newer wins, everything else is a no-op. */
export function isNewer(incoming: number, held: number | null | undefined): boolean {
  return held === null || held === undefined || incoming > held;
}

// ── batching (console side) ────────────────────────────────────────────────

/**
 * Collapse a window of change notices to one entry per property, at its last
 * seq. The shell is built from current state, so three edits to one hotel are
 * one delivery. Returned ascending by seq; `through` is the window's top even
 * when the last notice in it was for a property already listed.
 */
export function coalesce(
  notices: readonly { seq: number; propertyId: string }[],
): { through: number; latest: { seq: number; propertyId: string }[] } {
  const last = new Map<string, number>();
  let through = 0;
  for (const n of notices) {
    last.set(n.propertyId, Math.max(last.get(n.propertyId) ?? 0, n.seq));
    through = Math.max(through, n.seq);
  }
  const latest = [...last.entries()]
    .map(([propertyId, seq]) => ({ seq, propertyId }))
    .sort((a, b) => a.seq - b.seq);
  return { through, latest };
}

// ── the people stream (docs/01 §2.8) ───────────────────────────────────────

export const PEOPLE_CONTRACT = 1;

export type PersonStatus = 'invited' | 'active' | 'suspended' | 'offboarded';
export const PERSON_STATUSES: readonly PersonStatus[] = ['invited', 'active', 'suspended', 'offboarded'];

export type GrantScope = 'portfolio' | 'group' | 'property';
export const GRANT_SCOPES: readonly GrantScope[] = ['portfolio', 'group', 'property'];

/** The consumers a person can be given access to. */
export type PeopleConsumer = 'inspire' | 'inspiredrev';
export const PEOPLE_CONSUMERS: readonly PeopleConsumer[] = ['inspire', 'inspiredrev'];

/**
 * One live grant, already translated into the consumer's own role (the
 * console's role crosswalk, docs/01 §2.7). The consumer resolves WHERE itself,
 * from its registry mirror: `portfolio` is every property, `group` is every
 * property whose shell lists that group id, `property` is that propertyId.
 */
export interface PersonGrant {
  scope: GrantScope;
  /** '' for portfolio; a group id; or the registry propertyId — never the code. */
  ref: string;
  /** The consumer's role key, e.g. `gm`, `corporate_admin`, `revenue_manager`. */
  role: string;
}

export interface Person {
  contract: number;
  /** Immutable. The key every consumer holds for this human. */
  personId: string;
  /** Lowercased. Also the sign-in name everywhere. */
  email: string;
  name: string;
  /** Only `active` may sign in. Anything else is a person who keeps their history and loses their access. */
  status: PersonStatus;
  /** bcrypt. '' when the person has no password yet — nobody can sign in as them. */
  passwordHash: string;
  /** Monotonic per person. Apply only if newer than what you hold. */
  personVersion: number;
  /** This consumer's grants only. Empty means a person with no access here. */
  grants: PersonGrant[];
}

export interface PersonEnvelope {
  seq: number;
  person: Person;
}

/** What the console POSTs to a consumer's /api/registry/v1/people. */
export interface PeopleBatch {
  contract: number;
  subscriber: string;
  after: number;
  through: number;
  events: PersonEnvelope[];
  sentAt: string;
}

export interface PeopleAck {
  ok: boolean;
  appliedThrough: number;
  results: { personId: string; personVersion: number; outcome: ApplyOutcome; detail?: string }[];
  error?: string;
}

/**
 * A consumer → console password change (POST /api/registry/v1/people/password),
 * signed with the same secret. The consumer has already checked the current
 * password against the hash it holds; it sends the NEW hash, never a password.
 */
export interface PasswordChange {
  contract: number;
  subscriber: string;
  personId: string;
  passwordHash: string;
  sentAt: string;
}

export interface PasswordChangeAck {
  ok: boolean;
  /** The person's version after the change; apply your own copy at this version. */
  personVersion?: number;
  error?: string;
}

/** bcrypt, any of the $2a/$2b/$2y variants. */
export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

/** Why a value is not a person, or null if it is one. */
export function personProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v['contract'] !== PEOPLE_CONTRACT) return `unknown contract ${String(v['contract'])}`;
  for (const f of ['personId', 'email', 'name', 'passwordHash'] as const) {
    if (typeof v[f] !== 'string') return `${f} is not a string`;
  }
  if (!v['personId'] || !v['email']) return 'personId and email are required';
  if (v['passwordHash'] !== '' && !isBcryptHash(v['passwordHash'] as string)) return 'passwordHash is not bcrypt';
  if (!PERSON_STATUSES.includes(v['status'] as PersonStatus)) return `unknown status ${String(v['status'])}`;
  if (!Number.isInteger(v['personVersion']) || (v['personVersion'] as number) < 1) {
    return 'personVersion is not a positive integer';
  }
  if (!Array.isArray(v['grants'])) return 'grants is not a list';
  for (const g of v['grants'] as unknown[]) {
    const grant = g as Record<string, unknown>;
    if (!GRANT_SCOPES.includes(grant?.['scope'] as GrantScope)) return `grant with unknown scope ${String(grant?.['scope'])}`;
    if (typeof grant['ref'] !== 'string' || typeof grant['role'] !== 'string' || !grant['role']) return 'grant without ref or role';
    if ((grant['scope'] === 'portfolio') !== (grant['ref'] === '')) return 'a portfolio grant has no ref, and only it';
  }
  return null;
}

export function peopleBatchProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const b = value as Record<string, unknown>;
  if (b['contract'] !== PEOPLE_CONTRACT) return `unknown contract ${String(b['contract'])}`;
  if (!Number.isInteger(b['after']) || !Number.isInteger(b['through'])) return 'after/through missing';
  if (!Array.isArray(b['events'])) return 'events missing';
  let last = b['after'] as number;
  for (const e of b['events'] as unknown[]) {
    const env = e as Record<string, unknown>;
    if (!Number.isInteger(env?.['seq'])) return 'event without a seq';
    if ((env['seq'] as number) <= last) return 'events are not ascending';
    last = env['seq'] as number;
    const problem = personProblem(env['person']);
    if (problem) return `event ${String(env['seq'])}: ${problem}`;
  }
  if (last > (b['through'] as number)) return 'an event lies past `through`';
  return null;
}

export function passwordChangeProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v['contract'] !== PEOPLE_CONTRACT) return `unknown contract ${String(v['contract'])}`;
  if (typeof v['subscriber'] !== 'string' || !v['subscriber']) return 'subscriber missing';
  if (typeof v['personId'] !== 'string' || !v['personId']) return 'personId missing';
  if (typeof v['passwordHash'] !== 'string' || !isBcryptHash(v['passwordHash'])) return 'passwordHash is not bcrypt';
  return null;
}

/**
 * Collapse a window of person notices to one per person, at its last seq —
 * the person is built from current state, so a burst of grants delivers once.
 */
export function coalescePeople(
  notices: readonly { seq: number; personId: string }[],
): { through: number; latest: { seq: number; personId: string }[] } {
  const { through, latest } = coalesce(notices.map((n) => ({ seq: n.seq, propertyId: n.personId })));
  return { through, latest: latest.map((l) => ({ seq: l.seq, personId: l.propertyId })) };
}

/** Where a subscriber's people receiver lives: next to its shell receiver. */
export function peopleUrlFor(shellUrl: string): string {
  return shellUrl.replace(/\/shell\/?$/, '/people');
}

/** Where a consumer sends password changes: the console's base URL + this path. */
export const PASSWORD_CHANGE_PATH = '/api/registry/v1/people/password';

// ── provisioning from a consumer (docs/01 §2.9) ────────────────────────────

/**
 * Inspire's Users flow provisions through the console: a GM adds, re-roles or
 * removes someone at their hotel, the console records it as a person and a
 * grant, and the people stream brings it back. Signed with the subscription
 * secret, like a password change. `role` is the consumer's own role key; the
 * console maps it to a property-only console role, so nothing provisioned from
 * below ever reaches the console itself.
 */
export const PROVISION_PATH = '/api/registry/v1/people/provision';

export interface ProvisionGrant {
  contract: number;
  subscriber: string;
  op: 'grant';
  /** The registry person making the change — must hold admin or gm there. */
  actorPersonId: string;
  email: string;
  name: string;
  /** bcrypt of the initial password for someone new; '' for someone who already exists. */
  passwordHash: string;
  /** Registry propertyId of the hotel. */
  propertyId: string;
  role: string;
  sentAt: string;
}

export interface ProvisionRemove {
  contract: number;
  subscriber: string;
  op: 'remove';
  actorPersonId: string;
  email: string;
  propertyId: string;
  sentAt: string;
}

/** One local account brought into the console, once. Roles in the consumer's own terms. */
export interface ImportedPerson {
  email: string;
  name: string;
  passwordHash: string;
  active: boolean;
  roles: PersonGrant[];
}

export interface ProvisionImport {
  contract: number;
  subscriber: string;
  op: 'import';
  people: ImportedPerson[];
  sentAt: string;
}

export type ProvisionRequest = ProvisionGrant | ProvisionRemove | ProvisionImport;

export interface ProvisionAck {
  ok: boolean;
  personId?: string;
  results?: { email: string; outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'; detail?: string }[];
  error?: string;
}

export function provisionProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v['contract'] !== PEOPLE_CONTRACT) return `unknown contract ${String(v['contract'])}`;
  if (typeof v['subscriber'] !== 'string' || !v['subscriber']) return 'subscriber missing';
  const str = (k: string) => typeof v[k] === 'string' && (v[k] as string).length > 0;
  switch (v['op']) {
    case 'grant':
      if (!str('actorPersonId') || !str('email') || !str('propertyId') || !str('role')) return 'grant needs actorPersonId, email, propertyId and role';
      if (typeof v['name'] !== 'string') return 'name is not a string';
      if (typeof v['passwordHash'] !== 'string' || (v['passwordHash'] !== '' && !isBcryptHash(v['passwordHash'] as string))) {
        return 'passwordHash is not bcrypt';
      }
      return null;
    case 'remove':
      if (!str('actorPersonId') || !str('email') || !str('propertyId')) return 'remove needs actorPersonId, email and propertyId';
      return null;
    case 'import': {
      if (!Array.isArray(v['people'])) return 'people missing';
      for (const p of v['people'] as unknown[]) {
        const person = p as Record<string, unknown>;
        if (typeof person?.['email'] !== 'string' || !person['email']) return 'an imported person has no email';
        if (typeof person['name'] !== 'string' || typeof person['active'] !== 'boolean') return `${String(person['email'])}: name/active missing`;
        if (typeof person['passwordHash'] !== 'string') return `${String(person['email'])}: passwordHash missing`;
        if (!Array.isArray(person['roles'])) return `${String(person['email'])}: roles missing`;
      }
      return null;
    }
    default:
      return `unknown op ${String(v['op'])}`;
  }
}
