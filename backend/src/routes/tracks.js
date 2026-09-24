const express = require('express');
const cosineClient = require('../services/cosineClient');
const featuresService = require('../services/featuresService');
const distanceService = require('../services/distanceService');
const { AppError } = require('../utils/errors');
const { manualTrackLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// For tracks not in cosine.club's catalog — extracts directly from a
// YouTube/Bandcamp/SoundCloud URL, bypassing cosine.club entirely.
router.post('/manual', manualTrackLimiter, async (req, res, next) => {
  try {
    const url = (req.body?.url || '').trim();
    if (!url) throw new AppError('BAD_REQUEST', 'Body field "url" is required');
    const result = await featuresService.addManualTrack(url);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const track = await cosineClient.getTrack(req.params.id);
    if (!track) throw new AppError('NOT_FOUND', `Track ${req.params.id} not found`);
    res.json(track);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/similar', async (req, res, next) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const result = await cosineClient.getSimilar(req.params.id);
    if (!result) throw new AppError('NOT_FOUND', `Track ${req.params.id} not found`);
    res.json({
      sourceTrack: result.sourceTrack,
      similarTracks: result.similarTracks.slice(0, limit),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/features', async (req, res, next) => {
  try {
    const refresh = req.query.refresh === '1';
    const result = await featuresService.getFeatures(req.params.id, { refresh });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Ranks this track against every other successfully-analyzed track in our
// own cache — the discovery path for tracks with no cosine.club id to ask
// "/similar" about (e.g. manually-added ones).
router.get('/:id/nearest', (req, res, next) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const result = distanceService.getNearestTracks(req.params.id, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
