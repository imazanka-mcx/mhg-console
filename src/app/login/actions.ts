'use server';

import { redirect } from 'next/navigation';

import { prisma } from '../../db.ts';
import { createSession, destroySession } from '../../auth/session.ts';
import { verifyPassword } from '../../auth/password.ts';

export type LoginState = { error?: string };

export async function signInAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are both required.' };

  const person = await prisma.person.findUnique({ where: { email } });

  // One message for every failure — unknown address, wrong password, suspended
  // account. Distinguishing them turns this form into a directory of who works
  // here, which is not something a sign-in page should hand out.
  const refuse: LoginState = { error: 'That email and password do not match an active account.' };

  if (!person?.passwordHash) return refuse;
  if (person.status !== 'active') return refuse;
  if (!(await verifyPassword(password, person.passwordHash))) {
    await prisma.auditEvent.create({
      data: { actorId: person.id, action: 'auth.failed', subject: person.id, detail: {} },
    });
    return refuse;
  }

  await createSession({ personId: person.id, email: person.email });
  await prisma.auditEvent.create({
    data: { actorId: person.id, action: 'auth.signin', subject: person.id, detail: {} },
  });
  redirect('/portfolio');
}

export async function signOutAction(): Promise<void> {
  destroySession();
  redirect('/login');
}
