const db = require('../db');
const { AppError } = require('../utils/errors');

function assertTrackId(trackId) {
  if (typeof trackId !== 'string' || !trackId.trim()) {
    throw new AppError('BAD_REQUEST', 'trackId is required');
  }
}

function getFavorites(userId) {
  return db.getFavoriteTrackIds(userId);
}

function addFavorite(userId, trackId) {
  assertTrackId(trackId);
  db.insertFavorite(userId, trackId);
}

function removeFavorite(userId, trackId) {
  assertTrackId(trackId);
  db.deleteFavorite(userId, trackId);
}

module.exports = { getFavorites, addFavorite, removeFavorite };
