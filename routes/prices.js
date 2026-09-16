'use strict';

const db = require('../db');

const express           = require('express');

const { requireAuth }   = require('../middleware/auth');

const router  = express.Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────
function sanitizeType(t) {
  return {
    name : String(t.name  || '').trim().slice(0, 60),
    price: Math.max(0, Math.round(Number(t.price) || 0)),
  };
}

const DEFAULT_PRICES = {
  dreamPtPrice: 0, oniricPrice: 0,

  // ══ RUNES DE FORGEMAGIE CLASSIQUES ═══════════════════════════
  runesForgemagie: [
    // Caractéristiques élémentaires
    { name: 'Vi',         price: 0 }, { name: 'Pa Vi',  price: 0 }, { name: 'Ra Vi',  price: 0 },
    { name: 'Fo',         price: 0 }, { name: 'Pa Fo',  price: 0 }, { name: 'Ra Fo',  price: 0 },
    { name: 'Cha',        price: 0 }, { name: 'Pa Cha', price: 0 }, { name: 'Ra Cha', price: 0 },
    { name: 'Agi',        price: 0 }, { name: 'Pa Agi', price: 0 }, { name: 'Ra Agi', price: 0 },
    { name: 'Int',        price: 0 }, { name: 'Pa Int', price: 0 }, { name: 'Ra Int', price: 0 },
    // Sagesse
    { name: 'Sa',         price: 0 }, { name: 'Pa Sa',  price: 0 }, { name: 'Ra Sa',  price: 0 },
    // Puissance
    { name: 'Pui',        price: 0 }, { name: 'Pa Pui', price: 0 }, { name: 'Ra Pui', price: 0 },
    // Initiative
    { name: 'Ini',        price: 0 }, { name: 'Pa Ini', price: 0 }, { name: 'Ra Ini', price: 0 },
    // Pods
    { name: 'Pod',        price: 0 }, { name: 'Pa Pod', price: 0 }, { name: 'Ra Pod', price: 0 },
    // Prospection
    { name: 'Pros',       price: 0 }, { name: 'Pa Pros', price: 0 },
    // Fuite & Tacle
    { name: 'Fui',        price: 0 }, { name: 'Pa Fui', price: 0 },
    { name: 'Tac',        price: 0 }, { name: 'Pa Tac', price: 0 },
    // Résistances fixes
    { name: 'Ré Air',     price: 0 }, { name: 'Ré Eau',    price: 0 },
    { name: 'Ré Feu',     price: 0 }, { name: 'Ré Terre',  price: 0 },
    { name: 'Ré Neutre',  price: 0 },
    { name: 'Ré Pou',     price: 0 }, { name: 'Pa Ré Pou', price: 0 },
    { name: 'Ré Cri',     price: 0 }, { name: 'Pa Ré Cri', price: 0 },
    // Dommages élémentaires
    { name: 'Do Air',     price: 0 }, { name: 'Pa Do Air',    price: 0 },
    { name: 'Do Eau',     price: 0 }, { name: 'Pa Do Eau',    price: 0 },
    { name: 'Do Feu',     price: 0 }, { name: 'Pa Do Feu',    price: 0 },
    { name: 'Do Terre',   price: 0 }, { name: 'Pa Do Terre',  price: 0 },
    { name: 'Do Neutre',  price: 0 }, { name: 'Pa Do Neutre', price: 0 },
    { name: 'Do Cri',     price: 0 }, { name: 'Pa Do Cri',    price: 0 },
    // Dommages poussée & pièges
    { name: 'Do Pou',     price: 0 }, { name: 'Pa Do Pou', price: 0 },
    { name: 'Do Pi',      price: 0 }, { name: 'Pa Do Pi',  price: 0 },
    { name: 'Do Ren',     price: 0 },
    // Retrait & Esquive PA/PM
    { name: 'Ret PA',     price: 0 }, { name: 'Pa Ret PA', price: 0 },
    { name: 'Ret PM',     price: 0 }, { name: 'Pa Ret PM', price: 0 },
    { name: 'Ré PA',      price: 0 }, { name: 'Pa Ré PA',  price: 0 },
    { name: 'Ré PM',      price: 0 }, { name: 'Pa Ré PM',  price: 0 },
    // Coup critique & Soin
    { name: 'Cri',        price: 0 },
    { name: 'So',         price: 0 },
    // % Dommages
    { name: 'Do Per Ar',  price: 0 }, { name: 'Do Per Mé', price: 0 },
    { name: 'Do Per Di',  price: 0 }, { name: 'Do Per So', price: 0 },
    // % Résistances
    { name: 'Ré Per Mé',     price: 0 }, { name: 'Ré Per Di',     price: 0 },
    { name: 'Ré Per Air',    price: 0 }, { name: 'Ré Per Eau',    price: 0 },
    { name: 'Ré Per Feu',    price: 0 }, { name: 'Ré Per Terre',  price: 0 },
    { name: 'Ré Per Neutre', price: 0 },
    // % Dommages pièges
    { name: 'Pi Per',     price: 0 }, { name: 'Pa Pi Per', price: 0 }, { name: 'Ra Pi Per', price: 0 },
    // Runes spéciales
    { name: 'PO',         price: 0 },
    { name: 'Invo',       price: 0 },
    { name: 'Ga PMé',     price: 0 },
    { name: 'Ga PA',      price: 0 },
  ],

  // ══ RUNES ASTRALES — dropables en Songe (Palier I→V) ═════════
  runesAstrales: [
    { name: 'Rune Astrale Mineure',      price: 0 }, // Palier I-II
    { name: 'Rune Astrale Moyenne',      price: 0 }, // Palier I-II
    { name: 'Rune Astrale Majeure',      price: 0 }, // Palier III-IV
    { name: 'Rune Astrale Épatante',     price: 0 }, // Palier III-IV
    { name: 'Rune Astrale Merveilleuse', price: 0 }, // Palier IV-V
    { name: 'Rune Astrale Légendaire',   price: 0 }, // Palier IV-V
  ],

  // ══ RUNES DE TRANSCENDANCE — craftées (astrales + reflets) ═══
  runesTranscendance: [
    // Résistances % (craftées avec Rune Astrale Merveilleuse)
    { name: 'Trans. Ré Per Air',    price: 0 },
    { name: 'Trans. Ré Per Eau',    price: 0 },
    { name: 'Trans. Ré Per Feu',    price: 0 },
    { name: 'Trans. Ré Per Terre',  price: 0 },
    { name: 'Trans. Ré Per Neutre', price: 0 },
    { name: 'Trans. Ré Per Mé',     price: 0 },
    { name: 'Trans. Ré Per Di',     price: 0 },
    { name: 'Trans. Ré Pou',        price: 0 },
    { name: 'Trans. Ré Cri',        price: 0 },
    // % Dommages (craftées avec Rune Astrale Légendaire)
    { name: 'Trans. Do Per Ar',  price: 0 },
    { name: 'Trans. Do Per Mé',  price: 0 },
    { name: 'Trans. Do Per Di',  price: 0 },
    { name: 'Trans. Do Per So',  price: 0 },
    // Exo PA / PM / PO (les plus rares — Légendaire)
    { name: 'Trans. PA', price: 0 },
    { name: 'Trans. PM', price: 0 },
    { name: 'Trans. PO', price: 0 },
  ],

  // Rétrocompatibilité
  // ══ LÉGENDES (ressources drop — pas les équipements) ══════════
  legendesSonge: [
    // ── Légendes classiques ────────────────────────────────
    { name: 'Légende de Ganymède', price: 0 },
    { name: 'Légende de Brâm Barbe-Monde', price: 0 },
    { name: 'Légende de Rykke Errel', price: 0 },
    { name: 'Légende de Jahash Jurgen', price: 0 },
    { name: 'Légende de Fallanster', price: 0 },
    { name: 'Légende de Dame Jhessica', price: 0 },
    { name: 'Légende de Dodge', price: 0 },
    { name: 'Légende du Cul Botté', price: 0 },
    { name: 'Légende de Corruption', price: 0 },
    { name: 'Légende de l\'Arbre-Coeur', price: 0 },
    { name: 'Légende de l\'Éphémère', price: 0 },
    { name: 'Légende des Mille Lieues', price: 0 },
    { name: 'Légende Trompe-la-mort', price: 0 },
    { name: 'Légende du Crocobur', price: 0 },
    { name: 'Légende de Buhorado', price: 0 },
    { name: 'Légende de Guerre', price: 0 },
    { name: 'Légende de Brumaire', price: 0 },
    { name: 'Légende des Destins', price: 0 },
    { name: 'Légende de Misère', price: 0 },
    { name: 'Légende de la Mort', price: 0 },
    { name: 'Légende de Bolloway', price: 0 },
    { name: 'Légende Dofusteuse', price: 0 },
    // ── Légendes MÀJ 3.3 ──────────────────────────────────
    { name: 'Amayiro', price: 0 },
    { name: 'Helséphine', price: 0 },
    { name: 'Henual', price: 0 },
    { name: 'Oto Mustam', price: 0 },
    { name: 'Menalt', price: 0 },
    { name: 'Mériana', price: 0 },
    { name: 'Miroir', price: 0 },
    { name: 'Thanatena', price: 0 },
    // ── Légendes animales ──────────────────────────────────
    { name: 'Légende animale du Bébémoth', price: 0 },
    { name: 'Légende animale de la Tofune', price: 0 },
    { name: 'Légende animale du Mulou', price: 0 },
    { name: 'Légende animale du Chafer', price: 0 },
  ],
};

