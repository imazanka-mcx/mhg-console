import { NextResponse } from 'next/server';

import { SIGNATURE_HEADER } from '../../../../../../shell/contract.ts';
import { applyPasswordChange } from '../../../../../../people/password.ts';

/**
 * POST /api/registry/v1/people/password — a password changed inside Inspire or
 * InspiredREV (docs/01 §2.8). Signed with the consumer's subscription secret;
 * carries a bcrypt hash, never a password.
 */

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.text();
  const [status, ack] = await applyPasswordChange(body, req.headers.get(SIGNATURE_HEADER));
  return NextResponse.json(ack, { status });
}
