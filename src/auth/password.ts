import bcrypt from 'bcryptjs';

/** Matches Inspire and InspiredREV so a person's credential means the same thing everywhere. */
const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordProblem {
  ok: false;
  message: string;
}

/**
 * Deliberately a length floor and nothing else. Composition rules ("one digit,
 * one symbol") push people toward Password1! and away from length, which is the
 * thing that actually costs an attacker anything.
 */
export function checkPassword(plain: string): { ok: true } | PasswordProblem {
  if (plain.length < 12) {
    return { ok: false, message: 'Use at least 12 characters — length is what matters.' };
  }
  if (plain.length > 200) {
    return { ok: false, message: 'That is longer than 200 characters.' };
  }
  return { ok: true };
}

/**
 * A one-time password for a newly provisioned person, handed to whoever granted
 * access to pass on out of band.
 *
 * There is no mail server here, and inventing one to send a link would be a
 * bigger commitment than this system has earned. A spoken or typed credential
 * that the holder changes on first sign-in is the honest small version — the
 * weakness is the channel it travels over, which is at least visible, rather
 * than a token flow that looks rigorous and is never tested.
 */
export function generateTempPassword(): string {
  // Ambiguous characters left out: these get read aloud and retyped.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}-${chars.slice(10, 15).join('')}-${chars.slice(15, 20).join('')}`;
}
