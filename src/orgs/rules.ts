import { isIsoDate } from '../setup.ts';

/**
 * Ownership and control as rules (docs/01 §1.7).
 *
 * Pure — no Prisma, no request — for the same reason lifecycle.ts and
 * groups/rules.ts are: the management rule is the reason this section exists,
 * so every way it can fail should be a unit test, not a fixture.
 *
 * The rule: every MHG hotel is run by a registered third-party management
 * company, and no principal of the hotel's owner may be a principal of that
 * company. Opening a hotel is refused until it holds.
 */

export const ORG_KINDS = ['ownership', 'management'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  ownership: 'Ownership group',
  management: 'Management company',
};

export const SERVICE_LEVELS = ['select_service', 'focused_service', 'full_service', 'extended_stay', 'resort'] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];
export const SERVICE_LEVEL_LABELS: Record<ServiceLevel, string> = {
  select_service: 'Select service',
  focused_service: 'Focused service',
  full_service: 'Full service',
  extended_stay: 'Extended stay',
  resort: 'Resort',
};

export const PIP_STATUSES = ['none', 'scheduled', 'in_progress', 'complete'] as const;
export type PipStatus = (typeof PIP_STATUSES)[number];
export const PIP_LABELS: Record<PipStatus, string> = {
  none: 'None',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  complete: 'Complete',
};

export const QA_RESULTS = ['pass', 'conditional', 'fail'] as const;
export type QaResult = (typeof QA_RESULTS)[number];

// ─────────────────────────────── ids ──────────────────────────────────────

/**
 * `Riverside Capital, LLC` → `org_riverside_capital_llc`. Minted once at
 * creation and never recomputed — assignments point at it (same discipline as
 * a group id, and as a property id through a rebrand, G1).
 */
