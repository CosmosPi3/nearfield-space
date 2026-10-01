const express = require('express');
const favoritesService = require('../services/favoritesService');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    res.json({ trackIds: favoritesService.getFavorites(req.userId) });
  } catch (err) {
    next(err);
  }
});

router.post('/:trackId', (req, res, next) => {
  try {
    favoritesService.addFavorite(req.userId, req.params.trackId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:trackId', (req, res, next) => {
  try {
    favoritesService.removeFavorite(req.userId, req.params.trackId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
