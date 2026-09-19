import { randomToken, sha256, verifyPassword } from "./crypto";
import type { Env, UserRow } from "./types";

export const COOKIE = "__Host-club_session";

function policy(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export function sessionDays(env: Env): number {
  return policy(env.SESSION_DAYS, 30, 1, 90);
}
function maxFailures(env: Env): number {
  return policy(env.LOGIN_MAX_FAILURES, 5, 3, 20);
}
function lockMinutes(env: Env): number {
  return policy(env.LOGIN_LOCK_MINUTES, 15, 1, 1440);
}

export function cookieHeader(token: string, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearCookie(): string {
  return cookieHeader("", 0);
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const pair = header
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${COOKIE}=`));
  const token = pair?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function currentUser(
  request: Request,
  db: D1Database,
): Promise<UserRow | null> {
  const token = readCookie(request);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await sha256(token), new Date().toISOString())
    .first<UserRow>();
}

export async function issueSession(
  db: D1Database,
  userId: string,
  env: Env,
): Promise<string> {
  const { token, statement } = await newSession(db, userId, env);
  await statement.run();
  return token;
}

async function newSession(
  db: D1Database,
  userId: string,
  env: Env,
): Promise<{ token: string; statement: D1PreparedStatement }> {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + sessionDays(env) * 86_400_000);
  const statement = db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(
      await sha256(token),
      userId,
      now.toISOString(),
      expires.toISOString(),
    );
  return { token, statement };
}

export async function replacePasswordAndSessions(
  db: D1Database,
  userId: string,
  passwordHash: string,
  env: Env,
): Promise<string> {
  const { token, statement } = await newSession(db, userId, env);
  await db.batch([
    db
      .prepare(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      )
      .bind(passwordHash, new Date().toISOString(), userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    statement,
  ]);
  return token;
}

export async function revokeSession(
  request: Request,
  db: D1Database,
): Promise<void> {
  const token = readCookie(request);
  if (token)
    await db
      .prepare(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .bind(new Date().toISOString(), await sha256(token))
      .run();
}

export async function authenticate(
  db: D1Database,
  env: Env,
  displayName: string,
  password: string,
): Promise<{ user?: UserRow; locked: boolean }> {
  const normalized = displayName.trim();
  const key = await sha256(normalized.toLocaleLowerCase("en-US"));
  const now = new Date();
  const state = await db
    .prepare(
      "SELECT failed_count, locked_until FROM login_attempts WHERE identifier_hash = ?",
    )
    .bind(key)
    .first<{ failed_count: number; locked_until: string | null }>();
  if (state?.locked_until && state.locked_until > now.toISOString())
    return { locked: true };
  const user = await db
    .prepare(
      "SELECT * FROM users WHERE display_name = ? COLLATE NOCASE AND status = ?",
    )
    .bind(normalized, "active")
    .first<UserRow>();
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : false;
  if (!valid) {
    const lockedUntil = new Date(
      now.getTime() + lockMinutes(env) * 60_000,
    ).toISOString();
    await db
      .prepare(
        `INSERT INTO login_attempts (identifier_hash, failed_count, locked_until, updated_at)
      VALUES (?, 1, NULL, ?) ON CONFLICT(identifier_hash) DO UPDATE SET
      failed_count = CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= ? THEN 1 ELSE login_attempts.failed_count + 1 END,
      locked_until = CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= ? THEN NULL
        WHEN login_attempts.failed_count + 1 >= ? THEN ? ELSE NULL END,
      updated_at = excluded.updated_at`,
      )
      .bind(
        key,
        now.toISOString(),
        now.toISOString(),
        now.toISOString(),
        maxFailures(env),
        lockedUntil,
      )
      .run();
    const latest = await db
      .prepare(
        "SELECT locked_until FROM login_attempts WHERE identifier_hash = ?",
      )
      .bind(key)
      .first<{ locked_until: string | null }>();
    return { locked: !!latest?.locked_until };
  }
  await db
    .prepare("DELETE FROM login_attempts WHERE identifier_hash = ?")
    .bind(key)
    .run();
  return { user: user!, locked: false };
}