export function slugForOrgName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (!slug) throw new Error('An organization needs a name with at least one letter or digit in it.');
  return `org_${slug}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** For the softer check: two principals with the same name but different emails. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────── organizations ────────────────────────────

export interface OrgInput {
  kind: OrgKind;
  name: string;
  legalName: string;
  registeredState: string;
  registrationNumber: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export type OrgCheck =
  | { ok: true; value: OrgInput }
  | { ok: false; errors: Partial<Record<keyof OrgInput, string>> };

export function checkOrganization(input: Partial<Record<keyof OrgInput, string | undefined>>): OrgCheck {
  const t = (k: keyof OrgInput) => (input[k] ?? '').trim();
  const errors: Partial<Record<keyof OrgInput, string>> = {};

  const kind = t('kind');
  if (!(ORG_KINDS as readonly string[]).includes(kind)) errors.kind = 'Kind is ownership or management.';
  const name = t('name');
  if (!name) errors.name = 'An organization needs a name.';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';

  const registeredState = t('registeredState').toUpperCase();
  if (registeredState && !/^[A-Z]{2}$/.test(registeredState)) {
    errors.registeredState = 'Registered state is a two-letter code, e.g. IN.';
  }
  const registrationNumber = t('registrationNumber');
  if (kind === 'management') {
    if (!registeredState) errors.registeredState = 'A management company must show where it is registered.';
    if (!registrationNumber) {
      errors.registrationNumber = 'A management company must carry its registration number — that is what makes it a registered third party.';
    }
  }
  const contactEmail = normalizeEmail(t('contactEmail'));
  if (contactEmail && !EMAIL.test(contactEmail)) errors.contactEmail = 'That is not an email address.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: kind as OrgKind,
      name,
      legalName: t('legalName'),
      registeredState,
      registrationNumber,
      contactName: t('contactName'),
      contactEmail,
      contactPhone: t('contactPhone'),
    },
  };
}

export interface PrincipalInput {
  name: string;
  email: string;
  title: string;
}

export function checkPrincipal(
  input: Partial<Record<keyof PrincipalInput, string | undefined>>,
): { ok: true; value: PrincipalInput } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  const email = normalizeEmail(input.email ?? '');
  if (!name) return { ok: false, error: 'A principal needs a name.' };
  if (!EMAIL.test(email)) {
    return { ok: false, error: 'A principal needs an email — it is what the management rule compares across organizations.' };
  }
  return { ok: true, value: { name, email, title: (input.title ?? '').trim() } };
}

// ─────────────────────────────── compliance ───────────────────────────────

export interface OrgFacts {
  id: string;
  kind: OrgKind;
  name: string;
  registeredState: string;
  registrationNumber: string;
  archived: boolean;
  /** LIVE principals only. */
  principals: { name: string; email: string }[];
}

export type FindingLevel = 'block' | 'warn';

export interface Finding {
  level: FindingLevel;
  code: string;
  message: string;
}

/**
 * Whether `manager` may run a hotel owned by `owner`. Blocks are the rule;
 * warnings are things a person should look at but the data cannot settle —
 * two principals with the same name and different emails may or may not be
 * the same human.
 */
export function managementFindings(owner: OrgFacts, manager: OrgFacts): Finding[] {
  const out: Finding[] = [];
  if (owner.kind !== 'ownership') {
    out.push({ level: 'block', code: 'owner_kind', message: `${owner.name} is not an ownership group.` });
  }
  if (manager.kind !== 'management') {
    out.push({
      level: 'block',
      code: 'manager_kind',
      message: `${manager.name} is not a management company. MHG hotels are run by a registered third-party manager.`,
    });
  }
  if (owner.id === manager.id) {
    out.push({ level: 'block', code: 'self_managed', message: 'The owner cannot manage its own hotel.' });
  }
  if (manager.archived) {
    out.push({ level: 'block', code: 'manager_archived', message: `${manager.name} is archived.` });
  }
  if (manager.kind === 'management' && (!manager.registeredState || !manager.registrationNumber)) {
    out.push({
      level: 'block',
      code: 'manager_unregistered',
      message: `${manager.name} has no registration on file, so it is not a registered third party.`,
    });
  }

  const ownerEmails = new Map(owner.principals.map((p) => [normalizeEmail(p.email), p.name]));
  const ownerNames = new Map(owner.principals.map((p) => [normalizeName(p.name), p]));
  for (const p of manager.principals) {
    const email = normalizeEmail(p.email);
    if (ownerEmails.has(email)) {
      out.push({
        level: 'block',
        code: 'shared_principal',
        message: `${p.name} (${email}) is a principal of both ${owner.name} and ${manager.name}. An ownership principal may not operate the hotel.`,
      });
      continue;
    }
    const same = ownerNames.get(normalizeName(p.name));
    if (same) {
      out.push({
        level: 'warn',
        code: 'similar_principal',
        message: `${p.name} appears on both sides under different emails (${normalizeEmail(same.email)}, ${email}). Confirm they are different people.`,
      });
    }
  }
  return out;
}

export interface ControlState {
  owner: OrgFacts | null;
  manager: OrgFacts | null;
  streetAddress: string;
  keyCount: number | null;
}

/**
 * Everything standing between a property and `active`. Blocks refuse the
 * open; warnings show on the page and do not.
 */
export function openFindings(state: ControlState): Finding[] {
  const out: Finding[] = [];
  if (!state.owner) {
    out.push({ level: 'block', code: 'no_owner', message: 'No ownership group is assigned.' });
  }
  if (!state.manager) {
    out.push({
      level: 'block',
      code: 'no_manager',
      message: 'No management company is assigned. Every MHG hotel is run by a registered third-party manager.',
    });
  }
  if (state.owner && state.manager) out.push(...managementFindings(state.owner, state.manager));
  if (!state.streetAddress.trim()) out.push({ level: 'warn', code: 'no_address', message: 'No street address.' });
  if (state.keyCount === null) out.push({ level: 'warn', code: 'no_keys', message: 'No key count.' });
  return out;
}

export function blocks(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.level === 'block');
}

// ─────────────────────────────── assignments ──────────────────────────────

/**
 * A new assignment starts on or after the live one did — assignments do not
 * overlap and do not rewrite history. The live row closes on the new start.
 */
export function checkAssignmentStart(effectiveFrom: string, currentFrom: string | null): string | null {
  if (!isIsoDate(effectiveFrom)) return 'Effective date is a date (YYYY-MM-DD).';
  if (currentFrom && effectiveFrom < currentFrom) {
    return `The current assignment began ${currentFrom}. A new one cannot start before it.`;
  }
  return null;
}

/** A blank date is "not known"; anything else must be a real date. */
export function checkOptionalDate(label: string, d: string): string | null {
  return d === '' || isIsoDate(d) ? null : `${label} is a date (YYYY-MM-DD), or blank.`;
}

/** An end date, when both ends are known, is after the start. */
export function checkTerm(label: string, from: string, to: string): string | null {
  return from && to && to <= from ? `${label} must end after it begins.` : null;
}

// ─────────────────────────────── the asset ────────────────────────────────

export interface AssetInput {
  streetAddress: string;
  postalCode: string;
  keyCount: number | null;
  serviceLevel: string;
  yearOpened: number | null;
  yearRenovated: number | null;
  pipStatus: string;
  pipDueDate: string;
  qaLastDate: string;
  qaLastResult: string;
}

export type AssetCheck =
  | { ok: true; value: Partial<AssetInput> }
  | { ok: false; errors: Partial<Record<keyof AssetInput, string>> };

function intOrNull(raw: string): number | null | 'bad' {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return 'bad';
  return Number(s);
}

/** Normalizes and checks whichever fields are present, like checkSetup. */
export function checkAsset(
  input: Partial<Record<keyof AssetInput, string | undefined>>,
  thisYear: number = new Date().getUTCFullYear(),
): AssetCheck {
  const value: Partial<AssetInput> = {};
  const errors: Partial<Record<keyof AssetInput, string>> = {};

  if (input.streetAddress !== undefined) value.streetAddress = input.streetAddress.trim().slice(0, 200);
  if (input.postalCode !== undefined) {
    const z = input.postalCode.trim().toUpperCase();
    if (z === '' || /^[A-Z0-9 -]{3,10}$/.test(z)) value.postalCode = z;
    else errors.postalCode = 'That is not a postal code.';
  }
  if (input.keyCount !== undefined) {
    const n = intOrNull(input.keyCount);
    if (n === 'bad' || (n !== null && (n < 1 || n > 5000))) errors.keyCount = 'Key count is a whole number of rooms, 1 or more.';
    else value.keyCount = n;
  }
  if (input.serviceLevel !== undefined) {
    const s = input.serviceLevel.trim();
    if (s === '' || (SERVICE_LEVELS as readonly string[]).includes(s)) value.serviceLevel = s;
    else errors.serviceLevel = 'Unknown service level.';
  }
  for (const k of ['yearOpened', 'yearRenovated'] as const) {
    if (input[k] === undefined) continue;
    const n = intOrNull(input[k]!);
    if (n === 'bad' || (n !== null && (n < 1800 || n > thisYear + 5))) errors[k] = 'That is not a plausible year.';
    else value[k] = n;
  }
  if (
    value.yearOpened != null &&
    value.yearRenovated != null &&
    value.yearRenovated < value.yearOpened
  ) {
    errors.yearRenovated = 'A hotel cannot be renovated before it opened.';
  }
  if (input.pipStatus !== undefined) {
    const s = input.pipStatus.trim() || 'none';
    if ((PIP_STATUSES as readonly string[]).includes(s)) value.pipStatus = s;
    else errors.pipStatus = 'Unknown PIP status.';
  }
  for (const [k, label] of [
    ['pipDueDate', 'PIP due date'],
    ['qaLastDate', 'Last QA date'],
  ] as const) {
    if (input[k] === undefined) continue;
    const d = input[k]!.trim();
    const bad = checkOptionalDate(label, d);
    if (bad) errors[k] = bad;
    else value[k] = d;
  }
  if (input.qaLastResult !== undefined) {
    const r = input.qaLastResult.trim();
    if (r === '' || (QA_RESULTS as readonly string[]).includes(r)) value.qaLastResult = r;
    else errors.qaLastResult = 'QA result is pass, conditional or fail.';
  }
  if (value.qaLastResult && value.qaLastDate === '') {
    errors.qaLastDate = 'A QA result needs the date it was given.';
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
