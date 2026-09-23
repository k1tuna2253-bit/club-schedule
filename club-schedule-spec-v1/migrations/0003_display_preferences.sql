CREATE TABLE user_display_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL CHECK (week_start IN ('sunday', 'monday'))
);
