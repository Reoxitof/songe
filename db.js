'use strict';

/**
 * db.js — Stockage SQLite via sql.js (WebAssembly, aucun binaire natif)
 *
 * Compatible avec tous les hébergements (pas de dépendance GLIBC).
 * La base est chargée en mémoire depuis data/songe.db et RÉÉCRITE sur
 * disque après chaque modification (persistance immédiate).
 *
 * IMPORTANT : sql.js s'initialise de façon asynchrone.
 * Appeler `await db.init()` UNE FOIS au démarrage (dans app.js/server.js)
 * avant de servir les requêtes.
 */

const path       = require('path');
const fs         = require('fs');
const initSqlJs  = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'songe.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let SQL   = null;   // module sql.js
let dbi   = null;   // instance Database
let ready = false;

// ── Schéma ────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL,
    isAdmin INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, date TEXT NOT NULL,
    durationSec INTEGER NOT NULL, floor INTEGER,
    legendes TEXT NOT NULL DEFAULT '[]', runes TEXT NOT NULL DEFAULT '[]',
    dreamPoints INTEGER NOT NULL DEFAULT 0, oniricReflets INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS forgemagie (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, date TEXT NOT NULL, updatedAt TEXT,
    itemNom TEXT NOT NULL, itemType TEXT NOT NULL DEFAULT '',
    prixAchat INTEGER NOT NULL DEFAULT 0, coutCraft INTEGER NOT NULL DEFAULT 0,
    prixVente INTEGER NOT NULL DEFAULT 0, runes TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    tentativeStatut TEXT NOT NULL DEFAULT 'inconnu', exo INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS prices (
    userId TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS requests (
    id         TEXT PRIMARY KEY,
    userId     TEXT NOT NULL,
    username   TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'donjon',
    title      TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reward     TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'ouvert',
    takenBy    TEXT,
    takenByName TEXT,
    date       TEXT NOT NULL,
    updatedAt  TEXT
  );
  CREATE TABLE IF NOT EXISTS pano_builds (
    id       TEXT PRIMARY KEY,
    userId   TEXT NOT NULL,
    name     TEXT NOT NULL,
    class    TEXT NOT NULL DEFAULT '',
    items    TEXT NOT NULL DEFAULT '{}',
    globalFm TEXT NOT NULL DEFAULT '[]',
    date     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_forgemagie_user ON forgemagie(userId);
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_panobuilds_user ON pano_builds(userId);
`;

// ── Persistance : écrit la base mémoire sur disque ────────────
function persist() {
  if (!dbi) return;
  const data = dbi.export();               // Uint8Array
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Init (asynchrone, une seule fois) ─────────────────────────
async function init() {
  if (ready) return;

  // Charger le binaire WASM directement (méthode la plus robuste,
  // évite les problèmes de résolution de chemin sous Passenger/cPanel)
  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);

  SQL = await initSqlJs({ wasmBinary });

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    dbi = new SQL.Database(new Uint8Array(buf));
  } else {
    dbi = new SQL.Database();
  }
  dbi.run(SCHEMA);
  try { dbi.run("ALTER TABLE forgemagie ADD COLUMN tentativeStatut TEXT NOT NULL DEFAULT 'inconnu'"); } catch {}
  try { dbi.run("ALTER TABLE forgemagie ADD COLUMN exo INTEGER NOT NULL DEFAULT 0"); } catch {}
  ready = true;

  migrateFromJSON();
  persist();
}

// ── Helpers internes ──────────────────────────────────────────
function parseJSON(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }

/** Exécute une requête SELECT et renvoie un tableau d'objets */
function query(sql, params = []) {
  const stmt = dbi.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Exécute une requête d'écriture (INSERT/UPDATE/DELETE) puis persiste */
function run(sql, params = []) {
  const stmt = dbi.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  persist();
}

/** Renvoie la première ligne ou null */
function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : null;
}

// ── Mappers ───────────────────────────────────────────────────
function rowToUser(r) {
  if (!r) return null;
  return { id: r.id, username: r.username, password: r.password,
           isAdmin: !!r.isAdmin, banned: !!r.banned, createdAt: r.createdAt };
}
function rowToSession(r) {
  if (!r) return null;
  return { id: r.id, userId: r.userId, date: r.date, durationSec: r.durationSec,
           floor: r.floor, legendes: parseJSON(r.legendes, []), runes: parseJSON(r.runes, []),
           dreamPoints: r.dreamPoints, oniricReflets: r.oniricReflets, notes: r.notes };
}
function rowToForge(r) {
  if (!r) return null;
  return { id: r.id, userId: r.userId, date: r.date, updatedAt: r.updatedAt,
           itemNom: r.itemNom, itemType: r.itemType, prixAchat: r.prixAchat,
           coutCraft: r.coutCraft, prixVente: r.prixVente,
           runes: parseJSON(r.runes, []), notes: r.notes,
           tentativeStatut: r.tentativeStatut || 'inconnu', exo: !!r.exo };
}

// ══════════════════════════════════════════════════════════════
// API : USERS
// ══════════════════════════════════════════════════════════════
const users = {
  all()            { return query('SELECT * FROM users').map(rowToUser); },
  findById(id)     { return rowToUser(get('SELECT * FROM users WHERE id = ?', [id])); },
  findByUsername(u){ return rowToUser(get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [u])); },
  insert(u) {
    run(`INSERT INTO users (id, username, password, isAdmin, banned, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [u.id, u.username, u.password, u.isAdmin ? 1 : 0, u.banned ? 1 : 0, u.createdAt]);
    return u;
  },
  update(id, changes) {
    const fields = [], params = [];
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'isAdmin' || k === 'banned') { fields.push(`${k} = ?`); params.push(v ? 1 : 0); }
      else { fields.push(`${k} = ?`); params.push(v); }
    }
    if (!fields.length) return;
    params.push(id);
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  },
  remove(id) { run('DELETE FROM users WHERE id = ?', [id]); },
  count()    { return get('SELECT COUNT(*) AS c FROM users').c; },
};

