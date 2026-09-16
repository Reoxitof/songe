'use strict';

const db = require('../db');

const express          = require('express');

const { requireAuth }  = require('../middleware/auth');
const { calcResult, normalizeTentative } = require('../lib/fm-calc');

const router  = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────
function getUserForges(userId) {
  return db.forgemagie.byUser(userId); // déjà triées date DESC
}

// ─────────────────────────────────────────────────────────────
// GET /api/forgemagie  — liste les entrées de forgemagie
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { q, statut } = req.query;
  let forges = getUserForges(req.userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Filtre texte (item ou notes)
  if (q?.trim()) {
    const term = q.trim().toLowerCase();
    forges = forges.filter(f =>
      (f.itemNom || '').toLowerCase().includes(term) ||
      (f.notes   || '').toLowerCase().includes(term)
    );
  }

  // Filtre statut : 'benefice' | 'perte' | 'neutre'
  if (statut === 'benefice') forges = forges.filter(f => calcResult(f).benefice > 0);
  if (statut === 'perte')    forges = forges.filter(f => calcResult(f).benefice < 0);
  if (statut === 'neutre')   forges = forges.filter(f => calcResult(f).benefice === 0);

  // Enrichir avec les calculs
  const enriched = forges.map(f => ({ ...f, ...calcResult(f) }));
  return res.json(enriched);
});

