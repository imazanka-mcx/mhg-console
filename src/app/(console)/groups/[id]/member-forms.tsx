'use client';

import { useFormState, useFormStatus } from 'react-dom';

import {
  addMemberAction,
  archiveGroupAction,
  removeMemberAction,
  syncGroupAction,
  type GroupState,
} from '../actions.ts';

const INPUT =
  'rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function Pending({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? busy : idle}</>;
}

export function AddMemberForm({ groupId }: { groupId: string }) {
  const [state, action] = useFormState<GroupState, FormData>(addMemberAction, {});
  return (
    <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input
        name="property"
        required
        maxLength={64}
        placeholder="EVVBC"
        className={`${INPUT} w-40 font-mono`}
        aria-label="Inn code"
      />
      <button
        type="submit"
        className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        <Pending idle="Add property" busy="Adding…" />
      </button>
      {state.error ? <span className="text-sm text-danger-700">{state.error}</span> : null}
      {state.ok ? <span className="text-sm text-success-700">{state.ok}</span> : null}
    </form>
  );
}

export function RemoveMemberButton({ groupId, propertyId }: { groupId: string; propertyId: string }) {
  const [state, action] = useFormState<GroupState, FormData>(removeMemberAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <button
        type="submit"
        className="text-xs text-slate-400 underline-offset-2 hover:text-danger-600 hover:underline"
      >
        <Pending idle="Remove" busy="Removing…" />
      </button>
      {state.error ? <span className="ml-2 text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}

export function SyncButton({ groupId }: { groupId: string }) {
  const [state, action] = useFormState<GroupState, FormData>(syncGroupAction, {});
  return (
    <form action={action} className="mt-3 flex items-center gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <button
        type="submit"
        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <Pending idle="Re-apply the rule" busy="Syncing…" />
      </button>
      {state.error ? <span className="text-xs text-danger-700">{state.error}</span> : null}
      {state.ok ? <span className="text-xs text-success-700">{state.ok}</span> : null}
    </form>
  );
}

export function ArchiveButton({ groupId, archived }: { groupId: string; archived: boolean }) {
  const [state, action] = useFormState<GroupState, FormData>(archiveGroupAction, {});
  return (
    <form action={action} className="inline-flex items-center gap-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        className="text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        <Pending idle={archived ? 'Restore' : 'Archive'} busy="Working…" />
      </button>
      {state.error ? <span className="text-xs text-danger-700">{state.error}</span> : null}
      {state.ok ? <span className="text-xs text-success-700">{state.ok}</span> : null}
    </form>
  );
}
