import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Single-user auth: one password from APP_PASSWORD, one signed HTTP-only
 * cookie. No user table, no sessions table — the cookie itself is the session,
 * authenticated with an HMAC over SESSION_SECRET.
 *
 * Because sessions are stateless, logout clears the browser's cookie but cannot
 * revoke a token someone already copied; it stays valid until `exp`. That is an
 * accepted trade-off for a single-user tool. To invalidate every outstanding
 * token at once, rotate SESSION_SECRET.
 */

export const SESSION_COOKIE = "kcpc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type SessionPayload = {
  /** subject — always "owner"; single-user app. */
  sub: "owner";
  /** issued at, epoch seconds */
  iat: number;
  /** expires at, epoch seconds */
  exp: number;
  /** random, so two logins never produce the same token */
  jti: string;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", env.sessionSecret).update(data).digest());
}

/** Constant-time string compare that does not leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so timing does not distinguish "wrong length"
    // from "wrong value".
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function verifyPassword(candidate: string): boolean {
  return safeEqual(candidate, env.appPassword);
}

export function createSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: "owner",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: randomBytes(9).toString("base64url"),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

/** Verifies signature and expiry. Returns null for anything untrusted. */
export function readSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(body))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.sub !== "owner") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Authoritative check. Use this in pages, layouts and route handlers. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}

/**
 * Cookie attributes. `secure` is off on localhost because the dev server is
 * plain HTTP; on Railway (or any HTTPS host) NODE_ENV is production and the
 * cookie is marked secure.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
