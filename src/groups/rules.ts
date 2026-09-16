/**
 * Rule-backed group membership (docs/01 §2.2).
 *
 * Deliberately free of Prisma imports, for the same reason scope.ts is: a rule
 * is a statement about a property, and it should be decidable — and testable —
 * without a database.
 *
 * The vocabulary is CLOSED. A rule language that can express anything ends up
 * expressing the permission model a second time, in JSON, where nothing
 * type-checks it. These five fields cover what the portfolio is actually sliced
 * by; anything else is a manual group until there is a reason it cannot be.
 */

export const RULE_FIELDS = ['brandCode', 'chainCode', 'state', 'city', 'status'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/**
 * Values within a field are OR'd, fields are AND'd:
 *
 *   { brandCode: ['HX', 'HP'], state: ['IN'] }
 *     → Hampton or Home2, in Indiana
 *
 * An absent field constrains nothing, with one exception: see `matches`.
 */
export type GroupRule = Partial<Record<RuleField, string[]>>;

/** The part of a property a rule can see. */
export interface PropertySubject {
  brandCode: string;
  chainCode: string;
  state: string;
  city: string;
  status: string;
}

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  brandCode: 'Brand',
  chainCode: 'Chain',
  state: 'State',
  city: 'City',
  status: 'Status',
};

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Validate and normalize a rule from untrusted input (a form, or a row written
 * by an older version of this code).
 *
 * Refuses an EMPTY rule. A rule with no fields matches the entire portfolio,
 * which is a portfolio grant wearing a group's clothes — and it would arrive
 * silently, as a group that mysteriously contains everything. If someone wants
 * every property, that is what portfolio scope is for.
 */
export function parseRule(value: unknown): GroupRule {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuleError('A rule is an object of field → values.');
  }

  const out: GroupRule = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(RULE_FIELDS as readonly string[]).includes(key)) {
      throw new RuleError(
        `Unknown rule field "${key}". A rule may name: ${RULE_FIELDS.join(', ')}.`,
      );
    }
    const values = Array.isArray(raw) ? raw : [raw];
    const cleaned = values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (cleaned.length !== values.length) {
      throw new RuleError(`${RULE_FIELD_LABELS[key as RuleField]} takes a list of text values.`);
    }
    if (cleaned.length === 0) continue;
    out[key as RuleField] = [...new Set(cleaned)];
  }

  if (Object.keys(out).length === 0) {
    throw new RuleError(
      'A rule with no conditions matches the whole portfolio. Name at least one field, or use portfolio scope.',
    );
  }
  return out;
}

/** Parse a rule stored as JSON, keeping the failure legible. */
export function ruleFromJson(value: unknown): GroupRule {
  return parseRule(value);
}

/**
 * Does this property satisfy the rule?
 *
 * The one implicit condition: a rule that does not mention `status` excludes
 * RETIRED properties. A retired code is a dead hotel, and a region that
 * silently accumulates them stops being a list of places anyone operates. Say
 * `status: ['retired']` to mean it.
 */
export function matches(rule: GroupRule, subject: PropertySubject): boolean {
  if (!rule.status && subject.status === 'retired') return false;

  for (const field of RULE_FIELDS) {
    const wanted = rule[field];
    if (!wanted || wanted.length === 0) continue;
    const held = norm(subject[field]);
    if (!wanted.some((w) => norm(w) === held)) return false;
  }
  return true;
}

/** Every property the rule selects, in input order. */
export function selectMatching<T extends PropertySubject>(rule: GroupRule, properties: T[]): T[] {
  return properties.filter((p) => matches(rule, p));
}

/** A one-line rendering for the UI and the audit trail. */
export function describeRule(rule: GroupRule): string {
  const parts = RULE_FIELDS.filter((f) => rule[f]?.length).map(
    (f) => `${RULE_FIELD_LABELS[f].toLowerCase()} ${rule[f]!.join(' or ')}`,
  );
  const base = parts.join(', and ');
  return rule.status ? base : `${base} (excluding retired)`;
}