// ══════════════════════════════════════════════════════════════
// API : SESSIONS
// ══════════════════════════════════════════════════════════════
const sessions = {
  byUser(userId) {
    return query('SELECT * FROM sessions WHERE userId = ? ORDER BY date DESC', [userId]).map(rowToSession);
  },
  find(id, userId) {
    return rowToSession(get('SELECT * FROM sessions WHERE id = ? AND userId = ?', [id, userId]));
  },
  insert(s) {
    run(`INSERT INTO sessions (id, userId, date, durationSec, floor, legendes, runes, dreamPoints, oniricReflets, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.userId, s.date, s.durationSec, s.floor ?? null,
         JSON.stringify(s.legendes || []), JSON.stringify(s.runes || []),
         s.dreamPoints || 0, s.oniricReflets || 0, s.notes || '']);
    return s;
  },
  remove(id, userId)      { run('DELETE FROM sessions WHERE id = ? AND userId = ?', [id, userId]); },
  removeAllByUser(userId) { run('DELETE FROM sessions WHERE userId = ?', [userId]); },
  countByUser(userId)     { return get('SELECT COUNT(*) AS c FROM sessions WHERE userId = ?', [userId]).c; },
  countAll()              { return get('SELECT COUNT(*) AS c FROM sessions').c; },
};

// ══════════════════════════════════════════════════════════════
// API : FORGEMAGIE
// ══════════════════════════════════════════════════════════════
const forgemagie = {
  byUser(userId) {
    return query('SELECT * FROM forgemagie WHERE userId = ? ORDER BY date DESC', [userId]).map(rowToForge);
  },
  find(id, userId) {
    return rowToForge(get('SELECT * FROM forgemagie WHERE id = ? AND userId = ?', [id, userId]));
  },
  insert(f) {
    run(`INSERT INTO forgemagie (id, userId, date, updatedAt, itemNom, itemType, prixAchat, coutCraft, prixVente, runes, notes, tentativeStatut, exo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.userId, f.date, f.updatedAt ?? null, f.itemNom, f.itemType || '',
         f.prixAchat || 0, f.coutCraft || 0, f.prixVente || 0,
         JSON.stringify(f.runes || []), f.notes || '', f.tentativeStatut || 'inconnu', f.exo ? 1 : 0]);
    return f;
  },
  update(id, userId, f) {
    run(`UPDATE forgemagie SET itemNom=?, itemType=?, prixAchat=?, coutCraft=?, prixVente=?, runes=?, notes=?, tentativeStatut=?, exo=?, updatedAt=?
         WHERE id=? AND userId=?`,
        [f.itemNom, f.itemType || '', f.prixAchat || 0, f.coutCraft || 0, f.prixVente || 0,
         JSON.stringify(f.runes || []), f.notes || '', f.tentativeStatut || 'inconnu', f.exo ? 1 : 0, f.updatedAt || new Date().toISOString(),
         id, userId]);
  },
  remove(id, userId)      { run('DELETE FROM forgemagie WHERE id = ? AND userId = ?', [id, userId]); },
  removeAllByUser(userId) { run('DELETE FROM forgemagie WHERE userId = ?', [userId]); },
  countAll()              { return get('SELECT COUNT(*) AS c FROM forgemagie').c; },
};

// ══════════════════════════════════════════════════════════════
// API : PRICES (une ligne JSON par utilisateur)
// ══════════════════════════════════════════════════════════════
const prices = {
  get(userId) {
    const row = get('SELECT data FROM prices WHERE userId = ?', [userId]);
    return row ? parseJSON(row.data, null) : null;
  },
  set(userId, data) {
    run(`INSERT INTO prices (userId, data) VALUES (?, ?)
         ON CONFLICT(userId) DO UPDATE SET data = excluded.data`,
        [userId, JSON.stringify(data)]);
  },
  remove(userId) { run('DELETE FROM prices WHERE userId = ?', [userId]); },
};

