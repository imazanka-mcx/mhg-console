/**
 * The shell fields the Inn Code engine does not own — timezone, currency and
 * the planned opening (docs/01 §1.3). Validated here, purely, so the New
 * Property form, the property page and the CLI all refuse the same things.
 */

export interface ShellSetup {
  timezone: string;
  currency: string;
  /** YYYY-MM-DD, or '' for "not yet known". */
  expectedOpenDate: string;
}

/** The zones the forms offer. Anything IANA knows is accepted from the CLI. */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

export function isTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export type SetupCheck =
  | { ok: true; value: Partial<ShellSetup> }
  | { ok: false; errors: Partial<Record<keyof ShellSetup, string>> };

/** Normalizes and checks whichever fields are present. Absent fields stay absent. */
export function checkSetup(input: Partial<Record<keyof ShellSetup, string | undefined>>): SetupCheck {
  const value: Partial<ShellSetup> = {};
  const errors: Partial<Record<keyof ShellSetup, string>> = {};

  if (input.timezone !== undefined) {
    const tz = input.timezone.trim();
    if (isTimezone(tz)) value.timezone = tz;
    else errors.timezone = `"${tz}" is not an IANA timezone, e.g. America/Chicago.`;
  }
  if (input.currency !== undefined) {
    const c = input.currency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(c)) value.currency = c;
    else errors.currency = 'Currency is a three-letter ISO code, e.g. USD.';
  }
  if (input.expectedOpenDate !== undefined) {
    const d = input.expectedOpenDate.trim();
    if (d === '' || isIsoDate(d)) value.expectedOpenDate = d;
    else errors.expectedOpenDate = 'Expected opening is a date (YYYY-MM-DD), or blank.';
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
