import { createHash, randomBytes } from 'node:crypto';

/**
 * A learner code is the only credential: 16 characters (80 bits) from an alphabet without look-alikes,
 * shown to the learner once as XXXX-XXXX-XXXX-XXXX. The database keeps only its SHA-256, so the code
 * (and therefore the learner) cannot be recovered from the database. 80 random bits make a fast hash safe.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const LENGTH = 16;

export function generateLearnerCode(): string {
  const chars: string[] = [];
  // Rejection sampling keeps the distribution uniform.
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < limit && chars.length < LENGTH) chars.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** Upper-cases and strips separators so "ab12 cd34…" and "AB12-CD34-…" are the same code. */
export function normalizeLearnerCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isWellFormedCode(code: string): boolean {
  const n = normalizeLearnerCode(code);
  return n.length === LENGTH && [...n].every((c) => ALPHABET.includes(c));
}

export function hashLearnerCode(code: string): string {
  return createHash('sha256').update(normalizeLearnerCode(code)).digest('hex');
}
