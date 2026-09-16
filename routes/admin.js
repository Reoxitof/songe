'use strict';

const db = require('../db');

const express                       = require('express');
const bcrypt                        = require('bcryptjs');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
// Toutes les routes admin nécessitent auth + rôle admin
router.use(requireAuth, requireAdmin);

// ── Helper : utilisateur sans mot de passe + compteur sessions ─
function safeUser(u) {
  return {
    id           : u.id,
    username     : u.username,
    isAdmin      : u.isAdmin === true,
    banned       : u.banned  === true,
    createdAt    : u.createdAt,
    sessionsCount: db.sessions.countByUser(u.id),
  };
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { q } = req.query;
  let users = db.users.all();

  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    users = users.filter(u => u.username.toLowerCase().includes(term));
  }
  return res.json(users.map(safeUser));
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/stats
// ─────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const users = db.users.all();
  const newest = users.length > 0
    ? [...users].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].username
    : null;

  return res.json({
    totalUsers    : users.length,
    adminCount    : users.filter(u => u.isAdmin).length,
    bannedCount   : users.filter(u => u.banned).length,
    totalSessions : db.sessions.countAll(),
    totalForge    : db.forgemagie.countAll(),
    newestUser    : newest,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/users/:id
// ─────────────────────────────────────────────────────────────
router.get('/users/:id', (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  return res.json(safeUser(user));
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/users  — créer un compte
// ─────────────────────────────────────────────────────────────
router.post('/users', async (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ error: 'username et password requis.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 car. min).' });

  const clean = username.trim();
  if (db.users.findByUsername(clean))
    return res.status(409).json({ error: 'Nom d\'utilisateur déjà utilisé.' });

  const hash = await bcrypt.hash(password, 12);
  const user = {
    id       : Date.now().toString(36) + Math.random().toString(36).slice(2),
    username : clean,
    password : hash,
    isAdmin  : isAdmin === true,
    createdAt: new Date().toISOString(),
    banned   : false,
  };

  db.users.insert(user);
  const { DEFAULT_PRICES } = require('./prices');
  db.prices.set(user.id, JSON.parse(JSON.stringify(DEFAULT_PRICES)));

  return res.status(201).json(safeUser(user));
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:id
// ─────────────────────────────────────────────────────────────
router.patch('/users/:id', async (req, res) => {
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  if (req.params.id === req.userId && ('isAdmin' in req.body || 'banned' in req.body))
    return res.status(400).json({ error: 'Impossible de modifier son propre rôle ou statut.' });

  const changes = {};

  if (req.body.username !== undefined) {
    const clean = String(req.body.username).trim();
    if (clean.length < 3) return res.status(400).json({ error: 'Nom trop court.' });
    const dup = db.users.findByUsername(clean);
    if (dup && dup.id !== req.params.id)
      return res.status(409).json({ error: 'Nom déjà utilisé.' });
    changes.username = clean;
  }

  if (req.body.password !== undefined) {
    if (String(req.body.password).length < 8)
      return res.status(400).json({ error: 'Mot de passe trop court.' });
    changes.password = await bcrypt.hash(req.body.password, 12);
  }

  if (req.body.isAdmin !== undefined) changes.isAdmin = req.body.isAdmin === true;
  if (req.body.banned  !== undefined) changes.banned  = req.body.banned  === true;

  db.users.update(req.params.id, changes);
  return res.json(safeUser(db.users.findById(req.params.id)));
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id
// ─────────────────────────────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.userId)
    return res.status(400).json({ error: 'Impossible de supprimer son propre compte.' });

  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  db.users.remove(req.params.id);
  db.sessions.removeAllByUser(req.params.id);
  db.forgemagie.removeAllByUser(req.params.id);
  db.prices.remove(req.params.id);

  return res.json({ success: true, message: `Compte "${user.username}" supprimé.` });
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/users/:id/sessions
// ─────────────────────────────────────────────────────────────
router.get('/users/:id/sessions', (req, res) => {
  return res.json(db.sessions.byUser(req.params.id));
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id/sessions
// ─────────────────────────────────────────────────────────────
router.delete('/users/:id/sessions', (req, res) => {
  db.sessions.removeAllByUser(req.params.id);
  return res.json({ success: true });
});

module.exports = router;