// ══════════════════════════════════════════════════════════════
// API : REQUESTS (entraide alliance — DJ, combat, forgemagie)
// ══════════════════════════════════════════════════════════════
function rowToRequest(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.userId, username: r.username,
    type: r.type, title: r.title, description: r.description,
    reward: r.reward, status: r.status,
    takenBy: r.takenBy, takenByName: r.takenByName,
    date: r.date, updatedAt: r.updatedAt,
  };
}

const requests = {
  all() {
    return query('SELECT * FROM requests ORDER BY date DESC').map(rowToRequest);
  },
  find(id) {
    return rowToRequest(get('SELECT * FROM requests WHERE id = ?', [id]));
  },
  insert(rq) {
    run(`INSERT INTO requests (id, userId, username, type, title, description, reward, status, takenBy, takenByName, date, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rq.id, rq.userId, rq.username, rq.type, rq.title, rq.description || '',
         rq.reward || '', rq.status || 'ouvert', rq.takenBy ?? null, rq.takenByName ?? null,
         rq.date, rq.updatedAt ?? null]);
    return rq;
  },
  update(id, changes) {
    const fields = [], params = [];
    for (const [k, v] of Object.entries(changes)) { fields.push(`${k} = ?`); params.push(v); }
    if (!fields.length) return;
    params.push(id);
    run(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`, params);
  },
  remove(id) { run('DELETE FROM requests WHERE id = ?', [id]); },
  countOpen() {
    return get("SELECT COUNT(*) AS c FROM requests WHERE status = 'ouvert'").c;
  },
};

// ══════════════════════════════════════════════════════════════
// API : PANO_BUILDS (builds de panoplie sauvegardés par utilisateur)
// ══════════════════════════════════════════════════════════════
function rowToBuild(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.userId, name: r.name, class: r.class,
    items: parseJSON(r.items, {}), globalFm: parseJSON(r.globalFm, []), date: r.date,
  };
}

const panoBuilds = {
  byUser(userId) {
    return query('SELECT * FROM pano_builds WHERE userId = ? ORDER BY date DESC', [userId]).map(rowToBuild);
  },
  find(id, userId) {
    return rowToBuild(get('SELECT * FROM pano_builds WHERE id = ? AND userId = ?', [id, userId]));
  },
  insert(b) {
    run(`INSERT INTO pano_builds (id, userId, name, class, items, globalFm, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [b.id, b.userId, b.name, b.class || '', JSON.stringify(b.items || {}),
         JSON.stringify(b.globalFm || []), b.date]);
    return b;
  },
  remove(id, userId)      { run('DELETE FROM pano_builds WHERE id = ? AND userId = ?', [id, userId]); },
  countByUser(userId)     { return get('SELECT COUNT(*) AS c FROM pano_builds WHERE userId = ?', [userId]).c; },
};

// ══════════════════════════════════════════════════════════════
// MIGRATION depuis l'ancien db.json (lowdb)
// ══════════════════════════════════════════════════════════════
function migrateFromJSON() {
  const jsonPath = path.join(DATA_DIR, 'db.json');
  if (!fs.existsSync(jsonPath)) return;
  if (users.count() > 0) return; // déjà migré

  let old;
  try { old = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return; }
  if (!old || !Array.isArray(old.users)) return;

  (old.users || []).forEach(u => {
    try { users.insert({
      id: u.id, username: u.username, password: u.password,
      isAdmin: u.isAdmin === true, banned: u.banned === true,
      createdAt: u.createdAt || new Date().toISOString(),
    }); } catch {}
  });

  (old.sessions || []).forEach(s => {
    try { sessions.insert({
      id: s.id, userId: s.userId, date: s.date, durationSec: s.durationSec,
      floor: s.floor, legendes: s.legendes || [], runes: s.runes || [],
      dreamPoints: s.dreamPoints, oniricReflets: s.oniricReflets, notes: s.notes,
    }); } catch {}
  });

  Object.entries(old.prices || {}).forEach(([userId, data]) => {
    try {
      if (data && data.legendTypes) delete data.legendTypes;
      prices.set(userId, data);
    } catch {}
  });

  Object.entries(old.forgemagie || {}).forEach(([userId, arr]) => {
    (Array.isArray(arr) ? arr : []).forEach(f => {
      try { forgemagie.insert({ ...f, userId }); } catch {}
    });
  });

  try { fs.renameSync(jsonPath, jsonPath + '.migrated'); } catch {}
  console.log('✦ Migration db.json → SQLite (sql.js) terminée.');
}

module.exports = { init, isReady: () => ready, users, sessions, forgemagie, prices, requests, panoBuilds };
