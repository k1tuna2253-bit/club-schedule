import type { Env } from "./types";

export const PERMISSIONS = [
  "SCHEDULE_VIEW",
  "SCHEDULE_CREATE_SELF",
  "SCHEDULE_EDIT_SELF",
  "SCHEDULE_DELETE_SELF",
  "SCHEDULE_CREATE_OTHERS",
  "SCHEDULE_EDIT_OTHERS",
  "SCHEDULE_DELETE_OTHERS",
  "EVENT_VIEW",
  "EVENT_CREATE",
  "EVENT_EDIT",
  "EVENT_DELETE",
  "EVENT_RESPONSE_MANAGE",
  "EVENT_COMMENT_VIEW",
  "USER_MANAGE",
  "USER_PASSWORD_RESET",
  "LOCATION_MANAGE",
  "CALENDAR_MANAGE",
  "RESTRICTION_MANAGE",
  "ROLE_MANAGE",
  "ANALYTICS_VIEW",
  "SEARCH_USE",
  "AUDIT_LOG_VIEW",
  "NOTIFICATION_MANAGE",
  "BACKUP_RESTORE",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export async function effectivePermissions(
  db: D1Database,
  userId: string,
): Promise<Set<Permission>> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT rp.permission_key AS key FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = ?`,
    )
    .bind(userId)
    .all<{ key: Permission }>();
  return new Set(rows.results.map((row) => row.key));
}

export function hasPermission(
  granted: ReadonlySet<Permission>,
  required: Permission,
): boolean {
  return granted.has(required);
}

// Call inside the same D1 batch as any future Role or user assignment mutation.
// The SQL assertion fails the batch and rolls it back if it would remove the final holder.
export function lastRoleManagerGuard(db: Env["DB"]): D1PreparedStatement {
  return db.prepare(`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE u.status = 'active' AND rp.permission_key = 'ROLE_MANAGE'
  ) THEN 1 ELSE json_extract('invalid', '$') END`);
}
