const express = require('express');
const workspaceService = require('../services/workspaceService');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    res.json(workspaceService.getWorkspace(req.userId));
  } catch (err) {
    next(err);
  }
});

router.post('/nodes', (req, res, next) => {
  try {
    const { id, kind, viaId, cosineScore } = req.body || {};
    workspaceService.addNode(req.userId, { id, kind, viaId, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/discoveries', (req, res, next) => {
  try {
    const { childId, parentId, similarity, cosineScore } = req.body || {};
    workspaceService.addDiscovery(req.userId, { childId, parentId, similarity, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/nodes/:id/similarity', (req, res, next) => {
  try {
    workspaceService.setSimilarity(req.userId, req.params.id, req.body?.similarity);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/nodes/:id', (req, res, next) => {
  try {
    const result = workspaceService.removeNode(req.userId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/', (req, res, next) => {
  try {
    res.json(workspaceService.clearWorkspace(req.userId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
