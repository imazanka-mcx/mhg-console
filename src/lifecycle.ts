import type { PropertyStatus } from '@mcx/inn-code';

/**
 * The inn code lifecycle as a rule rather than a convention (docs/01 §1.4).
 *
 *   pipeline ──open──▶ active ──exit──▶ retired
 *       └──────────deal dies──────────────▲
 *
 * Forward only. `retired` is terminal because a retired code stays claimed
 * forever and is never reissued (G3): bringing one back to life would make a
 * code mean two different tenancies of a building. A property that comes back
 * under MHG gets a new code; a flag change is `rebrand`, which issues first and
 * retires second so the property is never without a code.
 *
 * Pure, so every edge is a unit test rather than a fixture.
 */

export type Transition = 'open' | 'abandon' | 'exit';

const EDGES: Record<PropertyStatus, Partial<Record<PropertyStatus, Transition>>> = {
  pipeline: { active: 'open', retired: 'abandon' },
  active: { retired: 'exit' },
  retired: {},
};

export const TRANSITION_LABELS: Record<Transition, string> = {
  open: 'Open — the hotel is trading',
  abandon: 'Abandon — the deal did not close',
  exit: 'Exit — sold, deflagged or closed',
};

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; reason: string };

export function checkTransition(from: PropertyStatus, to: PropertyStatus): TransitionCheck {
  if (from === to) return { ok: false, reason: `Already ${to}.` };
  const transition = EDGES[from][to];
  if (transition) return { ok: true, transition };
  if (from === 'retired') {
    return {
      ok: false,
      reason:
        'A retired code is terminal — it stays claimed and is never reissued (G3). A returning hotel gets a new code.',
    };
  }
  return { ok: false, reason: `${from} → ${to} goes backwards. The lifecycle only moves forward.` };
}

/** The moves available from a status, for building buttons. */
export function nextStatuses(from: PropertyStatus): { to: PropertyStatus; transition: Transition }[] {
  return Object.entries(EDGES[from]).map(([to, transition]) => ({
    to: to as PropertyStatus,
    transition: transition as Transition,
  }));
}
