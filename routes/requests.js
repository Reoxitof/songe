'use strict';

const db              = require('../db');
const express         = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES  = ['donjon', 'combat', 'forgemagie', 'autre'];
const VALID_STATUS = ['ouvert', 'pris', 'resolu'];

// ─────────────────────────────────────────────────────────────
// GET /api/requests  — liste toutes les demandes (filtres optionnels)
// ?type=donjon  ?status=ouvert  ?q=texte
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  let list = db.requests.all();

  const { type, status, q } = req.query;
  if (type   && VALID_TYPES.includes(type))    list = list.filter(r => r.type === type);
  if (status && VALID_STATUS.includes(status)) list = list.filter(r => r.status === status);
  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    list = list.filter(r =>
      (r.title || '').toLowerCase().includes(term) ||
      (r.description || '').toLowerCase().includes(term) ||
      (r.username || '').toLowerCase().includes(term)
    );
  }
  return res.json(list);
});

// ─────────────────────────────────────────────────────────────
// GET /api/requests/count  — nombre de demandes ouvertes (badge)
// ─────────────────────────────────────────────────────────────
router.get('/count', (req, res) => {
  return res.json({ open: db.requests.countOpen() });
});

// ─────────────────────────────────────────────────────────────
// POST /api/requests  — créer une demande
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { type, title, description, reward } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Titre requis.' });

  const cleanType = VALID_TYPES.includes(type) ? type : 'autre';
  const entry = {
    id         : Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId     : req.userId,
    username   : req.username || 'Anonyme',
    type       : cleanType,
    title      : String(title).trim().slice(0, 120),
    description: String(description || '').trim().slice(0, 1000),
    reward     : String(reward || '').trim().slice(0, 120),
    status     : 'ouvert',
    takenBy    : null,
    takenByName: null,
    date       : new Date().toISOString(),
    updatedAt  : null,
  };

  db.requests.insert(entry);
  return res.status(201).json(entry);
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/requests/:id/take  — prendre en charge une demande
// ─────────────────────────────────────────────────────────────
router.patch('/:id/take', (req, res) => {
  const rq = db.requests.find(req.params.id);
  if (!rq) return res.status(404).json({ error: 'Demande introuvable.' });
  if (rq.status !== 'ouvert')
    return res.status(400).json({ error: 'Cette demande est déjà prise ou résolue.' });

  db.requests.update(req.params.id, {
    status: 'pris',
    takenBy: req.userId,
    takenByName: req.username || 'Anonyme',
    updatedAt: new Date().toISOString(),
  });
  return res.json(db.requests.find(req.params.id));
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/requests/:id/release  — annuler la prise en charge
// (celui qui a pris, ou le créateur)
// ─────────────────────────────────────────────────────────────
router.patch('/:id/release', (req, res) => {
  const rq = db.requests.find(req.params.id);
  if (!rq) return res.status(404).json({ error: 'Demande introuvable.' });
  if (rq.takenBy !== req.userId && rq.userId !== req.userId && !req.isAdmin)
    return res.status(403).json({ error: 'Action non autorisée.' });

  db.requests.update(req.params.id, {
    status: 'ouvert',
    takenBy: null,
    takenByName: null,
    updatedAt: new Date().toISOString(),
  });
  return res.json(db.requests.find(req.params.id));
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/requests/:id/resolve  — marquer comme résolu
// (créateur, personne qui a pris, ou admin)
// ─────────────────────────────────────────────────────────────
router.patch('/:id/resolve', (req, res) => {
  const rq = db.requests.find(req.params.id);
  if (!rq) return res.status(404).json({ error: 'Demande introuvable.' });
  if (rq.userId !== req.userId && rq.takenBy !== req.userId && !req.isAdmin)
    return res.status(403).json({ error: 'Action non autorisée.' });

  db.requests.update(req.params.id, {
    status: 'resolu',
    updatedAt: new Date().toISOString(),
  });
  return res.json(db.requests.find(req.params.id));
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/requests/:id  — supprimer (créateur ou admin)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const rq = db.requests.find(req.params.id);
  if (!rq) return res.status(404).json({ error: 'Demande introuvable.' });
  if (rq.userId !== req.userId && !req.isAdmin)
    return res.status(403).json({ error: 'Seul le créateur ou un admin peut supprimer.' });

  db.requests.remove(req.params.id);
  return res.json({ success: true });
});

module.exports = router;
