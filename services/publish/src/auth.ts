import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who is calling. Requests reach nib-publish only through Sluice, the w33d gateway, which proves it handled
 * them with X-Auth-Sig: HMAC-SHA256 over "subject\ngroups\nminute" with the gateway key (this minute or the
 * last). On the API route Sluice has also checked the Keystone access token's signature, issuer and expiry;
 * nib-publish checks that the token was issued to nib (its audience) and belongs to that subject.
 */

export interface Identity { sub: string }

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Whether Sluice signed this subject and groups in the last two minutes. */
export function gatewaySigned(key: string, subject: string, groups: string, sig: string, now = Date.now()): boolean {
  if (!key || !subject || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const minute = Math.floor(now / 60000);
  for (const w of [minute, minute - 1]) {
    const want = Buffer.from(createHmac('sha256', key).update(`${subject}\n${groups}\n${w}`).digest('hex'));
    const got = Buffer.from(sig.toLowerCase());
    if (want.length === got.length && timingSafeEqual(want, got)) return true;
  }
  return false;
}

/** The identity Sluice vouches for on an SSO route (private sites). */
export function ssoIdentity(headers: Record<string, string | string[] | undefined>, key: string, now?: number): Identity {
  const sub = header(headers, 'x-auth-subject') ?? '';
  if (!gatewaySigned(key, sub, header(headers, 'x-auth-groups') ?? '', header(headers, 'x-auth-sig') ?? '', now)) throw new AuthError('not signed in through w33d');
  return { sub };
}

/** The claims of a JWT, read without checking its signature (Sluice checked it). */
function claimsOf(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new AuthError('malformed token');
  }
}

/** The caller of the API: a w33d user with a token issued to nib. */
export function apiIdentity(headers: Record<string, string | string[] | undefined>, opts: { key: string; audience: string; now?: number }): Identity {
  const signed = ssoIdentity(headers, opts.key, opts.now);
  const auth = header(headers, 'authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) throw new AuthError('missing token');
  const claims = claimsOf(m[1]);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.audience)) throw new AuthError('this token was not issued to nib', 403);
  if (claims.sub !== signed.sub) throw new AuthError('token and gateway identity differ');
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
  if (exp < (opts.now ?? Date.now())) throw new AuthError('token expired');
  return signed;
}
