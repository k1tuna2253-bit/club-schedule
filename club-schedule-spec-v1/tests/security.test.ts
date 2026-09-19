import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { hashPassword, verifyPassword } from "../server/crypto";
import {
  effectivePermissions,
  hasPermission,
  lastRoleManagerGuard,
} from "../server/permissions";
import { needsTerms } from "../server/terms";
import { handleApi } from "../server/api";
import type { Env, UserRow } from "../server/types";

const user: UserRow = {
  id: "immutable-id",
  display_name: "Member",
  password_hash: "hidden",
  grade: 2,
  registration_year: 2025,
  primary_campus_id: "omiya",
  status: "active",
  terms_version_accepted: null,
  terms_accepted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("passwords", () => {
  it("uses a salted versioned hash and verifies the correct password", async () => {
    const hash = await hashPassword("sufficiently long secret");
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$/);
    expect(hash).not.toContain("sufficiently long secret");
    expect(await verifyPassword("sufficiently long secret", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("any", "malformed")).toBe(false);
  });
});

describe("authorization", () => {
  it("merges allow permissions from multiple roles", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              { key: "USER_MANAGE" },
              { key: "ROLE_MANAGE" },
              { key: "USER_MANAGE" },
            ],
          }),
        }),
      }),
    } as unknown as D1Database;
    const permissions = await effectivePermissions(db, user.id);
    expect([...permissions]).toEqual(["USER_MANAGE", "ROLE_MANAGE"]);
    expect(hasPermission(permissions, "ROLE_MANAGE")).toBe(true);
    expect(hasPermission(permissions, "BACKUP_RESTORE")).toBe(false);
  });

  it("blocks protected APIs without authentication", async () => {
    const env = { DB: {} as D1Database } as Env;
    const response = await handleApi(
      new Request("https://example.test/api/me"),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Member");
  });

  it("rejects cross-origin mutation before touching D1", async () => {
    const env = { DB: {} as D1Database } as Env;
    const response = await handleApi(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "https://evil.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ display_name: "Member", password: "password" }),
      }),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("rolls back removal of the final active ROLE_MANAGE holder", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0001_phase1.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite.exec(`INSERT INTO users (id,display_name,password_hash,grade,registration_year,primary_campus_id,created_at,updated_at)
      VALUES ('one','One','hash',1,2026,'omiya','now','now');
      INSERT INTO roles (id,name,created_at,updated_at) VALUES ('manager','Manager','now','now');
      INSERT INTO role_permissions VALUES ('manager','ROLE_MANAGE');
      INSERT INTO user_roles VALUES ('one','manager');`);
    let guardSql = "";
    lastRoleManagerGuard({
      prepare(sql) {
        guardSql = sql;
        return {} as D1PreparedStatement;
      },
    } as D1Database);
    sqlite.exec("BEGIN");
    sqlite.exec("DELETE FROM user_roles WHERE user_id='one'");
    expect(() => sqlite.prepare(guardSql).get()).toThrow();
    sqlite.exec("ROLLBACK");
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM user_roles").get(),
    ).toMatchObject({ count: 1 });
  });
});

describe("terms policy", () => {
  it("requires first acceptance and re-consent only for versions marked so", () => {
    const terms = {
      version: "2",
      body: "approved terms",
      requires_reconsent: 1 as const,
    };
    expect(needsTerms(user, terms)).toBe(true);
    expect(
      needsTerms(
        {
          ...user,
          terms_version_accepted: "1",
          terms_accepted_at: user.created_at,
        },
        terms,
      ),
    ).toBe(true);
    expect(
      needsTerms(
        {
          ...user,
          terms_version_accepted: "2",
          terms_accepted_at: user.created_at,
        },
        terms,
      ),
    ).toBe(false);
    expect(
      needsTerms(
        {
          ...user,
          terms_version_accepted: "1",
          terms_accepted_at: user.created_at,
        },
        { ...terms, requires_reconsent: 0 },
      ),
    ).toBe(false);
  });
});
