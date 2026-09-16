'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermission } from '../../../auth/actor.ts';
import {
  GROUP_KINDS,
  addMember,
  createGroup,
  materializeGroup,
  previewRule,
  removeMember,
  setGroupArchived,
  updateGroup,
  type GroupKind,
} from '../../../groups/groups.ts';
import { RULE_FIELDS, RuleError } from '../../../groups/rules.ts';

/**
 * Group actions (docs/01 §2.2).
 *
 * Creating a rule group is two acts, like issuing a code: Preview reads the
 * portfolio and shows exactly which hotels the rule selects, Create writes it.
 * A group decides who a grant reaches, so "what does this do" should never
 * have to be answered by doing it.
 */

export type GroupState = {
  error?: string;
  ok?: string;
  preview?: { description: string; considered: number; matched: { code: string; name: string; status: string }[] };
};

const MAX = 64;

/** `field` textboxes arrive as comma-separated lists; empty ones drop out. */
function ruleFromForm(form: FormData): Record<string, string[]> | undefined {
  const raw: Record<string, string[]> = {};
  for (const field of RULE_FIELDS) {
    const value = String(form.get(`rule_${field}`) ?? '').trim();
    if (!value) continue;
    raw[field] = value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return Object.keys(raw).length ? raw : undefined;
}

const NewGroup = z.object({
  kind: z.enum(GROUP_KINDS as unknown as [string, ...string[]]),
  name: z.string().trim().min(1, 'A group needs a name.').max(80),
  description: z.string().trim().max(240).optional(),
  mode: z.enum(['manual', 'rule']),
});

export async function createGroupAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }

  const parsed = NewGroup.safeParse({
    kind: form.get('kind') ?? 'ad_hoc',
    name: form.get('name') ?? '',
    description: form.get('description') ?? '',
    mode: form.get('mode') ?? 'manual',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  const rule = parsed.data.mode === 'rule' ? ruleFromForm(form) : undefined;
  const intent = String(form.get('intent') ?? 'create');

  try {
    if (parsed.data.mode === 'rule' && !rule) {
      return { error: 'A rule group needs at least one condition. Otherwise it is the whole portfolio.' };
    }

    if (intent === 'preview') {
      if (!rule) return { error: 'Nothing to preview — a manual group starts empty and you add to it.' };
      const p = await previewRule(rule);
      return {
        preview: {
          description: p.description,
          considered: p.considered,
          matched: p.matched.map((m) => ({ code: m.code, name: m.name, status: m.status })),
        },
      };
    }

    const group = await createGroup({
      kind: parsed.data.kind as GroupKind,
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      rule,
      actorId: actor.id,
    });
    revalidatePath('/groups');
    return { ok: `${group.name} created as ${group.id}.` };
  } catch (err) {
    if (err instanceof RuleError) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Could not create that group.' };
  }
}

export async function updateGroupAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }
  const id = String(form.get('groupId') ?? '');
  try {
    await updateGroup(
      id,
      {
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').slice(0, 240),
      },
      actor.id,
    );
    revalidatePath(`/groups/${id}`);
    revalidatePath('/groups');
    return { ok: 'Saved. The group id is unchanged — grants point at it.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save.' };
  }
}

export async function addMemberAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }
  const id = String(form.get('groupId') ?? '');
  const ref = String(form.get('property') ?? '').trim().slice(0, MAX);
  if (!ref) return { error: 'Give an inn code.' };
  try {
    await addMember(id, ref, actor.id);
    revalidatePath(`/groups/${id}`);
    return { ok: `${ref.toUpperCase()} added. Everyone holding a grant on this group now reaches it.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add that property.' };
  }
}

export async function removeMemberAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }
  const id = String(form.get('groupId') ?? '');
  const propertyId = String(form.get('propertyId') ?? '');
  try {
    await removeMember(id, propertyId, actor.id);
    revalidatePath(`/groups/${id}`);
    return { ok: 'Removed. Grants on this group no longer reach it.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove that property.' };
  }
}

export async function syncGroupAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }
  const id = String(form.get('groupId') ?? '');
  try {
    const r = await materializeGroup(id, actor.id);
    revalidatePath(`/groups/${id}`);
    return { ok: `Synced: ${r.added.length} added, ${r.removed.length} removed, ${r.total} members.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not sync.' };
  }
}

export async function archiveGroupAction(_prev: GroupState, form: FormData): Promise<GroupState> {
  let actor;
  try {
    actor = await requirePermission('group.manage');
  } catch {
    return { error: 'You are not permitted to manage groups.' };
  }
  const id = String(form.get('groupId') ?? '');
  const archived = String(form.get('archived') ?? '') === 'true';
  try {
    await setGroupArchived(id, archived, actor.id);
    revalidatePath(`/groups/${id}`);
    revalidatePath('/groups');
    return {
      ok: archived
        ? 'Archived. It still resolves — close the grants on it to actually remove access.'
        : 'Restored.',
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change that.' };
  }
}
