import { prisma } from '../db.ts';
import { grantAccess, hasConsoleAccess, revokeGrant } from '../auth/access.ts';
import { consoleRoleFor, consumerRole, FROM_CONSUMER, type Consumer } from '../auth/consumer-roles.ts';
import {
  isBcryptHash,
  provisionProblem,
  verifyBody,
  type ImportedPerson,
  type ProvisionAck,
  type ProvisionGrant,
  type ProvisionRemove,
  type ProvisionRequest,
} from '../shell/contract.ts';
import { changeGrant } from './manage.ts';
import { mapImported } from './import-map.ts';
import { publishPeople, translatedAccess } from './publish.ts';

/**
 * Provisioning from below (docs/01 §2.9).
 *
 * Every person who works at an MHG hotel is in the console — corporate staff
 * and the whole field. Corporate provisions on People; a GM provisions their
 * own staff in Inspire's Users & Roles, which calls this. Either way the person
 * and their grant live here, corporate can see and change them, and the people
 * stream carries the result back down.
 *
 * What a consumer may do here is deliberately narrow:
 *   - only at one hotel, and only with a role that maps to a property-only
 *     console role (FROM_CONSUMER) — nobody provisioned from below can reach
 *     the console, or authority above one hotel;
 *   - only someone acting who holds Inspire admin or gm at that hotel (or is a
 *     corporate admin), and never above their own rank there;
 *   - never on a corporate account, and never on themselves.
 *
 * The one-time import is the exception that runs without an actor: it brings
 * each existing local account in, with the same mapping, and creates nothing a
 * consumer could not have asked for one person at a time.
 *
 * Returns [status, body]. No `next/*`.
 */

const MANAGERS = new Set(['admin', 'gm']);

function rankIn(consumer: Consumer, role: string): number {
  return consumerRole(consumer, role)?.rank ?? 0;
}

/** The actor's strongest Inspire role at this property, or 'corporate_admin', or null. */
async function inspireRoleAt(personId: string, propertyId: string): Promise<string | null> {
  const access = await translatedAccess(personId);
  const grants = access.inspire;
  if (grants.some((g) => g.role === 'corporate_admin')) return 'corporate_admin';
  const groups = grants.some((g) => g.scope === 'group')
    ? new Set(
        (await prisma.propertyGroupMember.findMany({ where: { propertyId }, select: { groupId: true } })).map((m) => m.groupId),
      )
    : new Set<string>();
  let best: string | null = null;
  for (const g of grants) {
    const covers = g.scope === 'portfolio' || (g.scope === 'group' && groups.has(g.ref)) || (g.scope === 'property' && g.ref === propertyId);
    if (covers && (best === null || rankIn('inspire', g.role) > rankIn('inspire', best))) best = g.role;
  }
  return best;
}

/** Every code this property has flown — property grants hold codes, and a rebrand changes it. */
async function codesFor(propertyId: string): Promise<string[]> {
  const rows = await prisma.innCode.findMany({ where: { propertyId }, select: { code: true } });
  return rows.map((r) => r.code);
}

/** The person's live property-scope grants at this hotel that came from (or map to) Inspire roles. */
async function liveHotelGrants(personId: string, propertyId: string) {
  const codes = await codesFor(propertyId);
  const keys = new Set(Object.values(FROM_CONSUMER.inspire).map((m) => m.roleKey));
  const grants = await prisma.grant.findMany({
    where: { personId, effectiveTo: null, scope: 'property', scopeRef: { in: codes } },
  });
  return grants.filter((g) => keys.has(g.roleKey));
}

class Refusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authorize(
  req: ProvisionGrant | ProvisionRemove,
): Promise<{ actor: { id: string; email: string }; property: { id: string; code: string }; actorRole: string }> {
  if (req.subscriber !== 'inspire') throw new Refusal(403, 'Only Inspire provisions property staff.');
  const actor = await prisma.person.findUnique({ where: { id: req.actorPersonId } });
  if (!actor || actor.status !== 'active') throw new Refusal(403, 'Your account is not active in the MHG registry.');
  const property = await prisma.property.findUnique({ where: { id: req.propertyId }, select: { id: true, code: true } });
  if (!property) throw new Refusal(404, 'That hotel is not in the MHG registry.');
  const actorRole = await inspireRoleAt(actor.id, property.id);
  if (!actorRole || !(actorRole === 'corporate_admin' || MANAGERS.has(actorRole))) {
    throw new Refusal(403, 'Only a property admin or GM at this hotel can change its users.');
  }
  if (actor.email === req.email.trim().toLowerCase()) throw new Refusal(403, 'You can’t change your own access.');
  return { actor: { id: actor.id, email: actor.email }, property, actorRole };
}

async function refuseCorporate(personId: string): Promise<void> {
  if (await hasConsoleAccess(personId)) {
    throw new Refusal(403, 'That is an MHG corporate account. Its access is changed in the MHG console.');
  }
}

async function grantFromInspire(req: ProvisionGrant): Promise<ProvisionAck> {
  const { actor, property, actorRole } = await authorize(req);
  const roleKey = consoleRoleFor('inspire', req.role, 'property');
  if (!roleKey) throw new Refusal(400, `Inspire role "${req.role}" can't be granted from a hotel.`);
  if (actorRole !== 'corporate_admin' && rankIn('inspire', req.role) > rankIn('inspire', actorRole)) {
    throw new Refusal(403, `A ${actorRole.replace(/_/g, ' ')} can’t grant ${req.role.replace(/_/g, ' ')}.`);
  }

  const email = req.email.trim().toLowerCase();
  let person = await prisma.person.findUnique({ where: { email } });
  if (!person) {
    if (!req.passwordHash) throw new Refusal(400, 'A new user needs an initial password.');
    person = await prisma.person.create({
      data: { email, name: req.name.trim() || email, passwordHash: req.passwordHash, status: 'active' },
    });
    await prisma.auditEvent.create({
      data: { actorId: actor.id, action: 'person.create', subject: person.id, detail: { via: 'inspire', property: property.code } },
    });
  } else {
    await refuseCorporate(person.id);
    if (person.status === 'suspended') throw new Refusal(409, `${email} is suspended by MHG corporate.`);
    if (person.status === 'offboarded') {
      // Re-hire: the same person, a new grant (§2.1). A new initial password
      // when one was given; otherwise the old one stands.
      person = await prisma.person.update({
        where: { id: person.id },
        data: { status: 'active', ...(req.passwordHash ? { passwordHash: req.passwordHash } : {}) },
      });
    }
  }

  const reason = `Set in Inspire at ${property.code} by ${actor.email}`;
  const held = await liveHotelGrants(person.id, property.id);
  if (held.some((g) => g.roleKey === roleKey)) return { ok: true, personId: person.id };

  if (held[0]) {
    await changeGrant(held[0].id, { roleKey, scope: 'property', scopeRef: property.code, grantedById: actor.id, reason });
    for (const extra of held.slice(1)) await revokeGrant(extra.id, actor.id, reason);
  } else {
    await grantAccess({ personId: person.id, roleKey, scope: 'property', scopeRef: property.code, grantedById: actor.id, reason });
  }
  return { ok: true, personId: person.id };
}

async function removeFromInspire(req: ProvisionRemove): Promise<ProvisionAck> {
  const { actor, property } = await authorize(req);
  const person = await prisma.person.findUnique({ where: { email: req.email.trim().toLowerCase() } });
  if (!person) throw new Refusal(404, 'No such person in the MHG registry.');
  await refuseCorporate(person.id);
  const held = await liveHotelGrants(person.id, property.id);
  if (!held.length) {
    throw new Refusal(409, 'Their access here was granted above this hotel. Change it in the MHG console.');
  }
  for (const g of held) await revokeGrant(g.id, actor.id, `Removed in Inspire at ${property.code} by ${actor.email}`);
  return { ok: true, personId: person.id };
}

