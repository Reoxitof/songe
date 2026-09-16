'use strict';

/**
 * routes/panobuilds.js — Builds de panoplie sauvegardés (liés au compte)
 *
 *   GET    /api/pano-builds        → liste des builds de l'utilisateur
 *   POST   /api/pano-builds        → créer un build { name, class, items }
 *   DELETE /api/pano-builds/:id    → supprimer un build
 */

const db              = require('../db');
const express         = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_BUILDS = 50; // garde-fou par utilisateur

function genId() {
  return 'pb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─────────────────────────────────────────────────────────────
// GET /api/pano-builds
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    return res.json(db.panoBuilds.byUser(req.userId));
  } catch (err) {
    console.error('[panobuilds list]', err.message);
    return res.status(500).json({ error: 'Erreur lecture des builds.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/pano-builds   body: { name, class, items }
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, class: cls, items, globalFm } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Nom requis.' });
  }
  if (!items || typeof items !== 'object' || Array.isArray(items) || !Object.keys(items).length) {
    return res.status(400).json({ error: 'Aucun item à sauvegarder.' });
  }
  if (db.panoBuilds.countByUser(req.userId) >= MAX_BUILDS) {
    return res.status(400).json({ error: `Limite de ${MAX_BUILDS} builds atteinte.` });
  }

  try {
    const build = {
      id      : genId(),
      userId  : req.userId,
      name    : String(name).trim().slice(0, 40),
      class   : String(cls || '').slice(0, 30),
      items,
      globalFm: Array.isArray(globalFm) ? globalFm.slice(0, 40) : [],
      date    : new Date().toISOString(),
    };
    db.panoBuilds.insert(build);
    return res.status(201).json(build);
  } catch (err) {
    console.error('[panobuilds create]', err.message);
    return res.status(500).json({ error: 'Erreur sauvegarde du build.' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/pano-builds/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const existing = db.panoBuilds.find(req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: 'Build introuvable.' });
    db.panoBuilds.remove(req.params.id, req.userId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[panobuilds delete]', err.message);
    return res.status(500).json({ error: 'Erreur suppression du build.' });
  }
});

module.exports = router;
