'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermission } from '../../../../auth/actor.ts';
import { changeStatus, updateSetup } from '../../../../issuance.ts';
import { deliverAll } from '../../../../shell/publish.ts';

/**
 * Property page actions: the lifecycle, the shell fields, and a manual push.
 * Each one ends on the shell stream, because each one changes what a consumer
 * holds (docs/01 §1.4).
 */

export type PropertyActionState = { error?: string; ok?: string };

const Move = z.object({
  propertyId: z.string().min(1),
  code: z.string().min(1),
  to: z.enum(['pipeline', 'active', 'retired']),
  reason: z.string().trim().min(3, 'Say why — it goes in the audit trail.').max(240),
  confirmCode: z.string().trim().optional(),
});

export async function moveStatusAction(
  _prev: PropertyActionState,
  form: FormData,
): Promise<PropertyActionState> {
  let actor;
  try {
    actor = await requirePermission('property.status');
  } catch {
    return { error: 'You are not permitted to move codes through their lifecycle.' };
  }
  const parsed = Move.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const { propertyId, code, to, reason, confirmCode } = parsed.data;

  // Retiring is permanent (G3), so it takes the same friction as a destructive
  // action anywhere else: type the code.
  if (to === 'retired' && confirmCode?.toUpperCase() !== code) {
    return { error: `Type ${code} to confirm. A retired code is never reissued.` };
  }

  try {
    const moved = await changeStatus(code, to, actor.id, reason);
    revalidatePath(`/portfolio/${propertyId}`);
    revalidatePath('/portfolio');
    return { ok: `${code}: ${moved.from} → ${moved.to}. Published to the shell stream.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const Setup = z.object({
  propertyId: z.string().min(1),
  timezone: z.string(),
  currency: z.string(),
  expectedOpenDate: z.string(),
});

export async function updateSetupAction(
  _prev: PropertyActionState,
  form: FormData,
): Promise<PropertyActionState> {
  let actor;
  try {
    actor = await requirePermission('property.issue');
  } catch {
    return { error: 'You are not permitted to edit properties.' };
  }
  const parsed = Setup.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'Check the form.' };
  const { propertyId, ...setup } = parsed.data;
  try {
    await updateSetup(propertyId, setup, actor.id);
    revalidatePath(`/portfolio/${propertyId}`);
    return { ok: 'Saved and published.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deliverNowAction(
  _prev: PropertyActionState,
  form: FormData,
): Promise<PropertyActionState> {
  try {
    await requirePermission('property.status');
  } catch {
    return { error: 'You are not permitted to push the shell stream.' };
  }
  const propertyId = String(form.get('propertyId') ?? '');
  const results = await deliverAll();
  revalidatePath(`/portfolio/${propertyId}`);
  if (!results.length) return { error: 'No subscribers are registered yet — `npm run shell -- subscribe`.' };
  const failed = results.filter((r) => !r.ok);
  return failed.length
    ? { error: failed.map((r) => `${r.subscriber}: ${r.error ?? 'failed'}`).join(' · ') }
    : { ok: `Delivered. ${results.map((r) => `${r.subscriber} at ${r.cursor}`).join(', ')}.` };
}
