import { prisma } from '../db.ts';
import { isLive, type Scope } from '../auth/scope.ts';
import {
  PEOPLE_CONTRACT,
  SIGNATURE_HEADER,
  coalescePeople,
  peopleUrlFor,
  signBody,
  type PeopleAck,
  type PeopleBatch,
  type PeopleConsumer,
  type Person,
  type PersonStatus,
} from '../shell/contract.ts';
import { translateGrants, type LiveGrant, type Translated } from './translate.ts';

/**
 * The people stream, console side (docs/01 §2.8). The shell stream's twin:
 * the same two halves, the same subscriptions and secrets, its own outbox and
 * cursor.
 *
 *   notePeople  — bump the person's version and append a notice, in one
 *                 transaction.
 *   deliver     — push everything past a subscriber's people cursor, signed.
 *
 * A delivery failing never fails the grant, status or password change that
 * caused it. A consumer that missed one is behind until the next delivery —
 * another change, the daily cron, or `npm run people -- deliver`. Until then
 * it keeps signing people in on what it last heard, which is R2: the console
 * is never on the path to signing in to the PMS.
 *
 * No `next/*` reachable from here: the CLI imports it.
 */

export type PeopleReason = 'grant' | 'status' | 'password' | 'profile' | 'backfill';

export async function notePeople(personIds: readonly string[], reason: PeopleReason): Promise<number[]> {
  const unique = [...new Set(personIds)];
  if (!unique.length) return [];
  return prisma.$transaction(async (tx) => {
    const seqs: number[] = [];
    for (const id of unique) {
      const p = await tx.person.update({
        where: { id },
        data: { personVersion: { increment: 1 } },
        select: { personVersion: true },
      });
      const e = await tx.personEvent.create({
        data: { personId: id, personVersion: p.personVersion, reason },
        select: { seq: true },
      });
      seqs.push(e.seq);
    }
    return seqs;
  });
}

/** Note, then try to deliver right away. The delivery half never throws. */
export async function publishPeople(personIds: readonly string[], reason: PeopleReason): Promise<void> {
  const seqs = await notePeople(personIds, reason);
  if (seqs.length) await deliverAllPeopleQuietly();
}

// ── building a person ──────────────────────────────────────────────────────

/** What this person's live grants become in each consumer, right now. */
export async function translatedAccess(personId: string): Promise<Translated> {
  const grants = await prisma.grant.findMany({
    where: { personId, effectiveTo: null },
    include: { downstream: true },
  });
  const now = new Date();
  const live = grants.filter((g) => isLive(g, now));

  // Property grants hold an inn code (docs/01 §5); consumers key on the id. The
  // inn_code ledger keeps retired codes, so a grant made before a rebrand
  // still lands on the same hotel.
  const codes = [...new Set(live.filter((g) => g.scope === 'property' && g.scopeRef).map((g) => g.scopeRef!))];
  const ledger = codes.length
    ? await prisma.innCode.findMany({ where: { code: { in: codes } }, select: { code: true, propertyId: true } })
    : [];
  const idByCode = new Map(ledger.map((c) => [c.code, c.propertyId]));

  const input: LiveGrant[] = live.map((g) => ({
    scope: g.scope as Scope,
    ref: g.scope === 'property' ? (idByCode.get(g.scopeRef ?? '') ?? null) : g.scopeRef,
    roleKey: g.roleKey,
    downstream: g.downstream,
  }));
  return translateGrants(input);
}

/** The person as one consumer should see them. Null if they do not exist. */
export async function buildPerson(personId: string, consumer: PeopleConsumer): Promise<Person | null> {
  const p = await prisma.person.findUnique({ where: { id: personId } });
  if (!p) return null;
  const access = await translatedAccess(personId);
  return {
    contract: PEOPLE_CONTRACT,
    personId: p.id,
    email: p.email,
    name: p.name,
    status: p.status as PersonStatus,
    passwordHash: p.passwordHash ?? '',
    // A person delivered before their first notice (a replay racing a write)
    // still carries a valid version; the consumer's newer-wins rule sorts it out.
    personVersion: Math.max(p.personVersion, 1),
    grants: access[consumer],
  };
}

// ── delivery ───────────────────────────────────────────────────────────────

const BATCH_WINDOW = 500;
const MAX_ROUNDS = 10;
const TIMEOUT_MS = 8_000;

export interface PeopleDeliveryResult {
  subscriber: string;
  ok: boolean;
  delivered: number;
  cursor: number;
  head: number;
  error?: string;
}

export async function peopleHead(): Promise<number> {
  const top = await prisma.personEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  return top?.seq ?? 0;
}

function isPeopleConsumer(name: string): name is PeopleConsumer {
  return name === 'inspire' || name === 'inspiredrev';
}

