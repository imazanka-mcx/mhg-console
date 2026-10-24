import { prisma } from '../db.ts';
import { grantAccess, revokeGrant, type GrantInput } from '../auth/access.ts';
import { generateTempPassword, hashPassword } from '../auth/password.ts';
import { publishPeople } from './publish.ts';

/**
 * Changing a person after they exist (docs/01 §2.5 lifecycle verbs).
 *
 * Every change here reaches Inspire and InspiredREV on the people stream
 * (§2.8): a new role, a suspension, a reset password. Nothing is deleted — a
 * changed grant is the old one closed and a new one opened, so "who had what on
 * 3 March" stays a query.
 *
 * No `next/*` here; the actions call these.
 */

/** The live portfolio grants that can manage people, other than this person's. */
async function otherPeopleManagers(personId: string): Promise<number> {
  return prisma.grant.count({
    where: {
      personId: { not: personId },
      effectiveTo: null,
      scope: 'portfolio',
      person: { status: 'active' },
      role: { permissions: { some: { permissionKey: 'people.manage' } } },
    },
  });
}

async function managesPeople(personId: string): Promise<boolean> {
  const n = await prisma.grant.count({
    where: {
      personId,
      effectiveTo: null,
      scope: 'portfolio',
      role: { permissions: { some: { permissionKey: 'people.manage' } } },
    },
  });
  return n > 0;
}

/** Refuse anything that would leave nobody able to grant access. */
async function refuseLockout(personId: string): Promise<void> {
  if ((await managesPeople(personId)) && (await otherPeopleManagers(personId)) === 0) {
    throw new Error(
      'This is the last account that can grant access. Give someone else that authority first, or the registry locks itself out.',
    );
  }
}

/**
 * Transfer: close one grant and open its replacement as one action (§2.5) —
 * a different role, a different scope, or a different choice of role in
 * Inspire or InspiredREV. The new grant is validated by grantAccess first; if
 * closing the old one is then refused, the new one is closed again, so the
 * person never ends up holding both.
 */
export async function changeGrant(
  grantId: string,
  next: Omit<GrantInput, 'personId'>,
): Promise<{ closed: string; opened: string }> {
  const old = await prisma.grant.findUnique({ where: { id: grantId } });
  if (!old) throw new Error('No such grant.');
  if (old.effectiveTo) throw new Error('That grant is already closed.');

  const opened = await grantAccess({ ...next, personId: old.personId });
  try {
    await revokeGrant(grantId, next.grantedById ?? old.personId, `Changed: ${next.reason}`);
  } catch (err) {
    await prisma.grant.update({ where: { id: opened.id }, data: { effectiveTo: new Date() } });
    await publishPeople([old.personId], 'grant');
    throw err;
  }
  return { closed: grantId, opened: opened.id };
}

export interface ProfileInput {
  name: string;
  email: string;
}

/** Correct a name or email. The email is the sign-in name in all three apps. */
export async function updateProfile(personId: string, input: ProfileInput, actorId: string): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name) throw new Error('A name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That does not look like an email address.');

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new Error('No such person.');
  if (person.email === email && person.name === name) return;

  if (person.email !== email) {
    const clash = await prisma.person.findUnique({ where: { email }, select: { id: true } });
    if (clash) throw new Error(`${email} already belongs to someone else.`);
  }

  await prisma.person.update({ where: { id: personId }, data: { name, email } });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: 'person.update',
      subject: personId,
      detail: { before: { name: person.name, email: person.email }, after: { name, email } },
    },
  });
  await publishPeople([personId], 'profile');
}

export type StatusChange = 'suspend' | 'reactivate' | 'offboard';

/**
 * Suspend freezes access with every grant intact; reactivate thaws it.
 * Offboard closes every grant and keeps the person for the record — coming
 * back later is a new grant on the same person, from Grant access.
 */
export async function setStatus(personId: string, change: StatusChange, actorId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Say why — this is the audit trail.');
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new Error('No such person.');
  if (personId === actorId && change !== 'reactivate') throw new Error('You cannot suspend or offboard yourself.');

  if (change === 'suspend') {
    if (person.status !== 'active') throw new Error(`Only an active person can be suspended (this one is ${person.status}).`);
    await refuseLockout(personId);
    await prisma.person.update({ where: { id: personId }, data: { status: 'suspended' } });
  } else if (change === 'reactivate') {
    if (person.status !== 'suspended') {
      throw new Error(
        person.status === 'offboarded'
          ? 'An offboarded person comes back with a new grant — use Grant access with their email.'
          : `Only a suspended person can be reactivated (this one is ${person.status}).`,
      );
    }
    await prisma.person.update({ where: { id: personId }, data: { status: 'active' } });
  } else {
    if (person.status === 'offboarded') throw new Error('Already offboarded.');
    await refuseLockout(personId);
    const now = new Date();
    await prisma.$transaction([
      prisma.grant.updateMany({ where: { personId, effectiveTo: null }, data: { effectiveTo: now } }),
      prisma.person.update({ where: { id: personId }, data: { status: 'offboarded' } }),
    ]);
  }

  await prisma.auditEvent.create({
    data: { actorId, action: `person.${change}`, subject: personId, detail: { from: person.status, reason } },
  });
  await publishPeople([personId], 'status');
}

/**
 * A new one-time password, shown once to whoever reset it — the same channel
 * provisioning uses (password.ts explains why there is no email link). It
 * replaces the old one in all three apps on the next delivery.
 */
export async function resetPassword(personId: string, actorId: string): Promise<string> {
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new Error('No such person.');
  if (person.status === 'offboarded') throw new Error('An offboarded person has no access to reset a password for.');

  const temp = generateTempPassword();
  await prisma.person.update({ where: { id: personId }, data: { passwordHash: await hashPassword(temp) } });
  await prisma.auditEvent.create({
    data: { actorId, action: 'auth.password_reset', subject: personId, detail: {} },
  });
  await publishPeople([personId], 'password');
  return temp;
}
