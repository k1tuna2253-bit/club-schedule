import {
  authenticate,
  clearCookie,
  cookieHeader,
  currentUser,
  issueSession,
  replacePasswordAndSessions,
  revokeSession,
  sessionDays,
} from "./auth";
import { hashPassword, verifyPassword } from "./crypto";
import { effectivePermissions } from "./permissions";
import { currentTerms, needsTerms } from "./terms";
import type { Env, PublicUser, UserRow } from "./types";

type JsonRecord = Record<string, unknown>;

function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

async function body(request: Request): Promise<JsonRecord | null> {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return null;
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return null;
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function publicUser(user: UserRow): PublicUser {
  const { password_hash: _passwordHash, ...safe } = user;
  void _passwordHash;
  return safe;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 80
  );
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (!path.startsWith("/api/"))
    return error(404, "NOT_FOUND", "見つかりません。");
  if (!["GET", "POST", "PATCH"].includes(method))
    return error(405, "METHOD_NOT_ALLOWED", "この操作は利用できません。");
  if (method !== "GET" && !sameOrigin(request))
    return error(403, "ORIGIN", "操作を確認できません。");

  try {
    if (path === "/api/auth/login" && method === "POST") {
      const input = await body(request);
      if (
        !input ||
        !validName(input.display_name) ||
        typeof input.password !== "string" ||
        input.password.length < 1 ||
        input.password.length > 1024
      )
        return error(400, "VALIDATION", "入力内容を確認してください。");
      const result = await authenticate(
        env.DB,
        env,
        input.display_name,
        input.password,
      );
      if (!result.user)
        return result.locked
          ? error(429, "LOCKED", "しばらくしてから再試行してください。")
          : error(
              401,
              "INVALID_CREDENTIALS",
              "表示名またはパスワードが違います。",
            );
      const token = await issueSession(env.DB, result.user.id, env);
      const terms = await currentTerms(env.DB);
      return json(
        {
          data: {
            user: publicUser(result.user),
            termsRequired: terms ? needsTerms(result.user, terms) : true,
            setupRequired: !terms,
          },
        },
        200,
        { "Set-Cookie": cookieHeader(token, sessionDays(env) * 86_400) },
      );
    }

    const user = await currentUser(request, env.DB);
    if (!user) return error(401, "UNAUTHENTICATED", "ログインしてください。");

    if (path === "/api/auth/logout" && method === "POST") {
      await revokeSession(request, env.DB);
      return json({ data: { ok: true } }, 200, { "Set-Cookie": clearCookie() });
    }

    if (path === "/api/auth/password" && method === "POST") {
      const input = await body(request);
      if (
        !input ||
        typeof input.current_password !== "string" ||
        typeof input.new_password !== "string" ||
        input.new_password.length < 8 ||
        input.new_password.length > 1024
      )
        return error(
          400,
          "VALIDATION",
          "パスワードは8文字以上にしてください。",
        );
      if (!(await verifyPassword(input.current_password, user.password_hash)))
        return error(403, "INVALID_PASSWORD", "現在のパスワードが違います。");
      const nextHash = await hashPassword(input.new_password);
      const token = await replacePasswordAndSessions(
        env.DB,
        user.id,
        nextHash,
        env,
      );
      return json({ data: { ok: true } }, 200, {
        "Set-Cookie": cookieHeader(token, sessionDays(env) * 86_400),
      });
    }

    const terms = await currentTerms(env.DB);
    if (path === "/api/terms/current" && method === "GET") {
      if (!terms)
        return error(503, "TERMS_NOT_CONFIGURED", "利用規約の準備中です。");
      return json({ data: { ...terms, accepted: !needsTerms(user, terms) } });
    }
    if (path === "/api/auth/session" && method === "GET") {
      return json({
        data: {
          user: publicUser(user),
          termsRequired: terms ? needsTerms(user, terms) : true,
          setupRequired: !terms,
        },
      });
    }
    if (!terms)
      return error(503, "TERMS_NOT_CONFIGURED", "利用規約の準備中です。");
    if (path === "/api/terms/accept" && method === "POST") {
      const input = await body(request);
      if (!input || input.version !== terms.version || input.agree !== true)
        return error(409, "TERMS_VERSION", "利用規約を再確認してください。");
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE users SET terms_version_accepted = ?, terms_accepted_at = ?, updated_at = ? WHERE id = ?",
      )
        .bind(terms.version, now, now, user.id)
        .run();
      return json({ data: { accepted: true, version: terms.version } });
    }
    if (needsTerms(user, terms))
      return error(403, "TERMS_REQUIRED", "利用規約への同意が必要です。");

    if (path === "/api/me" && method === "GET") {
      const permissions = await effectivePermissions(env.DB, user.id);
      return json({
        data: { user: publicUser(user), permissions: [...permissions] },
      });
    }
    if (path === "/api/me" && method === "PATCH") {
      const input = await body(request);
      if (
        !input ||
        Object.keys(input).some(
          (key) =>
            !["display_name", "grade", "primary_campus_id"].includes(key),
        ) ||
        Object.keys(input).length === 0
      )
        return error(400, "VALIDATION", "入力内容を確認してください。");
      if (input.display_name !== undefined && !validName(input.display_name))
        return error(400, "VALIDATION", "表示名を確認してください。");
      if (
        input.grade !== undefined &&
        (!Number.isInteger(input.grade) || Number(input.grade) < 1)
      )
        return error(400, "VALIDATION", "学年を確認してください。");
      if (
        input.primary_campus_id !== undefined &&
        !["omiya", "hirakata"].includes(String(input.primary_campus_id))
      )
        return error(400, "VALIDATION", "キャンパスを確認してください。");
      const now = new Date().toISOString();
      try {
        await env.DB.prepare(
          "UPDATE users SET display_name = ?, grade = ?, primary_campus_id = ?, updated_at = ? WHERE id = ?",
        )
          .bind(
            input.display_name === undefined
              ? user.display_name
              : String(input.display_name).trim(),
            input.grade ?? user.grade,
            input.primary_campus_id ?? user.primary_campus_id,
            now,
            user.id,
          )
          .run();
      } catch {
        return error(409, "NAME_TAKEN", "この表示名は使用されています。");
      }
      const updated = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
        .bind(user.id)
        .first<UserRow>();
      return json({ data: { user: publicUser(updated!) } });
    }
    return error(404, "NOT_FOUND", "見つかりません。");
  } catch (cause) {
    console.error("API failure", cause);
    return error(500, "INTERNAL", "処理できませんでした。");
  }
}
