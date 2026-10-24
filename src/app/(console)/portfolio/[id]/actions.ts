'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermission } from '../../../../auth/actor.ts';
import { changeStatus, updateSetup } from '../../../../issuance.ts';
import {
  assignManagement,
  assignOwnership,
  endAssignment,
  updateAsset,
  updateManagementTerms,
  updateOwnershipTerms,
} from '../../../../orgs/orgs.ts';
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

// ─────────────────────────── ownership and control (§1.7) ─────────────────
// Console-only: these are audited but never published, because the shell
// does not carry ownership, management or the asset (yet).

const str = (form: FormData, k: string) => String(form.get(k) ?? '');

async function orgActorId(): Promise<string | null> {
  try {
    return (await requirePermission('org.manage')).id;
  } catch {
    return null;
  }
}

const ORG_DENIED: PropertyActionState = { error: 'You are not permitted to assign ownership or management.' };

function done(propertyId: string, ok: string): PropertyActionState {
  revalidatePath(`/portfolio/${propertyId}`);
  revalidatePath('/organizations');
  return { ok };
}

function failed(err: unknown): PropertyActionState {
  return { error: err instanceof Error ? err.message : String(err) };
}

export async function assignOwnershipAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  const actorId = await orgActorId();
  if (!actorId) return ORG_DENIED;
  const propertyId = str(form, 'propertyId');
  try {
    await assignOwnership(
      propertyId,
      {
        organizationId: str(form, 'organizationId'),
        effectiveFrom: str(form, 'effectiveFrom'),
        titleEntity: str(form, 'titleEntity'),
        titleEntityState: str(form, 'titleEntityState'),
        licenseEffectiveDate: str(form, 'licenseEffectiveDate'),
        licenseExpiryDate: str(form, 'licenseExpiryDate'),
        reason: str(form, 'reason'),
      },
      actorId,
    );
    return done(propertyId, 'Ownership assigned.');
  } catch (err) {
    return failed(err);
  }
}

export async function assignManagementAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  const actorId = await orgActorId();
  if (!actorId) return ORG_DENIED;
  const propertyId = str(form, 'propertyId');
  try {
    await assignManagement(
      propertyId,
      {
        organizationId: str(form, 'organizationId'),
        effectiveFrom: str(form, 'effectiveFrom'),
        agreementExpiryDate: str(form, 'agreementExpiryDate'),
        terminationNoticeDays: str(form, 'terminationNoticeDays'),
        reason: str(form, 'reason'),
      },
      actorId,
    );
    return done(propertyId, 'Management company assigned.');
  } catch (err) {
    return failed(err);
  }
}

export async function ownershipTermsAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  const actorId = await orgActorId();
  if (!actorId) return ORG_DENIED;
  const propertyId = str(form, 'propertyId');
  try {
    await updateOwnershipTerms(
      propertyId,
      {
        titleEntity: str(form, 'titleEntity'),
        titleEntityState: str(form, 'titleEntityState'),
        licenseEffectiveDate: str(form, 'licenseEffectiveDate'),
        licenseExpiryDate: str(form, 'licenseExpiryDate'),
      },
      actorId,
    );
    return done(propertyId, 'Saved.');
  } catch (err) {
    return failed(err);
  }
}

export async function managementTermsAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  const actorId = await orgActorId();
  if (!actorId) return ORG_DENIED;
  const propertyId = str(form, 'propertyId');
  try {
    await updateManagementTerms(
      propertyId,
      { agreementExpiryDate: str(form, 'agreementExpiryDate'), terminationNoticeDays: str(form, 'terminationNoticeDays') },
      actorId,
    );
    return done(propertyId, 'Saved.');
  } catch (err) {
    return failed(err);
  }
}

export async function endAssignmentAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  const actorId = await orgActorId();
  if (!actorId) return ORG_DENIED;
  const propertyId = str(form, 'propertyId');
  const which = str(form, 'which') === 'ownership' ? 'ownership' : 'management';
  try {
    await endAssignment(propertyId, which, str(form, 'effectiveTo'), str(form, 'reason'), actorId);
    return done(propertyId, `${which === 'ownership' ? 'Ownership' : 'Management'} ended.`);
  } catch (err) {
    return failed(err);
  }
}

const ASSET_FIELDS = [
  'streetAddress',
  'postalCode',
  'keyCount',
  'serviceLevel',
  'yearOpened',
  'yearRenovated',
  'pipStatus',
  'pipDueDate',
  'qaLastDate',
  'qaLastResult',
] as const;

export async function updateAssetAction(_prev: PropertyActionState, form: FormData): Promise<PropertyActionState> {
  let actor;
  try {
    actor = await requirePermission('property.issue');
  } catch {
    return { error: 'You are not permitted to edit properties.' };
  }
  const propertyId = str(form, 'propertyId');
  const input: Partial<Record<(typeof ASSET_FIELDS)[number], string>> = {};
  for (const k of ASSET_FIELDS) if (form.has(k)) input[k] = str(form, k);
  try {
    await updateAsset(propertyId, input, actor.id);
    revalidatePath(`/portfolio/${propertyId}`);
    return { ok: 'Saved.' };
  } catch (err) {
    return failed(err);
  }
}
