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
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_extraction_status ON tracks(extraction_status);

-- Persistent workspace graph state (which tracks are in the user's current
-- exploration, their role, and discovery provenance), scoped per device so
-- each browser/device gets its own independent Discover session. No FK
-- enforcement -- this DB runs with foreign_keys OFF, and a node must be
-- persistable the instant it's added client-side, before any matching
-- `tracks` row necessarily exists yet.
CREATE TABLE IF NOT EXISTS workspace_nodes (
  device_id     TEXT NOT NULL,
  id            TEXT NOT NULL REFERENCES tracks(id),      -- not enforced; documentation only
  kind          TEXT NOT NULL CHECK(kind IN ('seed','discovered')),
  via_id        TEXT REFERENCES workspace_nodes(id),      -- frontier node this was discovered via; NULL for seeds
  similarity    REAL,                                     -- discovered-via cosine score at discovery time
  cosine_score  REAL,                                     -- cosine.club's own score, captured at add-time
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_nodes_via_id ON workspace_nodes(device_id, via_id);

-- Many-to-many discovery relationships -- a track can be surfaced by more than
-- one independent discovery run (from different pinned seeds), unlike
-- workspace_nodes.via_id above which only ever records the first. That
-- column is kept as-is (still means "primary parent") for backward
-- compatibility; this table is the full picture.
CREATE TABLE IF NOT EXISTS workspace_discoveries (
  device_id     TEXT NOT NULL,
  child_id      TEXT NOT NULL REFERENCES workspace_nodes(id),
  parent_id     TEXT NOT NULL REFERENCES workspace_nodes(id),
  similarity    REAL,        -- our own texture cosine score for this specific edge
  cosine_score  REAL,        -- cosine.club's own score for this specific edge, captured at discovery time
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, child_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_discoveries_parent_id ON workspace_discoveries(device_id, parent_id);

-- Idempotent backfill so every via_id relationship that existed before this
-- table was added is reflected here too -- re-run harmlessly every boot.
INSERT INTO workspace_discoveries (device_id, child_id, parent_id, similarity, cosine_score, discovered_at)
SELECT device_id, id, via_id, similarity, cosine_score, added_at
FROM workspace_nodes
WHERE via_id IS NOT NULL
ON CONFLICT(device_id, child_id, parent_id) DO NOTHING;

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
