'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requirePermission } from '../../../../auth/actor.ts';
import { issueProperty, proposeCode } from '../../../../issuance.ts';
import { checkSetup, type ShellSetup } from '../../../../setup.ts';
import type { IssueRequest, TraceStep } from '@mcx/inn-code';

/**
 * The New Property flow, in two deliberate steps (docs/01 §1.2).
 *
 * `propose` reads the registry and writes nothing; `issue` takes the atomic
 * claim. They are separate because a code is permanent the moment it is
 * claimed — retired codes are never reissued (G3) and a market code is never
 * reassigned (M7) — so the operator sees the code and the rules that produced
 * it BEFORE anything becomes irreversible. Same discipline as the CLI.
 */

const Input = z.object({
  name: z.string().trim().max(120).default(''),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z
    .string()
    .trim()
    .length(2, 'State must be the two-letter USPS code')
    .transform((s) => s.toUpperCase()),
  brandCode: z.string().trim().min(1, 'Pick a brand'),
  submarket: z.string().trim().max(80).optional(),
  franchisorCode: z.string().trim().max(20).optional(),
  status: z.enum(['pipeline', 'active']).default('pipeline'),
  // Shell fields (docs/01 §1.3). Not part of the code's derivation — they ride
  // along so the property reaches Inspire and InspiredREV complete.
  timezone: z.string().trim().min(1, 'Pick a timezone'),
  currency: z.string().trim().default('USD'),
  expectedOpenDate: z.string().trim().default(''),
});

export type ProposeState =
  | { kind: 'idle' }
  | { kind: 'invalid'; errors: Record<string, string> }
  | { kind: 'refused'; rule: string; message: string; trace: TraceStep[] }
  | { kind: 'proposed'; code: string; trace: TraceStep[]; input: IssueRequest; setup: ShellSetup };

export type IssueState =
  | { kind: 'idle' }
  | { kind: 'refused'; rule: string; message: string };

function toRequest(parsed: z.infer<typeof Input>): IssueRequest {
  const req: IssueRequest = {
    name: parsed.name,
    city: parsed.city,
    state: parsed.state,
    brandCode: parsed.brandCode,
    status: parsed.status,
  };
  if (parsed.submarket) req.submarket = parsed.submarket;
  if (parsed.franchisorCode) req.franchisorCode = parsed.franchisorCode;
  return req;
}

function read(form: FormData) {
  return Input.safeParse({
    name: form.get('name') ?? '',
    city: form.get('city') ?? '',
    state: form.get('state') ?? '',
    brandCode: form.get('brandCode') ?? '',
    submarket: form.get('submarket') ?? undefined,
    franchisorCode: form.get('franchisorCode') ?? undefined,
    status: form.get('status') ?? 'pipeline',
    timezone: form.get('timezone') ?? '',
    currency: form.get('currency') ?? 'USD',
    expectedOpenDate: form.get('expectedOpenDate') ?? '',
  });
}

function toSetup(parsed: z.infer<typeof Input>): ShellSetup {
  return {
    timezone: parsed.timezone,
    currency: parsed.currency,
    expectedOpenDate: parsed.expectedOpenDate,
  };
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

export async function proposeAction(_prev: ProposeState, form: FormData): Promise<ProposeState> {
  const parsed = read(form);
  if (!parsed.success) return { kind: 'invalid', errors: fieldErrors(parsed.error) };
  const setup = checkSetup(toSetup(parsed.data));
  if (!setup.ok) return { kind: 'invalid', errors: setup.errors as Record<string, string> };

  const input = toRequest(parsed.data);
  const result = await proposeCode(input);
  if (!result.ok) {
    return {
      kind: 'refused',
      rule: result.failure.rule,
      message: result.failure.message,
      trace: result.trace,
    };
  }
  return {
    kind: 'proposed',
    code: result.candidate.code,
    trace: result.candidate.trace,
    input,
    setup: toSetup(parsed.data),
  };
}

export async function issueAction(_prev: IssueState, form: FormData): Promise<IssueState> {
  try {
    await requirePermission('property.issue');
  } catch {
    return { kind: 'refused', rule: 'access', message: 'You are not permitted to issue inn codes.' };
  }
  const parsed = read(form);
  if (!parsed.success) {
    return { kind: 'refused', rule: 'G4', message: 'The form no longer validates — start again.' };
  }

  // Deliberately re-derived rather than trusting the proposed code from the
  // form: between proposing and confirming, someone else may have claimed it.
  // issueCode re-runs the ladder and retries on conflict, so the operator gets
  // the next legal code instead of a failure — or a clean refusal if the market
  // itself is gone (M7).
  let result;
  try {
    result = await issueProperty(toRequest(parsed.data), toSetup(parsed.data));
  } catch (err) {
    return { kind: 'refused', rule: 'setup', message: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) {
    return { kind: 'refused', rule: result.failure.rule, message: result.failure.message };
  }

  revalidatePath('/portfolio');
  redirect(`/portfolio?issued=${result.record.code}`);
}
