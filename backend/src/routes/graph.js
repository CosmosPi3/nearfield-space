const express = require('express');
const db = require('../db');
const distanceService = require('../services/distanceService');

const router = express.Router();
const DEFAULT_THRESHOLD = 0.75;

// getBatchDistances hard-caps at MAX_BATCH_IDS (2000, see distanceService.js)
// — plenty of headroom past today's catalog, but this is still where that
// cap will need raising again once the catalog grows past it.
router.get('/library', (req, res, next) => {
  try {
    const threshold = req.query.threshold !== undefined ? parseFloat(req.query.threshold) : DEFAULT_THRESHOLD;
    const tracks = db.getAllOkTracks();
    if (tracks.length < 2) {
      return res.json({ tracks, edges: [], populationSize: tracks.length });
    }

    const { pairs, populationSize } = distanceService.getBatchDistances(tracks.map((t) => t.id), threshold);
    const edges = pairs.map((p) => ({ source: p.trackAId, target: p.trackBId, cosineScore: p.cosineScore }));
    res.json({ tracks, edges, populationSize });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