export async function deliverPeople(name: string): Promise<PeopleDeliveryResult> {
  const sub = await prisma.shellSubscriber.findUnique({ where: { name } });
  if (!sub) throw new Error(`No subscriber named "${name}".`);
  if (!isPeopleConsumer(sub.name)) throw new Error(`${sub.name} is not a people consumer.`);
  const consumer = sub.name;
  const url = peopleUrlFor(sub.url);
  const head = await peopleHead();
  let cursor = sub.peopleCursor;
  let delivered = 0;

  for (let round = 0; round < MAX_ROUNDS && cursor < head; round += 1) {
    const window = await prisma.personEvent.findMany({
      where: { seq: { gt: cursor } },
      orderBy: { seq: 'asc' },
      take: BATCH_WINDOW,
      select: { seq: true, personId: true },
    });
    if (!window.length) break;

    const { through, latest } = coalescePeople(window);
    const events = [];
    for (const n of latest) {
      const person = await buildPerson(n.personId, consumer);
      if (person) events.push({ seq: n.seq, person });
    }
    const batch: PeopleBatch = {
      contract: PEOPLE_CONTRACT,
      subscriber: sub.name,
      after: cursor,
      through,
      events,
      sentAt: new Date().toISOString(),
    };

    const attemptAt = new Date();
    let ack: PeopleAck | null = null;
    let error = '';
    try {
      const body = JSON.stringify(batch);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signBody(sub.secret, body) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      const parsed = (await res.json().catch(() => null)) as PeopleAck | { error?: string } | null;
      if (parsed && 'appliedThrough' in parsed && Number.isInteger(parsed.appliedThrough)) {
        ack = parsed;
        if (!parsed.ok) error = parsed.error ?? `${sub.name} applied only part of the batch.`;
      } else {
        error = (parsed as { error?: string } | null)?.error ?? `${sub.name} answered HTTP ${res.status}.`;
      }
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
      error = err instanceof Error ? `Could not reach ${sub.name}: ${err.message}${cause}` : `Could not reach ${sub.name}.`;
    }

    const acked = ack ? Math.min(Math.max(ack.appliedThrough, cursor), through) : cursor;
    if (acked > cursor) delivered += events.filter((e) => e.seq <= acked).length;
    cursor = acked;

    await prisma.shellSubscriber.update({
      where: { name: sub.name },
      data: {
        peopleCursor: cursor,
        peopleLastAttemptAt: attemptAt,
        peopleLastError: error,
        ...(error ? {} : { peopleLastDeliveredAt: attemptAt }),
      },
    });
    if (error) return { subscriber: sub.name, ok: false, delivered, cursor, head, error };
  }

  return { subscriber: sub.name, ok: true, delivered, cursor, head };
}

export async function deliverAllPeople(): Promise<PeopleDeliveryResult[]> {
  const subs = await prisma.shellSubscriber.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  return Promise.all(
    subs
      .filter((s) => isPeopleConsumer(s.name))
      .map((s) =>
        deliverPeople(s.name).catch(
          (err: unknown): PeopleDeliveryResult => ({
            subscriber: s.name,
            ok: false,
            delivered: 0,
            cursor: s.peopleCursor,
            head: 0,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      ),
  );
}

export async function deliverAllPeopleQuietly(): Promise<void> {
  try {
    await deliverAllPeople();
  } catch {
    /* the change is recorded; being behind is visible and self-healing */
  }
}

/** Announce every person once — how existing people enter the stream. */
export async function backfillPeople(): Promise<number> {
  const all = await prisma.person.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  await notePeople(all.map((p) => p.id), 'backfill');
  return all.length;
}

export async function rewindPeople(name: string, to = 0): Promise<void> {
  await prisma.shellSubscriber.update({ where: { name }, data: { peopleCursor: to, peopleLastError: '' } });
}

export async function listPeopleSubscribers() {
  const [subs, head] = await Promise.all([
    prisma.shellSubscriber.findMany({ orderBy: { name: 'asc' } }),
    peopleHead(),
  ]);
  return {
    head,
    subs: subs.map((s) => ({
      name: s.name,
      url: peopleUrlFor(s.url),
      active: s.active,
      cursor: s.peopleCursor,
      lastDeliveredAt: s.peopleLastDeliveredAt,
      lastError: s.peopleLastError,
    })),
  };
}

/** Per-consumer delivery state for one person — for the People page. */
export async function peopleProvisioningFor(personId: string) {
  const [subs, latest] = await Promise.all([
    prisma.shellSubscriber.findMany({ orderBy: { name: 'asc' } }),
    prisma.personEvent.findFirst({ where: { personId }, orderBy: { seq: 'desc' }, select: { seq: true } }),
  ]);
  return subs
    .filter((s) => isPeopleConsumer(s.name))
    .map((s) => ({
      subscriber: s.name,
      state: !latest ? ('never' as const) : s.peopleCursor >= latest.seq ? ('current' as const) : ('behind' as const),
      lastError: s.peopleLastError,
    }));
}
