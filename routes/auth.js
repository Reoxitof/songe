'use strict';

const db = require('../db');

const express            = require('express');
const bcrypt             = require('bcryptjs');
const jwt                = require('jsonwebtoken');

const { requireAuth }    = require('../middleware/auth');

const router  = express.Router();
// ── Validation ─────────────────────────────────────────────────
const USERNAME_REGEX = /^[a-zA-Z0-9_\-]{3,30}$/;

function validateRegister(username, password) {
  if (!username || !password) return 'Identifiants requis.';
  if (!USERNAME_REGEX.test(username))
    return 'Nom invalide (3-30 car., lettres/chiffres/- _ uniquement).';
  if (password.length < 8)  return 'Mot de passe trop court (8 car. min).';
  if (password.length > 128) return 'Mot de passe trop long.';
  return null;
}

// ── Prix par défaut ─────────────────────────────────────────────
const DEFAULT_PRICES = {
  dreamPtPrice: 0, oniricPrice: 0,

  // ══ RUNES DE FORGEMAGIE CLASSIQUES ═══════════════════════════
  runesForgemagie: [
    // Caractéristiques élémentaires (Vi, Fo, Cha, Agi, Int)
    { name: 'Vi',    price: 0 },
    { name: 'Pa Vi', price: 0 },
    { name: 'Ra Vi', price: 0 },
    { name: 'Fo',    price: 0 },
    { name: 'Pa Fo', price: 0 },
    { name: 'Ra Fo', price: 0 },
    { name: 'Cha',   price: 0 },
    { name: 'Pa Cha', price: 0 },
    { name: 'Ra Cha', price: 0 },
    { name: 'Agi',   price: 0 },
    { name: 'Pa Agi', price: 0 },
    { name: 'Ra Agi', price: 0 },
    { name: 'Int',   price: 0 },
    { name: 'Pa Int', price: 0 },
    { name: 'Ra Int', price: 0 },
    // Sagesse
    { name: 'Sa',    price: 0 },
    { name: 'Pa Sa', price: 0 },
    { name: 'Ra Sa', price: 0 },
    // Puissance
    { name: 'Pui',    price: 0 },
    { name: 'Pa Pui', price: 0 },
    { name: 'Ra Pui', price: 0 },
    // Initiative
    { name: 'Ini',    price: 0 },
    { name: 'Pa Ini', price: 0 },
    { name: 'Ra Ini', price: 0 },
    // Pods
    { name: 'Pod',    price: 0 },
    { name: 'Pa Pod', price: 0 },
    { name: 'Ra Pod', price: 0 },
    // Prospection
    { name: 'Pros',    price: 0 },
    { name: 'Pa Pros', price: 0 },
    // Fuite & Tacle
    { name: 'Fui',    price: 0 },
    { name: 'Pa Fui', price: 0 },
    { name: 'Tac',    price: 0 },
    { name: 'Pa Tac', price: 0 },
    // Résistances fixes (par élément)
    { name: 'Ré Air',    price: 0 },
    { name: 'Ré Eau',    price: 0 },
    { name: 'Ré Feu',    price: 0 },
    { name: 'Ré Terre',  price: 0 },
    { name: 'Ré Neutre', price: 0 },
    // Résistances poussée & critique
    { name: 'Ré Pou',     price: 0 },
    { name: 'Pa Ré Pou',  price: 0 },
    { name: 'Ré Cri',     price: 0 },
    { name: 'Pa Ré Cri',  price: 0 },
    // Dommages élémentaires
    { name: 'Do Air',    price: 0 },
    { name: 'Pa Do Air', price: 0 },
    { name: 'Do Eau',    price: 0 },
    { name: 'Pa Do Eau', price: 0 },
    { name: 'Do Feu',    price: 0 },
    { name: 'Pa Do Feu', price: 0 },
    { name: 'Do Terre',  price: 0 },
    { name: 'Pa Do Terre', price: 0 },
    { name: 'Do Neutre', price: 0 },
    { name: 'Pa Do Neutre', price: 0 },
    { name: 'Do Cri',    price: 0 },
    { name: 'Pa Do Cri', price: 0 },
    // Dommages poussée & pièges
    { name: 'Do Pou', price: 0 },
    { name: 'Pa Do Pou', price: 0 },
    { name: 'Do Pi',  price: 0 },
    { name: 'Pa Do Pi', price: 0 },
    // Dommages renvoyés
    { name: 'Do Ren', price: 0 },
    // Retrait PA/PM & Esquive PA/PM
    { name: 'Ret PA',   price: 0 },
    { name: 'Pa Ret PA', price: 0 },
    { name: 'Ret PM',   price: 0 },
    { name: 'Pa Ret PM', price: 0 },
    { name: 'Ré PA',    price: 0 },
    { name: 'Pa Ré PA', price: 0 },
    { name: 'Ré PM',    price: 0 },
    { name: 'Pa Ré PM', price: 0 },
    // Coup critique
    { name: 'Cri', price: 0 },
    // Soin
    { name: 'So',  price: 0 },
    // % Dommages (armes, mêlée, distance, sorts)
    { name: 'Do Per Ar',  price: 0 },
    { name: 'Do Per Mé',  price: 0 },
    { name: 'Do Per Di',  price: 0 },
    { name: 'Do Per So',  price: 0 },
    // % Résistances (mêlée, distance)
    { name: 'Ré Per Mé',  price: 0 },
    { name: 'Ré Per Di',  price: 0 },
    // % Résistances élémentaires
    { name: 'Ré Per Air',    price: 0 },
    { name: 'Ré Per Eau',    price: 0 },
    { name: 'Ré Per Feu',    price: 0 },
    { name: 'Ré Per Terre',  price: 0 },
    { name: 'Ré Per Neutre', price: 0 },
    // Spéciales
    { name: 'PO',      price: 0 },
    { name: 'Invo',    price: 0 },
    { name: 'Ga PMé',  price: 0 },
    { name: 'Ga PA',   price: 0 },
    // % Dommages pièges
    { name: 'Pi Per',    price: 0 },
    { name: 'Pa Pi Per', price: 0 },
    { name: 'Ra Pi Per', price: 0 },
  ],

  // ══ RUNES ASTRALES — dropables en Songe ══════════════════════
  runesAstrales: [
    { name: 'Rune Astrale Mineure',    price: 0 },
    { name: 'Rune Astrale Moyenne',    price: 0 },
    { name: 'Rune Astrale Majeure',    price: 0 },
    { name: 'Rune Astrale Épatante',   price: 0 },
    { name: 'Rune Astrale Merveilleuse', price: 0 },
    { name: 'Rune Astrale Légendaire', price: 0 },
  ],

  // ══ RUNES DE TRANSCENDANCE — craftées (astrales + reflets) ═══
  runesTranscendance: [
    // Résistances % fixes (Merveilleuse)
    { name: 'Trans. Ré Per Air',    price: 0 },
    { name: 'Trans. Ré Per Eau',    price: 0 },
    { name: 'Trans. Ré Per Feu',    price: 0 },
    { name: 'Trans. Ré Per Terre',  price: 0 },
    { name: 'Trans. Ré Per Neutre', price: 0 },
    { name: 'Trans. Ré Per Mé',     price: 0 },
    { name: 'Trans. Ré Per Di',     price: 0 },
    { name: 'Trans. Ré Pou',        price: 0 },
    { name: 'Trans. Ré Cri',        price: 0 },
    // % Dommages (Légendaire)
    { name: 'Trans. Do Per Ar',  price: 0 },
    { name: 'Trans. Do Per Mé',  price: 0 },
    { name: 'Trans. Do Per Di',  price: 0 },
    { name: 'Trans. Do Per So',  price: 0 },
    // Exo PA / PM / PO (Légendaire — les plus chères)
    { name: 'Trans. PA', price: 0 },
    { name: 'Trans. PM', price: 0 },
    { name: 'Trans. PO', price: 0 },
  ],

  // ══ LÉGENDES (ressources drop songe) ═════════════════════════
  // Ce sont les ressources rares droppées en songe qui servent à
  // crafter les équipements légendaires — pas les équipements eux-mêmes
  legendesSonge: [
    // ── Légendes classiques (26) ───────────────────────────
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
    // ── Légendes MÀJ 3.3 (8 nouvelles) ────────────────────
    { name: 'Amayiro', price: 0 },
    { name: 'Helséphine', price: 0 },
    { name: 'Henual', price: 0 },
    { name: 'Oto Mustam', price: 0 },
    { name: 'Menalt', price: 0 },
    { name: 'Mériana', price: 0 },
    { name: 'Miroir', price: 0 },
    { name: 'Thanatena', price: 0 },
    // ── Légendes animales (4) ──────────────────────────────
    { name: 'Légende animale du Bébémoth', price: 0 },
    { name: 'Légende animale de la Tofune', price: 0 },
    { name: 'Légende animale du Mulou', price: 0 },
    { name: 'Légende animale du Chafer', price: 0 },
  ],
};

