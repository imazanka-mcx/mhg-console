import { NextResponse } from 'next/server';
import { MHG_BRANDS } from '@mcx/inn-code';

import { prisma } from '../../../../../db.ts';
import { SHELL_CONTRACT, SIGNATURE_HEADER, verifyBody } from '../../../../../shell/contract.ts';

/**
 * GET /api/registry/v1/brands — the closed brand table (B1), served to the
 * shell subscribers so they mirror it instead of keeping their own (§1.5).
 *
 * The shell stream only carries a brand inside a property, so a consumer
 * learned a flag the day the first hotel flying it arrived and not before.
 * That left InspiredREV's brand picker showing whatever had happened to be
 * delivered. This is the whole table, pulled on demand.
 *
 * Auth reuses the subscriber's shell secret: the caller names itself in
 * `x-mhg-registry-subscriber` and signs the fixed string `brands:<name>` with
 * the same `t=…,v1=…` scheme the stream uses, so there is no new secret to
 * issue or rotate. Read-only, and it never touches the stream cursor.
 */

export const dynamic = 'force-dynamic';

const SUBSCRIBER_HEADER = 'x-mhg-registry-subscriber';

export async function GET(req: Request): Promise<NextResponse> {
  const name = req.headers.get(SUBSCRIBER_HEADER)?.trim() ?? '';
  if (!name) return NextResponse.json({ error: 'Missing subscriber.' }, { status: 401 });

  const sub = await prisma.shellSubscriber.findUnique({ where: { name }, select: { secret: true, active: true } });
  if (!sub || !sub.active) return NextResponse.json({ error: 'Unknown subscriber.' }, { status: 401 });

  const verified = verifyBody(sub.secret, `brands:${name}`, req.headers.get(SIGNATURE_HEADER));
  if (!verified.ok) return NextResponse.json({ error: verified.reason }, { status: 401 });

  return NextResponse.json({
    contract: SHELL_CONTRACT,
    // Retired flags are included and marked: their codes stay reserved (B4), and
    // a consumer still holding properties under one needs to know, not guess.
    brands: MHG_BRANDS.map((b) => ({
      code: b.code,
      name: b.name,
      chainCode: b.chainCode,
      retired: Boolean(b.retired),
    })),
  });
}
