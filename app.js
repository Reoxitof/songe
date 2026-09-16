'use strict';

// dotenv est optionnel — sur cPanel les vars d'env sont injectées directement
try { require('dotenv').config(); } catch (_) {}

const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const db               = require('./db');
const authModule       = require('./routes/auth');
const sessionsRoutes   = require('./routes/sessions');
const pricesRoutes     = require('./routes/prices');
const adminRoutes      = require('./routes/admin');
const forgemagieRoutes = require('./routes/forgemagie');
const requestsRoutes   = require('./routes/requests');
const dofusdbRoutes    = require('./routes/dofusdb');
const panoBuildsRoutes = require('./routes/panobuilds');

const app = express();

// ── Trust proxy (OBLIGATOIRE sur cPanel / LiteSpeed) ─────────
// Sans ça, express-rate-limit crashe sur X-Forwarded-For
app.set('trust proxy', 1);

// ── Initialisation DB (async) — démarre dès le chargement ────
// sql.js charge son WASM de façon asynchrone. Tant que ce n'est
// pas prêt, on renvoie 503 pour les requêtes API.
const dbReady = db.init()
  .then(() => authModule.ensureAdminExists())
  .then(() => console.log('✦ Base SQLite (sql.js) prête.'))
  .catch(err => { console.error('[DB INIT ERROR]', err); });

app.use((req, res, next) => {
  if (db.isReady()) return next();
  // Laisser passer les fichiers statiques, bloquer l'API le temps de l'init
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Serveur en cours de démarrage, réessaie dans 1 seconde.' });
  }
  next();
});

// ── Sécurité HTTP headers ─────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc : ["'self'", "'unsafe-inline'"],
      styleSrc  : ["'self'", "'unsafe-inline'"],
      imgSrc    : ["'self'", "data:", "https://api.dofusdu.de", "https://static.ankama.com"],
    },
  },
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes.' },
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Trop de tentatives.' },
});

// ── Parsers ───────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ── Fichiers statiques ────────────────────────────────────────
// IMPORTANT : pas de cache sur HTML/JS/CSS pour que les mises à jour
// (nouveaux uploads) soient servies immédiatement. Cache long pour
// les assets lourds qui ne changent pas (images, sons, fonts).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7j
    }
  },
}));

// ── Routes API ────────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authModule);
app.use('/api/sessions',   sessionsRoutes);
app.use('/api/prices',     pricesRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/forgemagie', forgemagieRoutes);
app.use('/api/requests',   requestsRoutes);
app.use('/api/dofusdb',    dofusdbRoutes);
app.use('/api/pano-builds', panoBuildsRoutes);

// ── 404 API ───────────────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route API introuvable.' });
});

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Erreur globale ────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erreur interne.' : err.message,
  });
});

// ── Démarrage du serveur ──────────────────────────────────────
// Sous Passenger (cPanel/LiteSpeed), c'est Passenger qui gère le
// socket : il ne faut PAS appeler listen() sinon conflit EADDRINUSE.
// En lancement direct (node app.js hors Passenger), on écoute.
const isPassenger = !!process.env.PASSENGER_BASE_URI
  || !!process.env.PASSENGER_APP_ENV
  || process.title === 'Passenger NodeApp';

if (!isPassenger) {
  const PORT = process.env.PORT || 3000;
  dbReady.then(() => {
    app.listen(PORT, () => {
      console.log(`✦ Songe Tracker v2 — écoute sur le port ${PORT}`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} déjà utilisé (l'app tourne peut-être déjà via Passenger).`);
      } else { throw err; }
    });
  });
}

// ── Export pour Passenger (cPanel) ────────────────────────────
module.exports = app;
module.exports.dbReady = dbReady;
