const express = require('express');
const workspaceService = require('../services/workspaceService');

const router = express.Router();

router.use((req, res, next) => {
  req.deviceId = req.header('X-Device-Id');
  next();
});

router.get('/', (req, res, next) => {
  try {
    res.json(workspaceService.getWorkspace(req.deviceId));
  } catch (err) {
    next(err);
  }
});

router.post('/nodes', (req, res, next) => {
  try {
    const { id, kind, viaId, cosineScore } = req.body || {};
    workspaceService.addNode(req.deviceId, { id, kind, viaId, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/discoveries', (req, res, next) => {
  try {
    const { childId, parentId, similarity, cosineScore } = req.body || {};
    workspaceService.addDiscovery(req.deviceId, { childId, parentId, similarity, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/nodes/:id/similarity', (req, res, next) => {
  try {
    workspaceService.setSimilarity(req.deviceId, req.params.id, req.body?.similarity);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/nodes/:id', (req, res, next) => {
  try {
    const result = workspaceService.removeNode(req.deviceId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/', (req, res, next) => {
  try {
    res.json(workspaceService.clearWorkspace(req.deviceId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
