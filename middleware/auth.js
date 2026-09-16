'use strict';

const jwt = require('jsonwebtoken');

/**
 * requireAuth — vérifie le JWT Bearer, injecte req.userId + req.username + req.isAdmin
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou mal formé.' });
  }

  const token = header.slice(7);
  try {
    const payload  = jwt.verify(token, process.env.JWT_SECRET);
    req.userId     = payload.sub;
    req.username   = payload.username;
    req.isAdmin    = payload.isAdmin === true;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
    return res.status(401).json({ error: 'Token invalide.' });
  }
}

/**
 * requireAdmin — à utiliser après requireAuth
 * Bloque si l'utilisateur n'est pas admin
 */
function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