async function importPeople(consumer: Consumer, people: ImportedPerson[]): Promise<ProvisionAck> {
  const properties = await prisma.property.findMany({ select: { id: true, code: true } });
  const codeById = new Map(properties.map((p) => [p.id, p.code]));
  const results: NonNullable<ProvisionAck['results']> = [];
  const touched: string[] = [];

  for (const local of people) {
    const email = local.email.trim().toLowerCase();
    try {
      const { grants, skipped } = mapImported(consumer, local.roles, (id) => codeById.get(id));
      if (!grants.length) {
        results.push({ email, outcome: 'skipped', detail: skipped.length ? `nothing importable: ${skipped.join(', ')}` : 'no roles' });
        continue;
      }

      let person = await prisma.person.findUnique({ where: { email } });
      let outcome: 'created' | 'updated' | 'unchanged' = 'unchanged';
      if (!person) {
        person = await prisma.person.create({
          data: {
            email,
            name: local.name.trim() || email,
            passwordHash: isBcryptHash(local.passwordHash) ? local.passwordHash : null,
            status: local.active ? 'active' : 'suspended',
          },
        });
        await prisma.auditEvent.create({
          data: { actorId: null, action: 'person.import', subject: person.id, detail: { from: consumer } },
        });
        outcome = 'created';
      } else if (await hasConsoleAccess(person.id)) {
        results.push({ email, outcome: 'skipped', detail: 'already an MHG corporate account' });
        continue;
      }

      const live = await prisma.grant.findMany({ where: { personId: person.id, effectiveTo: null } });
      for (const g of grants) {
        if (live.some((l) => l.roleKey === g.roleKey && l.scope === g.scope && (l.scopeRef ?? null) === g.scopeRef)) continue;
        await grantAccess({
          personId: person.id,
          roleKey: g.roleKey,
          scope: g.scope,
          scopeRef: g.scopeRef,
          grantedById: null,
          reason: `Imported from ${consumer === 'inspire' ? 'Inspire' : 'InspiredREV'}`,
          publish: false,
        });
        if (outcome === 'unchanged') outcome = 'updated';
      }
      touched.push(person.id);
      results.push({ email, outcome, ...(skipped.length ? { detail: `skipped ${skipped.join(', ')}` } : {}) });
    } catch (err) {
      results.push({ email, outcome: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  if (touched.length) await publishPeople(touched, 'grant');
  return { ok: results.every((r) => r.outcome !== 'failed'), results };
}

export async function applyProvision(raw: string, signature: string | null): Promise<[number, ProvisionAck]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [400, { ok: false, error: 'Body is not JSON.' }];
  }
  const problem = provisionProblem(parsed);
  if (problem) return [400, { ok: false, error: `Not a provisioning request: ${problem}` }];
  const req = parsed as ProvisionRequest;

  const sub = await prisma.shellSubscriber.findUnique({ where: { name: req.subscriber } });
  if (!sub || !sub.active) return [401, { ok: false, error: 'Unknown subscriber.' }];
  const verified = verifyBody(sub.secret, raw, signature);
  if (!verified.ok) return [401, { ok: false, error: verified.reason }];
  if (sub.name !== 'inspire' && sub.name !== 'inspiredrev') return [403, { ok: false, error: 'Not a people consumer.' }];

  try {
    if (req.op === 'grant') return [200, await grantFromInspire(req)];
    if (req.op === 'remove') return [200, await removeFromInspire(req)];
    return [200, await importPeople(sub.name, req.people)];
  } catch (err) {
    if (err instanceof Refusal) return [err.status, { ok: false, error: err.message }];
    return [500, { ok: false, error: err instanceof Error ? err.message : String(err) }];
  }
}
