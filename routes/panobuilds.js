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

// Catégories fixes pour la galerie communautaire (cohérentes front/back)
const CATEGORIES = ['PvM', 'PvP', 'Farm / Ressources', 'Leveling', 'Craft / Multi', 'Autre'];

function genId() {
  return 'pb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cleanCategory(cat) {
  return CATEGORIES.includes(cat) ? cat : 'Autre';
}

// ─────────────────────────────────────────────────────────────
// GET /api/pano-builds/categories  — AVANT /:id
// ─────────────────────────────────────────────────────────────
router.get('/categories', (req, res) => res.json(CATEGORIES));

// ─────────────────────────────────────────────────────────────
// GET /api/pano-builds/public  — galerie communautaire (AVANT /:id)
// ?category=&class=&q=&page=
// ─────────────────────────────────────────────────────────────
router.get('/public', (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 24;
    const { items, hasMore } = db.panoBuilds.publicList({
      category: req.query.category || '',
      cls     : req.query.class || '',
      q       : (req.query.q || '').trim(),
      limit, offset: (page - 1) * limit,
    });
    return res.json({ items, page, hasMore });
  } catch (err) {
    console.error('[panobuilds public]', err.message);
    return res.status(500).json({ error: 'Erreur chargement de la galerie.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/pano-builds/public/:id  — détail d'un build public (clonable)
// ─────────────────────────────────────────────────────────────
router.get('/public/:id', (req, res) => {
  try {
    const build = db.panoBuilds.findPublic(req.params.id);
    if (!build) return res.status(404).json({ error: 'Build introuvable ou privé.' });
    return res.json(build);
  } catch (err) {
    console.error('[panobuilds public detail]', err.message);
    return res.status(500).json({ error: 'Erreur chargement du build.' });
  }
});

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
// POST /api/pano-builds   body: { name, class, items, visibility, category }
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, class: cls, items, globalFm, visibility, category } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Nom requis.' });
  }
  if (!items || typeof items !== 'object' || Array.isArray(items) || !Object.keys(items).length) {
    return res.status(400).json({ error: 'Aucun item à sauvegarder.' });
  }
  if (db.panoBuilds.countByUser(req.userId) >= MAX_BUILDS) {
    return res.status(400).json({ error: `Limite de ${MAX_BUILDS} builds atteinte.` });
  }

  const isPublic = visibility === 'public';

  try {
    const build = {
      id      : genId(),
      userId  : req.userId,
      username: req.username || 'Anonyme',
      name    : String(name).trim().slice(0, 40),
      class   : String(cls || '').slice(0, 30),
      items,
      globalFm  : Array.isArray(globalFm) ? globalFm.slice(0, 40) : [],
      visibility: isPublic ? 'public' : 'private',
      category  : isPublic ? cleanCategory(category) : '',
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
// PATCH /api/pano-builds/:id  — changer visibilité / catégorie / nom
// ─────────────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const existing = db.panoBuilds.find(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Build introuvable.' });

  const changes = {};
  if (req.body.name !== undefined) {
    if (!String(req.body.name).trim()) return res.status(400).json({ error: 'Nom requis.' });
    changes.name = String(req.body.name).trim().slice(0, 40);
  }
  if (req.body.visibility !== undefined) {
    changes.visibility = req.body.visibility === 'public' ? 'public' : 'private';
  }
  const nextVisibility = changes.visibility || existing.visibility;
  if (req.body.category !== undefined || changes.visibility) {
    changes.category = nextVisibility === 'public'
      ? cleanCategory(req.body.category !== undefined ? req.body.category : existing.category)
      : '';
  }
  if (!Object.keys(changes).length) return res.json(existing);

  try {
    db.panoBuilds.update(req.params.id, req.userId, changes);
    return res.json(db.panoBuilds.find(req.params.id, req.userId));
  } catch (err) {
    console.error('[panobuilds update]', err.message);
    return res.status(500).json({ error: 'Erreur mise à jour du build.' });
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
module.exports.CATEGORIES = CATEGORIES;
