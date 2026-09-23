-- Keep the legacy columns for existing rows, but move their values into the
-- independent memo fields. All new writes use the new columns only.
ALTER TABLE schedules ADD COLUMN private_memo TEXT;
ALTER TABLE schedules ADD COLUMN shared_memo TEXT;
UPDATE schedules SET
  private_memo = CASE WHEN memo_visibility = 'private' THEN memo ELSE NULL END,
  shared_memo = CASE WHEN memo_visibility = 'everyone' THEN memo ELSE NULL END,
  memo = NULL,
  memo_visibility = 'everyone'
WHERE memo IS NOT NULL;
