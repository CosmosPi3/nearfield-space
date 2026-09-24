const express = require('express');
const distanceService = require('../services/distanceService');

const router = express.Router();

router.get('/:idA/:idB', (req, res, next) => {
  try {
    res.json(distanceService.getPairwiseDistance(req.params.idA, req.params.idB));
  } catch (err) {
    next(err);
  }
});

router.post('/batch', (req, res, next) => {
  try {
    const { ids, threshold } = req.body || {};
    res.json(distanceService.getBatchDistances(ids, threshold));
  } catch (err) {
    next(err);
  }
});

router.delete('/', (req, res, next) => {
  try {
    res.json(distanceService.clearDistanceCache());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