function getUserPrices(userId) {
  const stored = db.prices.get(userId);
  if (!stored) return JSON.parse(JSON.stringify(DEFAULT_PRICES));

  // Merge : compléter les nouvelles collections manquantes (migration transparente)
  const defaults = JSON.parse(JSON.stringify(DEFAULT_PRICES));
  return {
    dreamPtPrice      : stored.dreamPtPrice        ?? defaults.dreamPtPrice,
    oniricPrice       : stored.oniricPrice          ?? defaults.oniricPrice,
    runesForgemagie   : stored.runesForgemagie?.length    ? stored.runesForgemagie    : defaults.runesForgemagie,
    runesAstrales     : stored.runesAstrales?.length      ? stored.runesAstrales      : defaults.runesAstrales,
    runesTranscendance: stored.runesTranscendance?.length ? stored.runesTranscendance : defaults.runesTranscendance,
    legendesSonge     : stored.legendesSonge?.length      ? stored.legendesSonge      : defaults.legendesSonge,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /api/prices
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json(getUserPrices(req.userId)));

// ─────────────────────────────────────────────────────────────
// PUT /api/prices  — remplace tout
// ─────────────────────────────────────────────────────────────
router.put('/', (req, res) => {
  const current = getUserPrices(req.userId);
  const { dreamPtPrice, oniricPrice, runesForgemagie, runesAstrales, runesTranscendance, legendesSonge } = req.body;

  const updated = {
    dreamPtPrice      : Math.max(0, Math.round(Number(dreamPtPrice) || 0)),
    oniricPrice       : Math.max(0, Math.round(Number(oniricPrice)  || 0)),
    runesForgemagie   : Array.isArray(runesForgemagie)    ? runesForgemagie.map(sanitizeType).slice(0, 500)    : current.runesForgemagie,
    runesAstrales     : Array.isArray(runesAstrales)      ? runesAstrales.map(sanitizeType).slice(0, 50)       : current.runesAstrales,
    runesTranscendance: Array.isArray(runesTranscendance) ? runesTranscendance.map(sanitizeType).slice(0, 100) : current.runesTranscendance,
    legendesSonge     : Array.isArray(legendesSonge)      ? legendesSonge.map(sanitizeType).slice(0, 100)      : current.legendesSonge,
  };
  db.prices.set(req.userId, updated);
  return res.json(updated);
});

// ─────────────────────────────────────────────────────────────
// Routes génériques pour ajouter/supprimer dans une collection
// ─────────────────────────────────────────────────────────────
const VALID_COLLECTIONS = {
  'forgemagie-types'    : 'runesForgemagie',
  'astrale-types'       : 'runesAstrales',
  'transcendance-types' : 'runesTranscendance',
  'legende-songe-types' : 'legendesSonge',
  'rune-types'          : 'runesForgemagie',
};

router.post('/:collection', (req, res) => {
  const colKey = VALID_COLLECTIONS[req.params.collection];
  if (!colKey) return res.status(404).json({ error: 'Collection inconnue.' });

  const { name, price } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' });

  const prices  = getUserPrices(req.userId);
  const cleaned = sanitizeType({ name, price });

  if ((prices[colKey] || []).find(t => t.name.toLowerCase() === cleaned.name.toLowerCase()))
    return res.status(409).json({ error: 'Ce type existe déjà.' });

  prices[colKey] = [...(prices[colKey] || []), cleaned];
  db.prices.set(req.userId, prices);
  return res.status(201).json(cleaned);
});

router.delete('/:collection/:name', (req, res) => {
  const colKey = VALID_COLLECTIONS[req.params.collection];
  if (!colKey) return res.status(404).json({ error: 'Collection inconnue.' });

  const name   = decodeURIComponent(req.params.name).toLowerCase();
  const prices = getUserPrices(req.userId);
  prices[colKey] = (prices[colKey] || []).filter(t => t.name.toLowerCase() !== name);
  db.prices.set(req.userId, prices);
  return res.json({ success: true });
});

module.exports = router;
module.exports.DEFAULT_PRICES = DEFAULT_PRICES;
