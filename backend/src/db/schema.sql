CREATE TABLE IF NOT EXISTS tracks (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  artist                 TEXT,
  track                  TEXT,
  video_id               TEXT,
  external_link          TEXT,
  source                 TEXT,
  view_count             INTEGER,
  extraction_status      TEXT NOT NULL DEFAULT 'pending', -- pending | ok | failed
  last_error             TEXT,
  spectral_centroid_mean REAL,
  spectral_flatness_mean REAL,
  tempo_bpm              REAL,
  raw_tempo_bpm          REAL,
  rms_mean               REAL,
  rms_var                REAL,
  energy_valence         REAL,
  features_json          TEXT,
  vector_json            TEXT,
  extracted_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  -- Permanent "first discoverer" credit -- set once, on this row's very
  -- first INSERT, and deliberately excluded from the upsert's ON CONFLICT
  -- DO UPDATE clause (see db/index.js) so it can never be reassigned by a
  -- later re-extraction. NULL only for tracks extracted before this column
  -- existed, until backfillDiscoveredBy(userId) is run once.
  discovered_by_user_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tracks_extraction_status ON tracks(extraction_status);

-- Registered accounts, keyed on Google's stable per-account subject id.
-- display_name is public-facing (shown in the library "discovered by" credit
-- and any future leaderboard) and deliberately not the user's full name --
-- computed once at signup as "{given_name} {family_name-initial}." with a
-- numeric suffix on collision -- see authService.js.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT,
  given_name    TEXT,
  family_name   TEXT,
  display_name  TEXT NOT NULL UNIQUE,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bearer session tokens (opaque random strings, never JWTs) -- looked up on
-- every authenticated request by requireAuth middleware. No expiry logic yet;
-- add one if/when it matters.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Persistent workspace graph state (which tracks are in the user's current
-- exploration, their role, and discovery provenance), scoped per account so
-- each user gets their own independent Discover session. No FK
-- enforcement -- this DB runs with foreign_keys OFF, and a node must be
-- persistable the instant it's added client-side, before any matching
-- `tracks` row necessarily exists yet.
CREATE TABLE IF NOT EXISTS workspace_nodes (
  user_id       INTEGER NOT NULL,
  id            TEXT NOT NULL REFERENCES tracks(id),      -- not enforced; documentation only
  kind          TEXT NOT NULL CHECK(kind IN ('seed','discovered')),
  via_id        TEXT REFERENCES workspace_nodes(id),      -- frontier node this was discovered via; NULL for seeds
  similarity    REAL,                                     -- discovered-via cosine score at discovery time
  cosine_score  REAL,                                     -- cosine.club's own score, captured at add-time
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_nodes_via_id ON workspace_nodes(user_id, via_id);

-- Many-to-many discovery relationships -- a track can be surfaced by more than
-- one independent discovery run (from different pinned seeds), unlike
-- workspace_nodes.via_id above which only ever records the first. That
-- column is kept as-is (still means "primary parent") for backward
-- compatibility; this table is the full picture.
CREATE TABLE IF NOT EXISTS workspace_discoveries (
  user_id       INTEGER NOT NULL,
  child_id      TEXT NOT NULL REFERENCES workspace_nodes(id),
  parent_id     TEXT NOT NULL REFERENCES workspace_nodes(id),
  similarity    REAL,        -- our own texture cosine score for this specific edge
  cosine_score  REAL,        -- cosine.club's own score for this specific edge, captured at discovery time
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, child_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_discoveries_parent_id ON workspace_discoveries(user_id, parent_id);

-- A user's favourited tracks. Unlike workspace_nodes/workspace_discoveries
-- this isn't tied to any one Discover session -- it's a durable, global
-- per-account set, so it has no relationship to device/session scoping at
-- all beyond being keyed on user_id.
CREATE TABLE IF NOT EXISTS favorites (
  user_id     INTEGER NOT NULL,
  track_id    TEXT NOT NULL REFERENCES tracks(id), -- not enforced; documentation only, same stance as workspace_nodes.id
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, track_id)
);

-- Idempotent backfill so every via_id relationship that existed before this
-- table was added is reflected here too -- re-run harmlessly every boot.
INSERT INTO workspace_discoveries (user_id, child_id, parent_id, similarity, cosine_score, discovered_at)
SELECT user_id, id, via_id, similarity, cosine_score, added_at
FROM workspace_nodes
WHERE via_id IS NOT NULL
ON CONFLICT(user_id, child_id, parent_id) DO NOTHING;

-- Persistent pairwise texture-similarity cache. A cosine score here is a
-- stable fact about two specific tracks' vectors under the current global
-- standardizer (see distanceService.js) -- NOT scoped to any one graph/
-- browser session. track_a_id/track_b_id are always canonically ordered
-- (string comparison, a < b) so a pair is never stored in both directions.
CREATE TABLE IF NOT EXISTS distances (
  track_a_id      TEXT NOT NULL,
  track_b_id      TEXT NOT NULL,
  cosine_score    REAL NOT NULL,
  population_size INTEGER NOT NULL, -- informational breadcrumb only, never gates cache hits
  computed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (track_a_id, track_b_id),
  CHECK (track_a_id < track_b_id)
);

CREATE INDEX IF NOT EXISTS idx_distances_track_b ON distances(track_b_id);
