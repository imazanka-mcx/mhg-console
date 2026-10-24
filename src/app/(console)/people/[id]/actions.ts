'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermission } from '../../../../auth/actor.ts';
import { ROLES } from '../../../../auth/catalog.ts';
import { CONSUMERS, DownstreamChoiceError, type Consumer } from '../../../../auth/consumer-roles.ts';
import { ScopeViolation, SCOPES } from '../../../../auth/scope.ts';
import { changeGrant, resetPassword, setStatus, updateProfile, type StatusChange } from '../../../../people/manage.ts';

/** Editing one person (docs/01 §2.5). Every action needs people.manage. */

export type PersonState = { error?: string; ok?: string; tempPassword?: string };

async function manager() {
  try {
    return await requirePermission('people.manage');
  } catch {
    return null;
  }
}

function message(err: unknown): string {
  if (err instanceof ScopeViolation) {
    return `${err.message} — above-property has no oversight of direct billables (docs/29 §3).`;
  }
  if (err instanceof DownstreamChoiceError) return err.message;
  return err instanceof Error ? err.message : 'That did not work.';
}

const Change = z.object({
  grantId: z.string().min(1),
  roleKey: z.enum(ROLES.map((r) => r.key) as [string, ...string[]]),
  scope: z.enum(SCOPES as unknown as [string, ...string[]]),
  scopeRef: z.string().trim().max(64).optional(),
  reason: z.string().trim().min(1, 'Say why — this is the audit trail.').max(280),
});

export async function changeGrantAction(_prev: PersonState, form: FormData): Promise<PersonState> {
  const actor = await manager();
  if (!actor) return { error: 'You are not permitted to change access.' };

  const parsed = Change.safeParse({
    grantId: form.get('grantId') ?? '',
    roleKey: form.get('roleKey') ?? '',
    scope: form.get('scope') ?? 'portfolio',
    scopeRef: form.get('scopeRef') || undefined,
    reason: form.get('reason') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const input = parsed.data;

  const downstream: Partial<Record<Consumer, string>> = {};
  for (const consumer of CONSUMERS) {
    const v = String(form.get(`downstream_${consumer}`) ?? '').trim();
    if (v) downstream[consumer] = v;
  }

  try {
    await changeGrant(input.grantId, {
      roleKey: input.roleKey,
      scope: input.scope as 'portfolio' | 'group' | 'property',
      scopeRef: input.scopeRef ?? null,
      grantedById: actor.id,
      reason: input.reason,
      downstream,
    });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath('/people');
  revalidatePath(`/people/${String(form.get('personId') ?? '')}`);
  return { ok: 'Access changed. Inspire and InspiredREV pick it up at the person’s next sign-in.' };
}

const Profile = z.object({
  personId: z.string().min(1),
  name: z.string().trim().min(1, 'A name is required.').max(120),
  email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
});

export async function updateProfileAction(_prev: PersonState, form: FormData): Promise<PersonState> {
  const actor = await manager();
  if (!actor) return { error: 'You are not permitted to edit people.' };
  const parsed = Profile.safeParse({
    personId: form.get('personId') ?? '',
    name: form.get('name') ?? '',
    email: form.get('email') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  try {
    await updateProfile(parsed.data.personId, parsed.data, actor.id);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath('/people');
  revalidatePath(`/people/${parsed.data.personId}`);
  return { ok: 'Saved. The email is their sign-in name in all three apps.' };
}

export async function setStatusAction(_prev: PersonState, form: FormData): Promise<PersonState> {
  const actor = await manager();
  if (!actor) return { error: 'You are not permitted to change a person’s status.' };
  const personId = String(form.get('personId') ?? '');
  const change = String(form.get('change') ?? '') as StatusChange;
  if (!['suspend', 'reactivate', 'offboard'].includes(change)) return { error: 'Unknown change.' };
  try {
    await setStatus(personId, change, actor.id, String(form.get('reason') ?? ''));
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath('/people');
  revalidatePath(`/people/${personId}`);
  return {
    ok:
      change === 'suspend'
        ? 'Suspended. Grants are kept; sign-in is refused everywhere from their next attempt.'
        : change === 'reactivate'
          ? 'Reactivated with the grants they had.'
          : 'Offboarded. Every grant is closed and the record is kept.',
  };
}

export async function resetPasswordAction(_prev: PersonState, form: FormData): Promise<PersonState> {
  const actor = await manager();
  if (!actor) return { error: 'You are not permitted to reset passwords.' };
  const personId = String(form.get('personId') ?? '');
  try {
    const tempPassword = await resetPassword(personId, actor.id);
    revalidatePath(`/people/${personId}`);
    return { ok: 'Password reset in all three apps.', tempPassword };
  } catch (err) {
    return { error: message(err) };
  }
}