// ─────────────────────────────────────────────────────────────
// GET /api/forgemagie/stats  — résumé statistiques
// ─────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const forges = getUserForges(req.userId);
  if (forges.length === 0) {
    return res.json({
      total: 0, benefices: 0, pertes: 0, neutres: 0,
      totalBenefice: 0, totalInvesti: 0, totalVente: 0, margeGlobale: 0,
      exoAttempts: 0, exoSuccesses: 0, coutMoyenExo: null, byItem: [], history: [],
    });
  }

  let totalBenefice = 0, totalInvesti = 0, totalVente = 0;
  let benefices = 0, pertes = 0, neutres = 0;
  let exoAttempts = 0, exoSuccesses = 0, exoCost = 0;
  const byItem = {};
  const byDay  = {};

  forges.forEach(f => {
    const r = calcResult(f);
    totalBenefice += r.benefice;
    totalInvesti  += r.coutTotal;
    totalVente    += Number(f.prixVente || 0);
    if (r.benefice > 0) benefices++;
    else if (r.benefice < 0) pertes++;
    else neutres++;

    // ── Rentabilité par item ────────────────────────────────
    const key = (f.itemNom || 'Inconnu').toLowerCase();
    const item = byItem[key] ||= {
      itemNom: f.itemNom || 'Inconnu', attempts: 0, known: 0, successes: 0,
      totalCost: 0, totalBenefice: 0,
    };
    item.attempts++; item.totalCost += r.coutTotal; item.totalBenefice += r.benefice;
    if (f.tentativeStatut !== 'inconnu') {
      item.known++;
      if (f.tentativeStatut === 'succes') item.successes++;
    }
    if (f.exo) {
      exoAttempts++; exoCost += r.coutTotal;
      if (f.tentativeStatut === 'succes') exoSuccesses++;
    }

    // ── Historique jour par jour (pour le graphique de tendance) ─
    const day = String(f.date || '').slice(0, 10) || 'inconnu';
    const bucket = byDay[day] ||= { date: day, benefice: 0, invested: 0, count: 0 };
    bucket.benefice += r.benefice; bucket.invested += r.coutTotal; bucket.count++;
  });

  const margeGlobale = totalInvesti > 0
    ? Math.round((totalBenefice / totalInvesti) * 1000) / 10 : 0;

  const history = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60); // 60 derniers jours avec activité

  return res.json({
    total: forges.length, benefices, pertes, neutres,
    totalBenefice, totalInvesti, totalVente, margeGlobale,
    exoAttempts, exoSuccesses,
    coutMoyenExo: exoSuccesses ? Math.round(exoCost / exoSuccesses) : null,
    byItem: Object.values(byItem).map(i => ({ ...i,
      coutMoyen: Math.round(i.totalCost / i.attempts),
      tauxReussite: i.known ? Math.round((i.successes / i.known) * 1000) / 10 : null,
    })).sort((a, b) => b.totalBenefice - a.totalBenefice),
    history,
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/forgemagie  — créer une entrée
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    itemNom, itemType,
    prixAchat, coutCraft, prixVente,
    runes, notes, tentativeStatut, exo,
  } = req.body;

  if (!itemNom?.trim())
    return res.status(400).json({ error: 'Nom de l\'item requis.' });

  // Valider et nettoyer les runes passées
  const runesPropres = Array.isArray(runes)
    ? runes
        .filter(r => r?.nom?.trim())
        .map(r => ({
          nom         : String(r.nom).trim().slice(0, 60),
          quantite    : Math.max(0, Math.round(Number(r.quantite    || 0))),
          prixUnitaire: Math.max(0, Math.round(Number(r.prixUnitaire || 0))),
        }))
        .slice(0, 50)
    : [];

  const entry = {
    id         : Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId     : req.userId,
    date       : new Date().toISOString(),
    itemNom    : String(itemNom).trim().slice(0, 100),
    itemType   : String(itemType || 'Équipement').trim().slice(0, 60),
    prixAchat  : Math.max(0, Math.round(Number(prixAchat  || 0))),
    coutCraft  : Math.max(0, Math.round(Number(coutCraft  || 0))),
    prixVente  : Math.max(0, Math.round(Number(prixVente  || 0))),
    runes      : runesPropres,
    notes      : String(notes || '').trim().slice(0, 500),
    tentativeStatut: normalizeTentative(tentativeStatut),
    exo: !!exo,
  };

  db.forgemagie.insert(entry);
  return res.status(201).json({ ...entry, ...calcResult(entry) });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/forgemagie/:id  — modifier une entrée
// ─────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const existing = db.forgemagie.find(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Entrée introuvable.' });

  const {
    itemNom, itemType,
    prixAchat, coutCraft, prixVente,
    runes, notes, tentativeStatut, exo,
  } = req.body;

  const runesPropres = Array.isArray(runes)
    ? runes
        .filter(r => r?.nom?.trim())
        .map(r => ({
          nom         : String(r.nom).trim().slice(0, 60),
          quantite    : Math.max(0, Math.round(Number(r.quantite    || 0))),
          prixUnitaire: Math.max(0, Math.round(Number(r.prixUnitaire || 0))),
        }))
        .slice(0, 50)
    : existing.runes;

  const updated = {
    ...existing,
    itemNom  : itemNom  !== undefined ? String(itemNom).trim().slice(0, 100)  : existing.itemNom,
    itemType : itemType !== undefined ? String(itemType).trim().slice(0, 60)  : existing.itemType,
    prixAchat: prixAchat !== undefined ? Math.max(0, Math.round(Number(prixAchat))) : existing.prixAchat,
    coutCraft: coutCraft !== undefined ? Math.max(0, Math.round(Number(coutCraft))) : existing.coutCraft,
    prixVente: prixVente !== undefined ? Math.max(0, Math.round(Number(prixVente))) : existing.prixVente,
    runes    : runesPropres,
    notes    : notes !== undefined ? String(notes).trim().slice(0, 500) : existing.notes,
    tentativeStatut: tentativeStatut !== undefined ? normalizeTentative(tentativeStatut) : existing.tentativeStatut,
    exo: exo !== undefined ? !!exo : existing.exo,
    updatedAt: new Date().toISOString(),
  };

  db.forgemagie.update(req.params.id, req.userId, updated);
  return res.json({ ...updated, ...calcResult(updated) });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/forgemagie/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const existing = db.forgemagie.find(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Entrée introuvable.' });
  db.forgemagie.remove(req.params.id, req.userId);
  return res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// GET /api/forgemagie/export  — export CSV
// ─────────────────────────────────────────────────────────────
router.get('/export', (req, res) => {
  const forges = getUserForges(req.userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const HEADER = [
    'Date','Item','Type',
    'Prix achat (k)','Coût craft (k)',
    'Runes','Coût runes (k)','Coût total (k)',
    'Prix vente (k)','Bénéfice (k)','Marge (%)','Notes',
  ];

  const rows = forges.map(f => {
    const r = calcResult(f);
    const coutRunes = (f.runes || []).reduce((a, r2) => a + r2.quantite * r2.prixUnitaire, 0);
    const runesStr  = (f.runes || []).map(r2 => `${r2.nom}×${r2.quantite}@${r2.prixUnitaire}k`).join(';');
    return [
      new Date(f.date).toLocaleString('fr-FR'),
      f.itemNom, f.itemType,
      f.prixAchat, f.coutCraft,
      runesStr, coutRunes, r.coutTotal,
      f.prixVente, r.benefice, r.marge,
      String(f.notes || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(',');
  });

  const csv = [HEADER.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="forgemagie-${new Date().toISOString().slice(0,10)}.csv"`);
  return res.send('\uFEFF' + csv);
});

module.exports = router;
