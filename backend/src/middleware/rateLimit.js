const rateLimit = require('express-rate-limit');

// Blanket safety net across the whole API surface — generous enough that
// normal personal use never hits it.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limit on the one route that spawns a real yt-dlp child process per
// request — bounds how many concurrent extractions a single client can force.
const manualTrackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, manualTrackLimiter };
