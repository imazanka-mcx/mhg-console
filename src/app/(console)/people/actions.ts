'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '../../../db.ts';
import { grantAccess, requirePermission, revokeGrant } from '../../../auth/access.ts';
import { generateTempPassword, hashPassword } from '../../../auth/password.ts';
import { ROLES } from '../../../auth/catalog.ts';
import { ScopeViolation, SCOPES } from '../../../auth/scope.ts';

/**
 * Provisioning (docs/01 §2.5).
 *
 * Inviting someone and granting them access are one action here, because a
 * person with no grant can do nothing and would only sit in the list looking
 * like a mistake. Everything is attributed: who granted it, when, and why.
 */

export type ProvisionState = { error?: string; ok?: string; tempPassword?: string };

const Invite = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
  name: z.string().trim().min(1, 'A name is required — grants are attributed to a person.').max(120),
  roleKey: z.enum(ROLES.map((r) => r.key) as [string, ...string[]]),
  scope: z.enum(SCOPES as unknown as [string, ...string[]]),
  scopeRef: z.string().trim().max(64).optional(),
  reason: z.string().trim().min(1, 'Say why — this is the audit trail.').max(280),
});

export async function inviteAction(
  _prev: ProvisionState,
  form: FormData,
): Promise<ProvisionState> {
  let actor;
  try {
    actor = await requirePermission('people.manage');
  } catch {
    return { error: 'You are not permitted to grant access.' };
  }

  const parsed = Invite.safeParse({
    email: form.get('email') ?? '',
    name: form.get('name') ?? '',
    roleKey: form.get('roleKey') ?? '',
    scope: form.get('scope') ?? 'portfolio',
    scopeRef: form.get('scopeRef') || undefined,
    reason: form.get('reason') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }
  const input = parsed.data;

  try {
    let person = await prisma.person.findUnique({ where: { email: input.email } });
    let tempPassword: string | undefined;

    if (!person) {
      tempPassword = generateTempPassword();
      person = await prisma.person.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(tempPassword),
          status: 'active',
        },
      });
    } else if (person.status === 'offboarded') {
      // Re-hiring is a new grant on the SAME person, never a second row — that
      // is the point of one identity for life (§2.1). They keep their id and
      // their history; only the grant is new.
      tempPassword = generateTempPassword();
      person = await prisma.person.update({
        where: { id: person.id },
        data: { passwordHash: await hashPassword(tempPassword), status: 'active' },
      });
    }

    await grantAccess({
      personId: person.id,
      roleKey: input.roleKey,
      scope: input.scope as 'portfolio' | 'group' | 'property',
      scopeRef: input.scopeRef ?? null,
      grantedById: actor.id,
      reason: input.reason,
    });

    revalidatePath('/people');
    return tempPassword
      ? { ok: `${input.name} can now sign in as ${input.roleKey}.`, tempPassword }
      : { ok: `${input.name} has another grant: ${input.roleKey} at ${input.scope}.` };
  } catch (err) {
    if (err instanceof ScopeViolation) {
      return {
        error: `${err.message} — above-property has no oversight of direct billables (docs/29 §3).`,
      };
    }
    return { error: err instanceof Error ? err.message : 'Could not grant access.' };
  }
}

export async function revokeAction(_prev: ProvisionState, form: FormData): Promise<ProvisionState> {
  let actor;
  try {
    actor = await requirePermission('people.manage');
  } catch {
    return { error: 'You are not permitted to change access.' };
  }

  const grantId = String(form.get('grantId') ?? '');
  if (!grantId) return { error: 'No grant given.' };

  try {
    await revokeGrant(grantId, actor.id, String(form.get('reason') ?? 'Revoked from People.'));
    revalidatePath('/people');
    return { ok: 'Access closed. The grant stays on the record.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not close that grant.' };
  }
}
