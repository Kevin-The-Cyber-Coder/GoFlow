import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor. 12 is the current baseline for interactive logins and
 * keeps a single hash around 250 ms on commodity hardware. Raising it makes
 * offline guessing more expensive but also slows every login.
 */
const COST = 12;

/**
 * bcrypt silently truncates inputs beyond 72 bytes. Rejecting longer
 * passwords is safer than accepting two different passwords that hash the
 * same value.
 */
export const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password must not exceed ${MAX_PASSWORD_BYTES} bytes.`);
  }
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
