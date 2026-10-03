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
