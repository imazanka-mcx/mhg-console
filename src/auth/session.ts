import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Session cookie (docs/01 §2.6).
 *
 * The token carries identity only — who you are, not what you may do.
 * Permissions are resolved from grants on every request, so revoking access
 * takes effect immediately instead of waiting out a token's lifetime. That
 * matters more here than the saved database round trip: this app's whole job is
 * saying who may do what.
 */

const COOKIE = 'mhg_console_session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  personId: string;
  email: string;
}

function secret(): Uint8Array {
  const value = process.env['AUTH_SECRET'];
  if (!value || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short (needs 32+ characters). Generate one with: openssl rand -base64 48',
    );
  }
  return new TextEncoder().encode(value);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.personId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function destroySession(): void {
  cookies().delete(COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const personId = payload.sub;
    const email = payload['email'];
    if (typeof personId !== 'string' || typeof email !== 'string') return null;
    return { personId, email };
  } catch {
    // Expired, tampered with, or signed under a rotated secret. All mean the
    // same thing to us: no session.
    return null;
  }
}
