'use strict';

try { require('dotenv').config(); } catch (_) {}

const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const db               = require('./db');
const authModule       = require('./routes/auth');
const authRoutes       = authModule;
const sessionsRoutes   = require('./routes/sessions');
const pricesRoutes     = require('./routes/prices');
const adminRoutes      = require('./routes/admin');
const forgemagieRoutes = require('./routes/forgemagie');
const requestsRoutes   = require('./routes/requests');
const dofusdbRoutes    = require('./routes/dofusdb');
const panoBuildsRoutes = require('./routes/panobuilds');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy (reverse proxy LiteSpeed/Nginx/Apache) ────────
app.set('trust proxy', 1);

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

// ── Rate limiting ─────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max     : 300,
  standardHeaders: true,
  legacyHeaders  : false,
  message: { error: 'Trop de requêtes, réessaie dans quelques minutes.' },
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max     : 20,
  message : { error: 'Trop de tentatives de connexion.' },
});

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ── Fichiers statiques ────────────────────────────────────────
// Pas de cache sur HTML/JS/CSS (uploads servis immédiatement),
// cache long sur les assets lourds (images, sons).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

// ── Routes API ────────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authRoutes);
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
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur interne.'
      : err.message,
  });
});

// ── Démarrage : init DB (async) PUIS listen ───────────────────
(async () => {
  try {
    await db.init();                    // charge sql.js + WASM
    await authModule.ensureAdminExists();
  } catch (err) {
    console.error('[DB INIT ERROR]', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✦ Songe Tracker v2 — port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} déjà utilisé. Change PORT dans .env`);
      process.exit(1);
    }
    throw err;
  });
})();

module.exports = app;
