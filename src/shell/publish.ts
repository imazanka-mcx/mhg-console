import { randomBytes } from 'node:crypto';

import { prisma } from '../db.ts';
import {
  SHELL_CONTRACT,
  SIGNATURE_HEADER,
  coalesce,
  signBody,
  type Shell,
  type ShellAck,
  type ShellBatch,
  type ShellStatus,
} from './contract.ts';

/**
 * The shell stream, console side (docs/01 §1.4).
 *
 * Two halves with a deliberate gap between them:
 *
 *   noteChanged  — bump the property's shellVersion and append a change notice,
 *                  in one transaction. Cheap, local, always succeeds if the
 *                  database is up.
 *   deliver      — push everything past a subscriber's cursor, signed, and move
 *                  the cursor to whatever the subscriber acknowledges.
 *
 * Delivery failing never fails the change that caused it. The registry is
 * correct the moment the write commits; a consumer that missed a delivery is
 * BEHIND, which the property page and the subscriber's `lastError` both show,
 * and the next delivery — another change, the daily cron, or `npm run shell --
 * deliver` — catches it up from its cursor. That is R2 from this side: the
 * console is not on anyone's critical path, and nobody is on the console's.
 *
 * No `next/*` reachable from here: the CLI imports it.
 */

export type ShellReason = 'issued' | 'status' | 'rebrand' | 'setup' | 'groups' | 'backfill';

/** Record that these properties changed. Returns the seqs written, in order. */
export async function noteChanged(propertyIds: readonly string[], reason: ShellReason): Promise<number[]> {
  const unique = [...new Set(propertyIds)];
  if (!unique.length) return [];
  return prisma.$transaction(async (tx) => {
    const seqs: number[] = [];
    for (const id of unique) {
      const p = await tx.property.update({
        where: { id },
        data: { shellVersion: { increment: 1 } },
        select: { shellVersion: true },
      });
      const e = await tx.shellEvent.create({
        data: { propertyId: id, shellVersion: p.shellVersion, reason },
        select: { seq: true },
      });
      seqs.push(e.seq);
    }
    return seqs;
  });
}

/**
 * The usual entry point after a registry write: note it, then try to deliver
 * right away so a consumer sees a new pipeline hotel in seconds rather than at
 * the next cron. The delivery half never throws.
 */
export async function publish(propertyIds: readonly string[], reason: ShellReason): Promise<void> {
  const seqs = await noteChanged(propertyIds, reason);
  if (seqs.length) await deliverAllQuietly();
}

// ── building a shell ───────────────────────────────────────────────────────

/** The current shell for one property, from current state. Null if it does not exist. */
export async function buildShell(propertyId: string): Promise<Shell | null> {
  const p = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!p) return null;
  const [claim, members] = await Promise.all([
    prisma.marketClaim.findUnique({ where: { marketCode: p.marketCode }, select: { source: true } }),
    prisma.propertyGroupMember.findMany({ where: { propertyId }, select: { groupId: true } }),
  ]);
  return {
    contract: SHELL_CONTRACT,
    propertyId: p.id,
    innCode: p.code,
    propCode: p.propCode,
    predecessorCode: p.predecessorCode,
    name: p.name,
    brandCode: p.brandCode,
    brandName: p.brandName,
    chainCode: p.chainCode,
    marketCode: p.marketCode,
    marketSource: claim?.source ?? '',
    city: p.city,
    state: p.state,
    submarket: p.submarket,
    franchisorCode: p.franchisorCode,
    timezone: p.timezone,
    currency: p.currency,
    groups: members.map((m) => m.groupId).sort(),
    status: p.status as ShellStatus,
    effectiveDate: p.effectiveDate,
    expectedOpenDate: p.expectedOpenDate,
    shellVersion: p.shellVersion,
  };
}

// ── delivery ───────────────────────────────────────────────────────────────

const BATCH_WINDOW = 500;
const MAX_ROUNDS = 10;
const TIMEOUT_MS = 8_000;

export interface DeliveryResult {
  subscriber: string;
  ok: boolean;
  delivered: number;
  cursor: number;
  head: number;
  error?: string;
}

/** The highest seq in the stream; 0 when empty. */
export async function streamHead(): Promise<number> {
  const top = await prisma.shellEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  return top?.seq ?? 0;
}

/**
 * Push a subscriber up to the head of the stream, one window at a time.
 * Stops at the first window the consumer does not fully acknowledge.
 */
