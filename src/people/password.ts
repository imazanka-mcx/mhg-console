import { prisma } from '../db.ts';
import {
  PEOPLE_CONTRACT,
  passwordChangeProblem,
  verifyBody,
  type PasswordChange,
  type PasswordChangeAck,
} from '../shell/contract.ts';
import { publishPeople, translatedAccess } from './publish.ts';

/**
 * A password change made inside Inspire or InspiredREV (docs/01 §2.8).
 *
 * Property staff never use the console, so the change happens in the app they
 * work in. That app checks the current password against the hash it holds,
 * hashes the new one, and sends the HASH here, signed with its subscription
 * secret. The console is the one place a person's password lives; it records
 * the change and streams it to every consumer, so the same password works
 * everywhere on the next delivery.
 *
 * This is the one path where a consumer needs the console up — to change a
 * password, never to sign in. A consumer may only change the password of
 * someone it actually gives access to.
 *
 * Returns [status, body]. No `next/*` here, so it is testable and CLI-safe.
 */
export async function applyPasswordChange(
  raw: string,
  signature: string | null,
): Promise<[number, PasswordChangeAck]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [400, { ok: false, error: 'Body is not JSON.' }];
  }
  const problem = passwordChangeProblem(parsed);
  if (problem) return [400, { ok: false, error: `Not a password change: ${problem}` }];
  const change = parsed as PasswordChange;

  const sub = await prisma.shellSubscriber.findUnique({ where: { name: change.subscriber } });
  if (!sub || !sub.active) return [401, { ok: false, error: 'Unknown subscriber.' }];
  const verified = verifyBody(sub.secret, raw, signature);
  if (!verified.ok) return [401, { ok: false, error: verified.reason }];

  const person = await prisma.person.findUnique({ where: { id: change.personId } });
  if (!person || person.status !== 'active') {
    return [404, { ok: false, error: 'No active person with that id.' }];
  }

  const access = await translatedAccess(person.id);
  const reaches = sub.name === 'inspire' || sub.name === 'inspiredrev' ? access[sub.name].length > 0 : false;
  if (!reaches) {
    return [403, { ok: false, error: `${person.email} has no access in ${sub.name}, so ${sub.name} cannot change their password.` }];
  }

  await prisma.person.update({ where: { id: person.id }, data: { passwordHash: change.passwordHash } });
  await prisma.auditEvent.create({
    data: {
      actorId: person.id,
      action: 'auth.password_changed',
      subject: person.id,
      detail: { via: sub.name, contract: PEOPLE_CONTRACT },
    },
  });
  await publishPeople([person.id], 'password');

  const after = await prisma.person.findUnique({ where: { id: person.id }, select: { personVersion: true } });
  return [200, { ok: true, ...(after ? { personVersion: after.personVersion } : {}) }];
}
