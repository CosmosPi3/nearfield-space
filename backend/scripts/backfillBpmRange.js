#!/usr/bin/env node
// One-off retroactive fix: fold every already-analyzed track's tempo_bpm into
// the configured BPM_RANGE_MIN/MAX (Rekordbox-style doubling/halving), keeping
// the original raw estimate in raw_tempo_bpm. Clears the distance cache if any
// track's BPM actually changed — the global standardizer is population-wide,
// so a single track's BPM change can shift every pair's cosine score, not
// just pairs touching that track. Run with the server stopped.
// Usage: node scripts/backfillBpmRange.js
const db = require('../src/db');
const { normalizeBpmToRange } = require('../src/utils/bpmRange');
const { computeEnergyValence } = require('../src/services/featureExtractor');
const { BPM_RANGE_MIN, BPM_RANGE_MAX, VECTOR_DIMENSIONS } = require('../src/config');
const distanceService = require('../src/services/distanceService');

const TEMPO_IDX = VECTOR_DIMENSIONS.indexOf('tempoBpm');

function main() {
  const rows = db.getOkTracksForBpmBackfill();
  let changed = 0;
  let skipped = 0;

  db.db.transaction(() => {
    for (const row of rows) {
      if (row.tempo_bpm == null) {
        skipped += 1;
        continue;
      }

      const rawAlreadySet = row.raw_tempo_bpm != null;
      const raw = rawAlreadySet ? row.raw_tempo_bpm : row.tempo_bpm;
      const normalized = normalizeBpmToRange(raw, BPM_RANGE_MIN, BPM_RANGE_MAX);
      const bpmChanged = normalized !== row.tempo_bpm;

      if (rawAlreadySet && !bpmChanged) {
        skipped += 1;
        continue;
      }

      const vector = JSON.parse(row.vector_json);
      vector[TEMPO_IDX] = normalized;
      const energyValence = computeEnergyValence(normalized, row.rms_mean, row.spectral_centroid_mean);

      db.updateTrackBpmFields({
        id: row.id,
        tempoBpm: normalized,
        rawTempoBpm: raw,
        vectorJson: JSON.stringify(vector),
        energyValence,
      });

      if (bpmChanged) {
        changed += 1;
        console.log(`${row.id}: ${raw.toFixed(1)} -> ${normalized.toFixed(1)}`);
      }
    }
  })();

  console.log(`\n${changed}/${rows.length} tracks had tempo_bpm changed into [${BPM_RANGE_MIN}, ${BPM_RANGE_MAX}] (${skipped} already up to date).`);

  if (changed > 0) {
    const cleared = distanceService.clearDistanceCache().cleared;
    console.log(`Cleared ${cleared} cached distance(s) — they'll repopulate lazily on next use (e.g. next library view).`);
  } else {
    console.log('No BPM changes — distance cache left untouched.');
  }

  console.log('\nNote: workspace_nodes.similarity / workspace_discoveries.similarity are point-in-time snapshots and are not refreshed by this script (pre-existing behavior).');
}

main();
