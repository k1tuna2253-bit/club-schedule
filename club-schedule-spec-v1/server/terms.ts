import type { TermsRow, UserRow } from "./types";

export async function currentTerms(db: D1Database): Promise<TermsRow | null> {
  return db
    .prepare(
      "SELECT version, body, requires_reconsent FROM terms_versions WHERE is_current = 1",
    )
    .first<TermsRow>();
}

export function needsTerms(user: UserRow, terms: TermsRow): boolean {
  if (!user.terms_version_accepted) return true;
  return (
    terms.requires_reconsent === 1 &&
    user.terms_version_accepted !== terms.version
  );
}