// ── Signe un JWT ────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: user.isAdmin === true },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─────────────────────────────────────────────────────────────
// Initialisation du compte admin au démarrage (appelée depuis server.js)
// ─────────────────────────────────────────────────────────────
async function ensureAdminExists() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';

  const existing = db.users.findByUsername(adminUsername);
  if (!existing) {
    const hash = await bcrypt.hash(adminPassword, 12);
    const admin = {
      id       : 'admin_' + Date.now().toString(36),
      username : adminUsername,
      password : hash,
      isAdmin  : true,
      createdAt: new Date().toISOString(),
      banned   : false,
    };
    db.users.insert(admin);
    db.prices.set(admin.id, JSON.parse(JSON.stringify(DEFAULT_PRICES)));
    console.log(`✦ Compte admin "${adminUsername}" créé.`);
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const err = validateRegister(username?.trim(), password);
  if (err) return res.status(400).json({ error: err });

  const clean = username.trim();
  const dup   = db.users.findByUsername(clean);
  if (dup) return res.status(409).json({ error: 'Nom d\'utilisateur déjà utilisé.' });

  const hash = await bcrypt.hash(password, 12);
  const user = {
    id       : Date.now().toString(36) + Math.random().toString(36).slice(2),
    username : clean,
    password : hash,
    isAdmin  : false,
    createdAt: new Date().toISOString(),
    banned   : false,
  };

  db.users.insert(user);
  db.prices.set(user.id, JSON.parse(JSON.stringify(DEFAULT_PRICES)));

  return res.status(201).json({ token: signToken(user), username: user.username, isAdmin: false });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Identifiants requis.' });

  const user = db.users.findByUsername(username.trim());

  // Timing constant anti-énumération
  const dummy = '$2a$12$invalidhashfordummycomparison000000000000000000000000';
  const valid = await bcrypt.compare(password, user ? user.password : dummy);

  if (!user || !valid)
    return res.status(401).json({ error: 'Identifiants incorrects.' });

  if (user.banned)
    return res.status(403).json({ error: 'Compte suspendu. Contacte un administrateur.' });

  return res.json({
    token   : signToken(user),
    username: user.username,
    isAdmin : user.isAdmin === true,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = db.users.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  return res.json({
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin === true,
    createdAt: user.createdAt || null,
  });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/auth/password  — changement de mot de passe
// ─────────────────────────────────────────────────────────────
router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Champs requis.' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'Nouveau mot de passe trop court (8 car. min).' });

  const user  = db.users.findById(req.userId);
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.users.update(req.userId, { password: hash });
  return res.json({ success: true });
});

module.exports = router;
module.exports.ensureAdminExists = ensureAdminExists;
