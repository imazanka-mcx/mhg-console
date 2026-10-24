'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '../../../auth/actor.ts';
import {
  addPrincipal,
  createOrganization,
  removePrincipal,
  setOrganizationArchived,
  updateOrganization,
} from '../../../orgs/orgs.ts';

/**
 * Organization actions (docs/01 §1.7). Console-only and audited; nothing here
 * touches the shell stream.
 */

export type OrgState = { error?: string; ok?: string };

const DENIED: OrgState = { error: 'You are not permitted to maintain organizations.' };

async function actorId(): Promise<string | null> {
  try {
    return (await requirePermission('org.manage')).id;
  } catch {
    return null;
  }
}

const str = (form: FormData, k: string) => String(form.get(k) ?? '');

function details(form: FormData) {
  return {
    kind: str(form, 'kind'),
    name: str(form, 'name'),
    legalName: str(form, 'legalName'),
    registeredState: str(form, 'registeredState'),
    registrationNumber: str(form, 'registrationNumber'),
    contactName: str(form, 'contactName'),
    contactEmail: str(form, 'contactEmail'),
    contactPhone: str(form, 'contactPhone'),
  };
}

function failed(err: unknown): OrgState {
  return { error: err instanceof Error ? err.message : String(err) };
}

export async function createOrgAction(_prev: OrgState, form: FormData): Promise<OrgState> {
  const id = await actorId();
  if (!id) return DENIED;
  try {
    const org = await createOrganization(details(form), id);
    revalidatePath('/organizations');
    return { ok: `${org.name} added as ${org.id}.` };
  } catch (err) {
    return failed(err);
  }
}

export async function updateOrgAction(_prev: OrgState, form: FormData): Promise<OrgState> {
  const id = await actorId();
  if (!id) return DENIED;
  const orgId = str(form, 'orgId');
  try {
    await updateOrganization(orgId, details(form), id);
    revalidatePath(`/organizations/${orgId}`);
    revalidatePath('/organizations');
    return { ok: 'Saved.' };
  } catch (err) {
    return failed(err);
  }
}

export async function archiveOrgAction(_prev: OrgState, form: FormData): Promise<OrgState> {
  const id = await actorId();
  if (!id) return DENIED;
  const orgId = str(form, 'orgId');
  const archived = str(form, 'archived') === 'true';
  try {
    await setOrganizationArchived(orgId, archived, id);
    revalidatePath(`/organizations/${orgId}`);
    revalidatePath('/organizations');
    return { ok: archived ? 'Archived.' : 'Restored.' };
  } catch (err) {
    return failed(err);
  }
}

export async function addPrincipalAction(_prev: OrgState, form: FormData): Promise<OrgState> {
  const id = await actorId();
  if (!id) return DENIED;
  const orgId = str(form, 'orgId');
  try {
    await addPrincipal(orgId, { name: str(form, 'name'), email: str(form, 'email'), title: str(form, 'title') }, id);
    revalidatePath(`/organizations/${orgId}`);
    return { ok: 'Principal added.' };
  } catch (err) {
    return failed(err);
  }
}

export async function removePrincipalAction(_prev: OrgState, form: FormData): Promise<OrgState> {
  const id = await actorId();
  if (!id) return DENIED;
  const orgId = str(form, 'orgId');
  try {
    await removePrincipal(str(form, 'principalId'), id);
    revalidatePath(`/organizations/${orgId}`);
    return { ok: 'Removed.' };
  } catch (err) {
    return failed(err);
  }
}
