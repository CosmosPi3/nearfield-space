const express = require('express');
const authService = require('../services/authService');
const { AppError } = require('../utils/errors');

const router = express.Router();

router.post('/google', async (req, res, next) => {
  try {
    const payload = await authService.verifyGoogleIdToken(req.body?.idToken);
    const user = authService.findOrCreateUser(payload);
    const token = authService.createSessionForUser(user.id);
    res.json({ token, user: authService.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (token) authService.logout(token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', (req, res, next) => {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const user = token ? authService.getUserForToken(token) : null;
    if (!user) throw new AppError('UNAUTHORIZED', 'Not signed in');
    res.json({ user: authService.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.patch('/display-name', (req, res, next) => {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const user = token ? authService.getUserForToken(token) : null;
    if (!user) throw new AppError('UNAUTHORIZED', 'Not signed in');
    const updated = authService.updateDisplayName(user.id, req.body?.displayName);
    res.json({ user: authService.toPublicUser(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
