const Bottleneck = require('bottleneck');
const { COSINE_RATE_LIMIT_PER_MIN } = require('../config');

// Spreads calls across the 120/min cosine.club budget instead of hard-failing
// on bursts (e.g. a wide discovery run). maxConcurrent keeps us from firing
// a huge batch simultaneously even when reservoir capacity is available.
const limiter = new Bottleneck({
  reservoir: COSINE_RATE_LIMIT_PER_MIN,
  reservoirRefreshAmount: COSINE_RATE_LIMIT_PER_MIN,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 5,
});

module.exports = limiter;
