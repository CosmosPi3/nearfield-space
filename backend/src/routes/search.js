const express = require('express');
const cosineClient = require('../services/cosineClient');
const { AppError } = require('../utils/errors');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) throw new AppError('BAD_REQUEST', 'Query parameter "q" is required');
    const results = await cosineClient.search(q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
