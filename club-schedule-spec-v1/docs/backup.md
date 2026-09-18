# Backup and Restore Specification

## Schedule

Application-level exported backup: - every Monday at 03:00 Asia/Tokyo

Do not use GitHub as backup storage.

## Storage

Use Cloudflare R2 or equivalent separate object storage for exported
backups. Event attachments also use R2 but should be logically separated
from backup objects.

## Retention

Requirements discussed: - standard rotating backups: 6 months - normal
data retention: 5 years - long-term recovery coverage desired up to 5
years

The exact long-term snapshot cadence beyond the 6-month weekly rotation
remains TBD. Do not create an expensive daily/weekly five-year retention
policy without approval.

## Security

-   private buckets/objects
-   no public backup URLs
-   least-privilege access
-   encryption at rest from provider plus application/export encryption
    if selected
-   encryption keys separated from backup objects and never committed to
    Git
-   restore operation gated by `BACKUP_RESTORE`
-   extra/double confirmation

Verify current Cloudflare R2/D1 recovery capabilities before
implementation.

## Restore

Restore must be treated as a high-impact maintenance operation.

After restoring historical data and before making the restored system
available: 1. apply the deletion/anonymization registry/process, 2.
ensure deleted identities remain anonymized, 3. validate schema/version,
4. validate permissions and last `ROLE_MANAGE` invariant, 5. invalidate
unsafe sessions if appropriate, 6. run integrity checks.

Restore notification is sent according to notification policy. It is not
mandatory over user preferences unless classified as a security
notification.

Audit backup restore actions.
