const Bottleneck = require('bottleneck');
const { DISCOGS_RATE_LIMIT_PER_MIN } = require('../config');

// Same reservoir-based smoothing as rateLimiter.js, sized to Discogs'
// authenticated per-key rate limit instead of cosine.club's.
const limiter = new Bottleneck({
  reservoir: DISCOGS_RATE_LIMIT_PER_MIN,
  reservoirRefreshAmount: DISCOGS_RATE_LIMIT_PER_MIN,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 5,
});

module.exports = limiter;
