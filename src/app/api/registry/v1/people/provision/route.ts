import { NextResponse } from 'next/server';

import { SIGNATURE_HEADER } from '../../../../../../shell/contract.ts';
import { applyProvision } from '../../../../../../people/provision.ts';

/**
 * POST /api/registry/v1/people/provision — Inspire's Users flow, and the
 * one-time import of local accounts (docs/01 §2.9). Signed with the consumer's
 * subscription secret.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.text();
  const [status, ack] = await applyProvision(body, req.headers.get(SIGNATURE_HEADER));
  return NextResponse.json(ack, { status });
}
