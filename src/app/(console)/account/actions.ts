'use server';

import { prisma } from '../../../db.ts';
import { currentActor } from '../../../auth/actor.ts';
import { checkPassword, hashPassword, verifyPassword } from '../../../auth/password.ts';

export type AccountState = { error?: string; ok?: string };

export async function changePasswordAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const actor = await currentActor();
  if (!actor) return { error: 'Not signed in.' };

  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');

  const person = await prisma.person.findUnique({ where: { id: actor.id } });
  if (!person?.passwordHash) return { error: 'This account has no password set.' };
  if (!(await verifyPassword(current, person.passwordHash))) {
    return { error: 'That is not your current password.' };
  }

  const check = checkPassword(next);
  if (!check.ok) return { error: check.message };
  if (next === current) return { error: 'That is the password you already have.' };

  await prisma.person.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(next) },
  });
  await prisma.auditEvent.create({
    data: { actorId: actor.id, action: 'auth.password_changed', subject: actor.id, detail: {} },
  });

  return { ok: 'Password changed.' };
}
