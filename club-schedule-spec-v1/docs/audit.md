# Audit Log Specification

Audit logs exist for sensitive/administrative changes, not routine
browsing.

Record examples: - user create/disable/delete/anonymize - password reset
by administrator - Role creation/deletion - Permission changes - user
Role assignment changes - restriction create/edit/delete - event
management actions where administratively significant - proxy
operations - backup restore - other high-impact configuration changes

Do not unnecessarily record ordinary reads or browsing behavior. Do not
store passwords, password hashes, private memo content, full session
tokens or sensitive attachment contents in audit metadata.

Access requires `AUDIT_LOG_VIEW`. Retention: 5 years. Audit entries
should be append-oriented and resistant to ordinary application editing.
