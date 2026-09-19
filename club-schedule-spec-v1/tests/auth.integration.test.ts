import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authenticate, COOKIE, issueSession } from "../server/auth";
import { handleApi } from "../server/api";
import { hashPassword, sha256, verifyPassword } from "../server/crypto";
import type { Env } from "../server/types";

const originalPassword = "integration test password";
const changedPassword = "changed integration password";
const origin = "https://example.test";
let originalHash: string;
let sqlite: DatabaseSync;
let env: Env;

// D1-compatible adapter backed by actual SQLite. batch() models D1's
// documented all-or-nothing transaction around prepared statements.
function database(): D1Database {
  return {
    prepare(sql: string) {
      const prepared = sqlite.prepare(sql);
      const statement = (values: unknown[] = []): D1PreparedStatement =>
        ({
          bind: (...args: unknown[]) => statement(args),
          first: async <T>() =>
            (prepared.get(...(values as [])) ?? null) as T | null,
          all: async <T>() => ({
            results: prepared.all(...(values as [])) as T[],
          }),
          run: async () => {
            prepared.run(...(values as []));
            return { success: true };
          },
        }) as D1PreparedStatement;
      return statement();
    },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as D1Database;
}

function setup(): void {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_phase1.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite
    .prepare(
      `INSERT INTO users (id, display_name, password_hash, grade, registration_year,
        primary_campus_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("member-id", "Member", originalHash, 2, 2026, "omiya", "now", "now");
  env = {
    DB: database(),
    LOGIN_MAX_FAILURES: "3",
    LOGIN_LOCK_MINUTES: "1",
    SESSION_DAYS: "2",
  };
}

function row<T>(sql: string, ...args: string[]): T | undefined {
  return sqlite.prepare(sql).get(...args) as T | undefined;
}

function request(
  path: string,
  method = "GET",
  cookie?: string,
  data?: object,
  requestOrigin = origin,
): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== "GET"
        ? { Origin: requestOrigin, "Content-Type": "application/json" }
        : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}

function cookie(response: Response): string {
  const value = response.headers.get("Set-Cookie");
  expect(value).toContain(`${COOKIE}=`);
  return value!.split(";")[0];
}

beforeAll(async () => {
  originalHash = await hashPassword(originalPassword);
});
afterEach(() => sqlite?.close());

describe("authentication on migrated SQLite", () => {
  it("increments failures, locks at the configured maximum, and rejects login while locked", async () => {
    setup();
    for (let count = 1; count <= 3; count++) {
      const result = await authenticate(env.DB, env, "Member", "wrong");
      const state = row<{ failed_count: number; locked_until: string | null }>(
        "SELECT failed_count, locked_until FROM login_attempts",
      );
      expect(state?.failed_count).toBe(count);
      expect(result.locked).toBe(count === 3);
      expect(Boolean(state?.locked_until)).toBe(count === 3);
    }
    const blocked = await authenticate(env.DB, env, "Member", originalPassword);
    expect(blocked).toEqual({ locked: true });
    const blockedResponse = await handleApi(
      request("/api/auth/login", "POST", undefined, {
        display_name: "Member",
        password: originalPassword,
      }),
      env,
    );
    expect(blockedResponse.status).toBe(429);
    expect(row("SELECT * FROM sessions")).toBeUndefined();
    expect(
      row<{ failed_count: number }>("SELECT failed_count FROM login_attempts")
        ?.failed_count,
    ).toBe(3);
  });

  it("starts a new failure series after lock expiry and clears failures on success", async () => {
    setup();
    for (let i = 0; i < 3; i++)
      await authenticate(env.DB, env, "Member", "wrong");
    sqlite.exec(
      "UPDATE login_attempts SET locked_until = '2000-01-01T00:00:00.000Z'",
    );
    expect(await authenticate(env.DB, env, "Member", "wrong")).toEqual({
      locked: false,
    });
    expect(
      row<{ failed_count: number; locked_until: string | null }>(
        "SELECT failed_count, locked_until FROM login_attempts",
      ),
    ).toMatchObject({ failed_count: 1, locked_until: null });
    const result = await authenticate(env.DB, env, "Member", originalPassword);
    expect(result.user?.id).toBe("member-id");
    expect(row("SELECT * FROM login_attempts")).toBeUndefined();
  });

  it("stores only a session token hash and accepts a valid session", async () => {
    setup();
    const login = await handleApi(
      request("/api/auth/login", "POST", undefined, {
        display_name: "Member",
        password: originalPassword,
      }),
      env,
    );
    expect(login.status).toBe(200);
    const sessionCookie = cookie(login);
    const token = sessionCookie.split("=")[1];
    const stored = row<{ token_hash: string }>(
      "SELECT token_hash FROM sessions",
    );
    expect(stored?.token_hash).toBe(await sha256(token));
    expect(stored?.token_hash).not.toBe(token);
    expect(
      (await handleApi(request("/api/auth/session", "GET", sessionCookie), env))
        .status,
    ).toBe(200);
  });

  it("rejects expired and revoked sessions", async () => {
    setup();
    const expired = await issueSession(env.DB, "member-id", env);
    sqlite
      .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .run("2000-01-01T00:00:00.000Z", await sha256(expired));
    expect(
      (
        await handleApi(
          request("/api/auth/session", "GET", `${COOKIE}=${expired}`),
          env,
        )
      ).status,
    ).toBe(401);
    const revoked = await issueSession(env.DB, "member-id", env);
    sqlite
      .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
      .run(new Date().toISOString(), await sha256(revoked));
    expect(
      (
        await handleApi(
          request("/api/auth/session", "GET", `${COOKIE}=${revoked}`),
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("atomically changes the password, invalidates every old session, and issues a new one", async () => {
    setup();
    const oldToken = await issueSession(env.DB, "member-id", env);
    const otherToken = await issueSession(env.DB, "member-id", env);
    const response = await handleApi(
      request("/api/auth/password", "POST", `${COOKIE}=${oldToken}`, {
        current_password: originalPassword,
        new_password: changedPassword,
      }),
      env,
    );
    expect(response.status).toBe(200);
    for (const token of [oldToken, otherToken])
      expect(
        (
          await handleApi(
            request("/api/auth/session", "GET", `${COOKIE}=${token}`),
            env,
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await handleApi(
          request("/api/auth/session", "GET", cookie(response)),
          env,
        )
      ).status,
    ).toBe(200);
    const stored = row<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = 'member-id'",
    );
    expect(await verifyPassword(changedPassword, stored!.password_hash)).toBe(
      true,
    );
    expect(await verifyPassword(originalPassword, stored!.password_hash)).toBe(
      false,
    );
    expect(
      row<{ count: number }>("SELECT count(*) AS count FROM sessions")?.count,
    ).toBe(1);
  });

  it("rolls back password and session invalidation if new session insertion fails", async () => {
    setup();
    const oldToken = await issueSession(env.DB, "member-id", env);
    sqlite.exec(
      "CREATE TRIGGER fail_new_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleApi(
        request("/api/auth/password", "POST", `${COOKIE}=${oldToken}`, {
          current_password: originalPassword,
          new_password: changedPassword,
        }),
        env,
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    } finally {
      logged.mockRestore();
    }
    expect(
      row<{ password_hash: string }>("SELECT password_hash FROM users")
        ?.password_hash,
    ).toBe(originalHash);
    expect(
      (
        await handleApi(
          request("/api/auth/session", "GET", `${COOKIE}=${oldToken}`),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      row<{ count: number }>("SELECT count(*) AS count FROM sessions")?.count,
    ).toBe(1);
  });

  it("enforces Terms before a protected API and permits access after acceptance", async () => {
    setup();
    sqlite
      .prepare(
        "INSERT INTO terms_versions (version, body, requires_reconsent, is_current, created_at) VALUES (?, ?, 1, 1, ?)",
      )
      .run("test-v1", "Test terms", "now");
    const token = await issueSession(env.DB, "member-id", env);
    const sessionCookie = `${COOKIE}=${token}`;
    const before = await handleApi(
      request("/api/me", "GET", sessionCookie),
      env,
    );
    expect(before.status).toBe(403);
    expect(await before.json()).toMatchObject({
      error: { code: "TERMS_REQUIRED" },
    });
    expect(
      (
        await handleApi(
          request("/api/terms/accept", "POST", sessionCookie, {
            version: "test-v1",
            agree: true,
          }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (await handleApi(request("/api/me", "GET", sessionCookie), env)).status,
    ).toBe(200);
  });

  it("rejects cross-origin mutation without altering migrated SQLite", async () => {
    setup();
    const response = await handleApi(
      request(
        "/api/auth/login",
        "POST",
        undefined,
        {
          display_name: "Member",
          password: originalPassword,
        },
        "https://other.test",
      ),
      env,
    );
    expect(response.status).toBe(403);
    expect(row("SELECT * FROM sessions")).toBeUndefined();
    expect(row("SELECT * FROM login_attempts")).toBeUndefined();
  });
});