export async function deliver(name: string): Promise<DeliveryResult> {
  const sub = await prisma.shellSubscriber.findUnique({ where: { name } });
  if (!sub) throw new Error(`No subscriber named "${name}".`);
  const head = await streamHead();
  let cursor = sub.cursor;
  let delivered = 0;

  for (let round = 0; round < MAX_ROUNDS && cursor < head; round += 1) {
    const window = await prisma.shellEvent.findMany({
      where: { seq: { gt: cursor } },
      orderBy: { seq: 'asc' },
      take: BATCH_WINDOW,
      select: { seq: true, propertyId: true },
    });
    if (!window.length) break;

    const { through, latest } = coalesce(window);
    const events = [];
    for (const n of latest) {
      const shell = await buildShell(n.propertyId);
      if (shell) events.push({ seq: n.seq, shell });
    }
    const batch: ShellBatch = {
      contract: SHELL_CONTRACT,
      subscriber: sub.name,
      after: cursor,
      through,
      events,
      sentAt: new Date().toISOString(),
    };

    const attemptAt = new Date();
    let ack: ShellAck | null = null;
    let error = '';
    try {
      const body = JSON.stringify(batch);
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signBody(sub.secret, body) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      const parsed = (await res.json().catch(() => null)) as ShellAck | { error?: string } | null;
      if (parsed && 'appliedThrough' in parsed && Number.isInteger(parsed.appliedThrough)) {
        ack = parsed;
        if (!parsed.ok) error = parsed.error ?? `${sub.name} applied only part of the batch.`;
      } else {
        error = (parsed as { error?: string } | null)?.error ?? `${sub.name} answered HTTP ${res.status}.`;
      }
    } catch (err) {
      // Node's fetch says only "fetch failed"; the useful part is the cause.
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
      error = err instanceof Error ? `Could not reach ${sub.name}: ${err.message}${cause}` : `Could not reach ${sub.name}.`;
    }

    // Never move a cursor backwards, and never past what this batch covered —
    // an ack claiming more than it was sent is a consumer bug, not progress.
    const acked = ack ? Math.min(Math.max(ack.appliedThrough, cursor), through) : cursor;
    if (acked > cursor) delivered += events.filter((e) => e.seq <= acked).length;
    cursor = acked;

    await prisma.shellSubscriber.update({
      where: { name: sub.name },
      data: {
        cursor,
        lastAttemptAt: attemptAt,
        lastError: error,
        ...(error ? {} : { lastDeliveredAt: attemptAt }),
      },
    });
    if (error) return { subscriber: sub.name, ok: false, delivered, cursor, head, error };
  }

  return { subscriber: sub.name, ok: true, delivered, cursor, head };
}

/** Every active subscriber, in parallel. One failing never stops another. */
export async function deliverAll(): Promise<DeliveryResult[]> {
  const subs = await prisma.shellSubscriber.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  return Promise.all(
    subs.map((s) =>
      deliver(s.name).catch(
        (err: unknown): DeliveryResult => ({
          subscriber: s.name,
          ok: false,
          delivered: 0,
          cursor: s.cursor,
          head: 0,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ),
  );
}

export async function deliverAllQuietly(): Promise<void> {
  try {
    await deliverAll();
  } catch {
    /* the change is recorded; being behind is visible and self-healing */
  }
}

// ── subscribers ────────────────────────────────────────────────────────────

/** Register or re-point a consumer. Returns the secret — shown once, set it on the consumer. */
export async function registerSubscriber(name: string, url: string, rotate = false): Promise<{ secret: string; created: boolean }> {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) throw new Error('Subscriber names are lowercase slugs, e.g. `inspire`.');
  if (!/^https?:\/\//.test(url)) throw new Error('The URL must be http(s).');
  const existing = await prisma.shellSubscriber.findUnique({ where: { name } });
  const secret = !existing || rotate ? randomBytes(32).toString('base64url') : existing.secret;
  await prisma.shellSubscriber.upsert({
    where: { name },
    create: { name, url, secret },
    update: { url, secret, active: true },
  });
  return { secret, created: !existing };
}

/**
 * Rewind a subscriber. Safe by construction: consumers ignore any shell not
 * newer than the one they hold, so a replay can only fill gaps.
 */
export async function rewind(name: string, to = 0): Promise<void> {
  await prisma.shellSubscriber.update({ where: { name }, data: { cursor: to, lastError: '' } });
}

/** Announce every property once — how existing rows enter the stream the first time. */
export async function backfill(): Promise<number> {
  const all = await prisma.property.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  await noteChanged(all.map((p) => p.id), 'backfill');
  return all.length;
}

// ── provisioning view ──────────────────────────────────────────────────────

export interface ProvisioningRow {
  subscriber: string;
  url: string;
  active: boolean;
  /** `current` — the consumer has acknowledged this property's latest change. */
  state: 'current' | 'behind' | 'never';
  lastDeliveredAt: Date | null;
  lastError: string;
}

/**
 * Per-subscriber state for one property — the one operational screen that is
 * legitimately console work, because it is about the portfolio rather than a
 * stay (§1.4).
 */
export async function provisioningFor(propertyId: string): Promise<ProvisioningRow[]> {
  const [subs, latest] = await Promise.all([
    prisma.shellSubscriber.findMany({ orderBy: { name: 'asc' } }),
    prisma.shellEvent.findFirst({ where: { propertyId }, orderBy: { seq: 'desc' }, select: { seq: true } }),
  ]);
  return subs.map((s) => ({
    subscriber: s.name,
    url: s.url,
    active: s.active,
    state: !latest ? 'never' : s.cursor >= latest.seq ? 'current' : 'behind',
    lastDeliveredAt: s.lastDeliveredAt,
    lastError: s.lastError,
  }));
}

export async function listSubscribers() {
  const [subs, head] = await Promise.all([
    prisma.shellSubscriber.findMany({ orderBy: { name: 'asc' } }),
    streamHead(),
  ]);
  return { head, subs: subs.map(({ secret: _secret, ...rest }) => rest) };
}
