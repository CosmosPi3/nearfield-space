const express = require('express');
const cosineClient = require('../services/cosineClient');
const { AppError } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) throw new AppError('BAD_REQUEST', 'Query parameter "url" is required');
    const results = await cosineClient.lookupByUrl(url);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
