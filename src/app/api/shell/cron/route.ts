import { NextResponse } from 'next/server';

import { deliverAll } from '../../../../shell/publish.ts';

/**
 * Daily safety net for the shell stream (docs/01 §1.4).
 *
 * Every registry write already tries to deliver on the spot, so this only does
 * work when a consumer was down at the time: it pushes each subscriber from its
 * cursor to the head. Vercel Hobby runs crons once a day, which bounds how long
 * a missed delivery can stay missed without anyone pressing a button — the
 * property page's "Deliver now" and `npm run shell -- deliver` are the
 * immediate routes.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends when the
 * variable is set. Without it the route refuses rather than sitting open — the
 * same rule Inspire's cron routes follow.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured; refusing to run.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const results = await deliverAll();
  return NextResponse.json({ ok: results.every((r) => r.ok), results, at: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
