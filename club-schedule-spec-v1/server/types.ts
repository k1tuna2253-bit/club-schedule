export interface Env {
  DB: D1Database;
  LOGIN_MAX_FAILURES?: string;
  LOGIN_LOCK_MINUTES?: string;
  SESSION_DAYS?: string;
}

export interface UserRow {
  id: string;
  display_name: string;
  password_hash: string;
  grade: number;
  registration_year: number;
  primary_campus_id: string;
  status: "active" | "disabled" | "deleted";
  terms_version_accepted: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TermsRow {
  version: string;
  body: string;
  requires_reconsent: 0 | 1;
}

export type PublicUser = Omit<UserRow, "password_hash">;
