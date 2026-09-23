CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX locations_campus_active_idx ON locations(campus_id, active, name);

CREATE TABLE class_periods (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  period_number INTEGER NOT NULL CHECK (period_number > 0),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  effective_from TEXT NOT NULL DEFAULT '0001-01-01',
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_time < end_time),
  CHECK (effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (campus_id, period_number, effective_from)
);
CREATE INDEX class_periods_lookup_idx ON class_periods(campus_id, period_number, effective_from, effective_to);
INSERT INTO class_periods (id, campus_id, period_number, start_time, end_time, created_at, updated_at) VALUES
('omiya-1','omiya',1,'09:10','10:50','seed','seed'),
('omiya-2','omiya',2,'11:00','12:40','seed','seed'),
('omiya-3','omiya',3,'13:30','15:10','seed','seed'),
('omiya-4','omiya',4,'15:20','17:00','seed','seed'),
('omiya-5','omiya',5,'17:10','18:00','seed','seed'),
('omiya-6','omiya',6,'19:00','20:40','seed','seed'),
('hirakata-1','hirakata',1,'09:10','10:50','seed','seed'),
('hirakata-2','hirakata',2,'11:00','12:40','seed','seed'),
('hirakata-3','hirakata',3,'13:30','15:10','seed','seed'),
('hirakata-4','hirakata',4,'15:20','17:00','seed','seed'),
('hirakata-5','hirakata',5,'17:10','18:00','seed','seed');

CREATE TABLE japanese_holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE holiday_import_years (
  year INTEGER PRIMARY KEY,
  imported_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0)
);

CREATE TABLE university_closure_periods (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX closures_campus_dates_idx ON university_closure_periods(campus_id, start_date, end_date);

CREATE TABLE university_calendar_overrides (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('teaching', 'no_school')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campus_id, date)
);
CREATE INDEX overrides_campus_date_idx ON university_calendar_overrides(campus_id, date);

CREATE TABLE recurrence_series (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  cancelled_from TEXT,
  weekdays TEXT NOT NULL,
  predecessor_id TEXT REFERENCES recurrence_series(id),
  created_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX recurrence_range_idx ON recurrence_series(user_id, start_date, end_date);
CREATE INDEX recurrence_calendar_range_idx ON recurrence_series(start_date, end_date);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('omiya', 'hirakata', 'common')),
  clock_start TEXT,
  clock_end TEXT,
  memo TEXT,
  memo_visibility TEXT NOT NULL DEFAULT 'everyone' CHECK (memo_visibility IN ('everyone', 'private')),
  kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single', 'template', 'exception')),
  recurrence_series_id TEXT REFERENCES recurrence_series(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (clock_end IS NULL OR (clock_start IS NOT NULL AND clock_start < clock_end))
);
CREATE INDEX schedules_date_user_idx ON schedules(date, user_id);
CREATE INDEX schedules_user_date_idx ON schedules(user_id, date);
CREATE INDEX schedules_scope_date_idx ON schedules(scope, date);
CREATE INDEX schedules_series_idx ON schedules(recurrence_series_id);

CREATE TABLE schedule_periods (
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  period_number INTEGER NOT NULL CHECK (period_number > 0),
  PRIMARY KEY (schedule_id, campus_id, period_number)
);
CREATE TABLE schedule_locations (
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id),
  PRIMARY KEY (schedule_id, location_id)
);
CREATE INDEX schedule_locations_location_idx ON schedule_locations(location_id, schedule_id);

CREATE TABLE recurrence_exceptions (
  series_id TEXT NOT NULL REFERENCES recurrence_series(id),
  occurrence_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'replace')),
  replacement_schedule_id TEXT REFERENCES schedules(id),
  PRIMARY KEY (series_id, occurrence_date),
  CHECK ((action = 'replace') = (replacement_schedule_id IS NOT NULL))
);
CREATE INDEX recurrence_exceptions_date_idx ON recurrence_exceptions(occurrence_date, series_id);

CREATE TABLE restrictions (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  clock_start TEXT,
  clock_end TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  CHECK (start_date <= end_date),
  CHECK ((clock_start IS NULL AND clock_end IS NULL) OR
         (clock_start IS NOT NULL AND clock_end IS NOT NULL AND clock_start < clock_end))
);
CREATE INDEX restrictions_range_idx ON restrictions(campus_id, start_date, end_date, removed_at);
CREATE INDEX restrictions_schedule_date_idx ON restrictions(start_date, end_date, removed_at);
CREATE INDEX restrictions_lineage_idx ON restrictions(lineage_id);
CREATE TABLE restriction_periods (
  restriction_id TEXT NOT NULL REFERENCES restrictions(id),
  period_number INTEGER NOT NULL CHECK (period_number > 0),
  PRIMARY KEY (restriction_id, period_number)
);
CREATE TABLE restriction_locations (
  restriction_id TEXT NOT NULL REFERENCES restrictions(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  PRIMARY KEY (restriction_id, location_id)
);
CREATE INDEX restriction_locations_location_idx ON restriction_locations(location_id, restriction_id);
