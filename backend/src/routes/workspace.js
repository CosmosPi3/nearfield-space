const express = require('express');
const workspaceService = require('../services/workspaceService');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    res.json(workspaceService.getWorkspace());
  } catch (err) {
    next(err);
  }
});

router.post('/nodes', (req, res, next) => {
  try {
    const { id, kind, viaId, cosineScore } = req.body || {};
    workspaceService.addNode({ id, kind, viaId, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/discoveries', (req, res, next) => {
  try {
    const { childId, parentId, similarity, cosineScore } = req.body || {};
    workspaceService.addDiscovery({ childId, parentId, similarity, cosineScore });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/nodes/:id/similarity', (req, res, next) => {
  try {
    workspaceService.setSimilarity(req.params.id, req.body?.similarity);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/nodes/:id', (req, res, next) => {
  try {
    const result = workspaceService.removeNode(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/', (req, res, next) => {
  try {
    res.json(workspaceService.clearWorkspace());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
