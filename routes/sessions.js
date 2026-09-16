'use strict';

const db = require('../db');

const express         = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────
function sanitizeItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(i => i && typeof i.name === 'string' && i.name.trim())
    .map(i => ({ name: i.name.trim().slice(0, 80), qty: Math.max(1, Math.round(Number(i.qty) || 1)) }))
    .slice(0, 100);
}

/** Cherche le prix d'une rune dans toutes les collections */
function findRunePrice(name, prices) {
  const all = [
    ...(prices.runesForgemagie    || []),
    ...(prices.runesAstrales      || []),
    ...(prices.runesTranscendance || []),
  ];
  return all.find(x => x.name === name);
}

function calcValue(session, prices) {
  if (!prices) return 0;
  let total = 0;
  (session.legendes || []).forEach(i => {
    const t = (prices.legendesSonge || []).find(t => t.name === i.name);
    if (t) total += (t.price || 0) * i.qty;
  });
  (session.runes || []).forEach(i => {
    const t = findRunePrice(i.name, prices);
    if (t) total += (t.price || 0) * i.qty;
  });
  total += (session.dreamPoints   || 0) * (prices.dreamPtPrice || 0);
  total += (session.oniricReflets || 0) * (prices.oniricPrice  || 0);
  return total;
}

// ─────────────────────────────────────────────────────────────
// GET /api/sessions
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  let sessions = db.sessions.byUser(req.userId); // déjà triées date DESC

  const { q } = req.query;
  if (q && q.trim()) {
    const term = q.trim().toLowerCase();
    sessions = sessions.filter(s =>
      (s.notes || '').toLowerCase().includes(term) ||
      (s.legendes || []).some(l => l.name.toLowerCase().includes(term)) ||
      (s.runes    || []).some(r => r.name.toLowerCase().includes(term))
    );
  }
  return res.json(sessions);
});

// ─────────────────────────────────────────────────────────────
// POST /api/sessions
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { durationSec, floor, legendes, runes, dreamPoints, oniricReflets, notes } = req.body;
  const dur = Math.round(Number(durationSec));
  if (!dur || dur <= 0 || dur > 86400)
    return res.status(400).json({ error: 'Durée invalide (1 sec — 24h).' });

  const session = {
    id           : Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId       : req.userId,
    date         : new Date().toISOString(),
    durationSec  : dur,
    floor        : floor ? Math.round(Number(floor)) : null,
    legendes     : sanitizeItems(legendes),
    runes        : sanitizeItems(runes),
    dreamPoints  : Math.max(0, Math.round(Number(dreamPoints)   || 0)),
    oniricReflets: Math.max(0, Math.round(Number(oniricReflets) || 0)),
    notes        : String(notes || '').trim().slice(0, 500),
  };

  db.sessions.insert(session);
  return res.status(201).json(session);
});

// ─────────────────────────────────────────────────────────────
// GET /api/sessions/export  — AVANT /:id
// ─────────────────────────────────────────────────────────────
router.get('/export', (req, res) => {
  const sessions = db.sessions.byUser(req.userId);
  const prices   = db.prices.get(req.userId) || {};

  const HEADER = ['Date','Durée (sec)','Étage','Légendes','Runes','Pts rêve','Reflets','Valeur (k)','Valeur/h (k)','Notes'];
  const rows = sessions.map(s => {
    const val  = calcValue(s, prices);
    const rate = s.durationSec > 0 ? Math.round(val / (s.durationSec / 3600)) : 0;
    return [
      new Date(s.date).toLocaleString('fr-FR'),
      s.durationSec, s.floor || '',
      (s.legendes || []).map(l => `${l.name}x${l.qty}`).join(';'),
      (s.runes    || []).map(r => `${r.name}x${r.qty}`).join(';'),
      s.dreamPoints || 0, s.oniricReflets || 0,
      val, rate,
      String(s.notes || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(',');
  });

  const csv = [HEADER.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="songe-tracker-${new Date().toISOString().slice(0,10)}.csv"`);
  return res.send('\uFEFF' + csv);
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/sessions  — purge totale
// ─────────────────────────────────────────────────────────────
router.delete('/', (req, res) => {
  db.sessions.removeAllByUser(req.userId);
  return res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/sessions/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const session = db.sessions.find(req.params.id, req.userId);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  db.sessions.remove(req.params.id, req.userId);
  return res.json({ success: true });
});

module.exports = router;
