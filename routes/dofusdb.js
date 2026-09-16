'use strict';

/**
 * routes/dofusdb.js — Proxy vers l'API publique DofusDude (api.dofusdu.de)
 *
 * Pourquoi un proxy ?
 *  - Évite les soucis CORS côté navigateur
 *  - Permet un cache mémoire (l'API est rapide mais on économise des appels)
 *  - Centralise la version du jeu / la langue
 *
 * Endpoints exposés :
 *   GET /api/dofusdb/search?q=texte&slot=chapeau   → liste d'items
 *   GET /api/dofusdb/item/:id                        → détail complet d'un item
 *   GET /api/dofusdb/set/:id                         → bonus de panoplie
 */

const express         = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Config API ────────────────────────────────────────────────
const API_BASE = 'https://api.dofusdu.de/dofus3/v1/fr';
const ANKAMA_AVATAR = 'https://static.ankama.com/dofus/ng/modules/mmorpg/encyclopedia/unity/breeds/assets/avatar';

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/avatar/:breed  — PROXY image d'avatar de classe
//   Ankama bloque le hotlinking par Referer (403 si Referer présent).
//   On récupère l'image côté serveur (sans Referer) et on la sert
//   depuis notre domaine. Route PUBLIQUE (les <img> n'envoient pas
//   le token JWT) et en cache mémoire.
// ─────────────────────────────────────────────────────────────
const _avatarCache = new Map(); // breed => { buf, type, expire }
const AVATAR_TTL = 86400000; // 24h en millisecondes

router.get('/avatar/:breed', async (req, res) => {
  const breed = parseInt(req.params.breed, 10);
  if (!Number.isInteger(breed) || breed < 1 || breed > 20) {
    return res.status(400).end();
  }
  const hit = _avatarCache.get(breed);
  if (hit && hit.expire > Date.now()) {
    res.set('Content-Type', hit.type);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.end(hit.buf);
  }
  try {
    // fetch SANS en-tete Referer -> Ankama renvoie l'image
    const avatarUrl = ANKAMA_AVATAR + '/' + breed + '.jpg';
    const r = await fetch(avatarUrl, { headers: { 'Accept': 'image/*' } });
    if (!r.ok) return res.status(502).end();
    const type = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    _avatarCache.set(breed, { buf, type, expire: Date.now() + AVATAR_TTL });
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.end(buf);
  } catch (err) {
    console.error('[dofusdb avatar]', err.message);
    return res.status(502).end();
  }
});

// À partir d'ici, toutes les routes exigent l'authentification.
router.use(requireAuth);

// ── Cache mémoire simple (clé → { data, expire }) ─────────────
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

function getCache(key) {
  const c = cache.get(key);
  if (c && c.expire > Date.now()) return c.data;
  cache.delete(key);
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, expire: Date.now() + CACHE_TTL });
}

const FETCH_CONCURRENCY = 8;

/** Exécute `fn` sur chaque élément, au plus `limit` appels en parallèle. */
async function mapLimit(list, limit, fn) {
  if (!list.length) return [];
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function bonusFromSet(s, withFormatted) {
  const bonusByCount = {};
  Object.entries(s.effects || {}).forEach(([count, arr]) => {
    if (!Array.isArray(arr)) return;
    bonusByCount[count] = arr.map(e => {
      const row = { name: e.type?.name || '', min: e.int_minimum ?? 0 };
      if (withFormatted) row.formatted = e.formatted || '';
      return row;
    });
  });
  return bonusByCount;
}

async function fetchSetRecord(id) {
  const safe = encodeURIComponent(id);
  const cacheKey = `setraw:${safe}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const s = await apiGet(`${API_BASE}/sets/${safe}`);
  setCache(cacheKey, s);
  return s;
}

async function fetchEquipmentSummary(eqId) {
  const cacheKey = `eqsum:${eqId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const item = await apiGet(`${API_BASE}/items/equipment/${eqId}`);
    const out = {
      id: item.ankama_id,
      name: item.name,
      type: item.type?.name || '',
      level: item.level || 0,
      image: item.image_urls?.icon || '',
      path: 'equipment',
    };
    setCache(cacheKey, out);
    return out;
  } catch {
    return null;
  }
}

// ── fetch (Node 18+ a fetch global) ───────────────────────────
async function apiGet(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API DofusDude: ${res.status}`);
  return res.json();
}

// ── Mapping slot du site → catégorie + types DofusDude ────────
// Tout est sous "equipment" chez DofusDude (armes incluses).
// IMPORTANT : le filtre officiel est `filter[type.name_id]=<id>` où <id> est
// un identifiant ANGLAIS stable (ex: hat, boots, sword...). Un seul type par
// requête (le param ne se cumule pas), donc pour un slot multi-types on fait
// plusieurs requêtes qu'on fusionne.
// Liste des name_id valides : GET /dofus3/v1/meta/items/types
const SLOT_MAP = {
  chapeau  : { path: 'equipment', typeIds: ['hat'] },
  cape     : { path: 'equipment', typeIds: ['cloak'] },
  amulette : { path: 'equipment', typeIds: ['amulet'] },
  anneau   : { path: 'equipment', typeIds: ['ring'] },
  ceinture : { path: 'equipment', typeIds: ['belt'] },
  bottes   : { path: 'equipment', typeIds: ['boots'] },
  bouclier : { path: 'equipment', typeIds: ['shield'] },
  familier : { path: 'equipment', typeIds: ['pet', 'petsmount', 'dragoturkey', 'seemyool', 'rhineetle'] },
  dofus    : { path: 'equipment', typeIds: ['dofus', 'trophy', 'prysmaradite'] },
  arme     : { path: 'equipment', typeIds: ['axe','sword','staff','bow','dagger','hammer','shovel','pickaxe','wand','scythe','lance','magic-weapon'] },
};

// Normalise un item "liste" de l'API vers le format du front
function normalizeListItem(it, path) {
  return {
    id    : it.ankama_id,
    name  : it.name,
    type  : it.type?.name || '',
    level : it.level || 0,
    image : it.image_urls?.icon || '',
    path,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/search?q=...&slot=...
//   Recherche par NOM. Si un slot est fourni, on filtre par type
//   (un appel par type, fusionné) via filter[type.name_id]=<id>.
// ─────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q    = (req.query.q || '').trim();
  const slot = req.query.slot || '';
  if (q.length < 2) return res.json([]);

  const conf = SLOT_MAP[slot];
  const path = conf ? conf.path : 'equipment';

  const cacheKey = `search:${path}:${slot}:${q.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const base = `${API_BASE}/items/${path}/search?query=${encodeURIComponent(q)}&limit=20`;
  // Un type par requête (le filtre ne se cumule pas côté API). Sans slot → un seul appel.
  const typeIds = (conf && conf.typeIds.length) ? conf.typeIds : [null];

  try {
    const results = await Promise.all(typeIds.map(async (tid) => {
      const url = tid ? `${base}&filter[type.name_id]=${encodeURIComponent(tid)}` : base;
      try {
        const data = await apiGet(url);
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    }));

    // Fusion + dédoublonnage par ankama_id, tri par niveau décroissant
    const seen = new Set();
    const out = [];
    results.flat().forEach(it => {
      if (!it || seen.has(it.ankama_id)) return;
      seen.add(it.ankama_id);
      out.push(normalizeListItem(it, path));
    });
    out.sort((a, b) => b.level - a.level);

    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    console.error('[dofusdb search]', err.message);
    return res.status(502).json({ error: 'API Dofus indisponible.' });
  }
});

// Récupère les effets (stats) d'un item, avec cache. Renvoie [] si erreur.
async function getItemEffects(path, id) {
  const cacheKey = `effects:${path}:${id}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const it = await apiGet(`${API_BASE}/items/${path}/${id}`);
    const effects = (it.effects || []).map(e => ({
      name: e.type?.name || '',
      min : e.int_minimum ?? 0,
      max : e.int_maximum ?? 0,
    }));
    setCache(cacheKey, effects);
    return effects;
  } catch { return []; }
}

// Attache les effets à une liste d'items normalisés (en parallèle, borné).
async function attachEffects(items, path) {
  await Promise.all(items.map(async (it) => {
    it.effects = await getItemEffects(path, it.id);
  }));
  return items;
}

// Récupère un plus grand pool d'items d'un slot (plusieurs pages fusionnées),
// utilisé pour le filtrage par stat côté serveur.
async function fetchSlotPool(conf, path, maxPages) {
  const seen = new Set();
  const pool = [];
  for (const tid of conf.typeIds) {
    for (let p = 1; p <= maxPages; p++) {
      // Réessaie avec des tailles décroissantes si l'API renvoie 400
      // (types à faible effectif où page[size] dépasse le total).
      let list = [];
      let usedSize = 50;
      for (const sz of [50, 20, 10, 5]) {
        const url = `${API_BASE}/items/${path}`
          + `?filter[type.name_id]=${encodeURIComponent(tid)}`
          + `&sort[level]=desc`
          + `&page[size]=${sz}`
          + `&page[number]=${p}`;
        try {
          const data = await apiGet(url);
          list = Array.isArray(data?.items) ? data.items : [];
          usedSize = sz;
          break;
        } catch { /* essaie une taille plus petite */ }
      }
      list.forEach(it => {
        if (!it || seen.has(it.ankama_id)) return;
        seen.add(it.ankama_id);
        pool.push(normalizeListItem(it, path));
      });
      if (list.length < usedSize) break; // plus de pages pour ce type
    }
  }
  return pool;
}

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/browse?slot=chapeau&page=1&stat=Force&effects=1
//   - Sans stat : liste paginée triée par niveau (léger).
//   - Avec stat : filtre les items possédant cette stat, triés par
//     valeur de la stat décroissante (nécessite de charger les effets).
//   - effects=1 : joint les effets à chaque item (pour l'affichage).
// ─────────────────────────────────────────────────────────────
router.get('/browse', async (req, res) => {
  const slot   = req.query.slot || '';
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const stat   = (req.query.stat || '').trim(); // 1..N stats séparées par des virgules
  const stats  = stat ? stat.split(',').map(s => s.trim()).filter(Boolean) : [];
  const typeId = (req.query.typeId || '').trim();
  const wantEffects = req.query.effects === '1' || stats.length > 0;
  const baseConf = SLOT_MAP[slot];
  if (!baseConf) return res.status(400).json({ error: 'Slot inconnu.' });

  // Si un sous-type précis est demandé (ex: 'dofus', 'trophy', 'pet'…),
  // on restreint la recherche à ce seul type. Sinon, tous les types du slot.
  const conf = (typeId && baseConf.typeIds.includes(typeId))
    ? { ...baseConf, typeIds: [typeId] }
    : baseConf;

  const path     = conf.path;
  const pageSize = 30;

  const cacheKey = `browse:${path}:${slot}:${typeId}:${page}:${stats.join('|')}:${wantEffects ? 1 : 0}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    // ── Mode FILTRE PAR STAT(S) ──────────────────────────────
    if (stats.length) {
      // Pool élargi (jusqu'à ~150 items/type) puis filtrage/tri par stats.
      const pool = await fetchSlotPool(conf, path, 3);
      await attachEffects(pool, path);

      const norm = s => s.toLowerCase();
      const wanted = stats.map(norm);
      // Garde les items qui possèdent TOUTES les stats demandées ;
      // tri par somme des valeurs de ces stats (décroissant).
      const withStat = pool
        .map(it => {
          let sum = 0;
          const hasAll = wanted.every(w => {
            const eff = (it.effects || []).find(e => norm(e.name) === w);
            if (!eff) return false;
            sum += (eff.max || eff.min || 0);
            return true;
          });
          return hasAll ? { it, val: sum } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.val - a.val)
        .map(x => x.it);

      const start = (page - 1) * pageSize;
      const items = withStat.slice(start, start + pageSize);
      const out = { items, page, hasMore: withStat.length > start + pageSize, stats, total: withStat.length };
      setCache(cacheKey, out);
      return res.json(out);
    }

    // ── Mode LISTE simple (par niveau) ───────────────────────
    // Certains types ont très peu d'items (prysmaradite, montilier…). Si
    // page[size]=30 dépasse le total, l'API renvoie 400. On réessaie alors
    // avec des tailles plus petites pour récupérer ce qui existe.
    const fetchType = async (tid) => {
      for (const sz of [pageSize, 12, 6, 3]) {
        const url = `${API_BASE}/items/${path}`
          + `?filter[type.name_id]=${encodeURIComponent(tid)}`
          + `&sort[level]=desc`
          + `&page[size]=${sz}`
          + `&page[number]=${page}`;
        try {
          const data = await apiGet(url);
          return Array.isArray(data?.items) ? data.items : [];
        } catch { /* essaie une taille plus petite */ }
      }
      return [];
    };
    const perType = await Promise.all(conf.typeIds.map(fetchType));

    const seen = new Set();
    let items = [];

    if (conf.typeIds.length === 1) {
      perType[0].forEach(it => {
        if (!it || seen.has(it.ankama_id)) return;
        seen.add(it.ankama_id);
        items.push(normalizeListItem(it, path));
      });
      items.sort((a, b) => b.level - a.level);
    } else {
      const queues = perType.map(list =>
        (list || []).filter(Boolean).sort((a, b) => (b.level || 0) - (a.level || 0)));
      let added = true;
      while (added && items.length < pageSize) {
        added = false;
        for (const q of queues) {
          const it = q.shift();
          if (!it) continue;
          added = true;
          if (seen.has(it.ankama_id)) continue;
          seen.add(it.ankama_id);
          items.push(normalizeListItem(it, path));
          if (items.length >= pageSize) break;
        }
      }
    }

    if (wantEffects) await attachEffects(items, path);

    const out = { items, page, hasMore: items.length >= pageSize };
    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    console.error('[dofusdb browse]', err.message);
    return res.status(502).json({ error: 'API Dofus indisponible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/item/:id?path=equipment|weapons
// ─────────────────────────────────────────────────────────────
router.get('/item/:id', async (req, res) => {
  const id   = encodeURIComponent(req.params.id);
  const path = ['equipment', 'weapons'].includes(req.query.path) ? req.query.path : 'equipment';

  const cacheKey = `item:${path}:${id}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const it = await apiGet(`${API_BASE}/items/${path}/${id}`);
    // Extraire les stats sous forme exploitable
    const effects = (it.effects || []).map(e => ({
      name    : e.type?.name || '',
      min     : e.int_minimum ?? 0,
      max     : e.int_maximum ?? 0,
      formatted: e.formatted || '',
    }));
    const out = {
      id      : it.ankama_id,
      name    : it.name,
      type    : it.type?.name || '',
      level   : it.level || 0,
      image   : it.image_urls?.icon || '',
      isWeapon: !!it.is_weapon,
      effects,
      setId   : it.parent_set?.id || null,
      setName : it.parent_set?.name || null,
    };
    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    console.error('[dofusdb item]', err.message);
    return res.status(502).json({ error: 'Item introuvable ou API indisponible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/sets/list?page=N  — liste paginée de TOUTES les panoplies
// ─────────────────────────────────────────────────────────────
router.get('/sets/list', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const withBonus = req.query.bonus === '1';
  const pageSize = withBonus ? 20 : 40; // pages plus courtes si on charge les bonus

  const cacheKey = `setslist:${page}:${withBonus ? 1 : 0}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `${API_BASE}/sets?sort[level]=desc&page[size]=${pageSize}&page[number]=${page}`;
    const data = await apiGet(url);
    const list = Array.isArray(data?.sets) ? data.sets : [];
    let items = list.map(s => ({
      id   : s.ankama_id,
      name : s.name,
      count: (s.equipment_ids || []).length,
      level: s.highest_equipment_level || 0,
    }));

    // Bonus + items : 1 fetch set (caché) + 1 fetch par équipement UNIQUE
    // (plusieurs panoplies partagent souvent les mêmes pièces).
    if (withBonus) {
      const enriched = await mapLimit(items, FETCH_CONCURRENCY, async (it) => {
        try {
          const s = await fetchSetRecord(it.id);
          const eqIds = s.equipment_ids || [];
          return {
            ...it,
            count: eqIds.length,
            bonusByCount: bonusFromSet(s, false),
            _eqIds: eqIds,
          };
        } catch {
          return { ...it, bonusByCount: {}, items: [], _eqIds: [] };
        }
      });
      const uniqueIds = [...new Set(enriched.flatMap(it => it._eqIds || []))];
      const summaries = await mapLimit(uniqueIds, FETCH_CONCURRENCY, fetchEquipmentSummary);
      const byId = new Map();
      uniqueIds.forEach((id, i) => { if (summaries[i]) byId.set(id, summaries[i]); });
      items = enriched.map(({ _eqIds, ...it }) => ({
        ...it,
        items: (_eqIds || []).map(id => byId.get(id)).filter(Boolean),
      }));
    }

    const out = { items, page, hasMore: !!(data?._links?.next) };
    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    console.error('[dofusdb sets/list]', err.message);
    return res.status(502).json({ error: 'API Dofus indisponible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/sets/search?q=texte  — recherche de panoplies par nom
// ─────────────────────────────────────────────────────────────
router.get('/sets/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const cacheKey = `setsearch:${q.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await apiGet(`${API_BASE}/sets/search?query=${encodeURIComponent(q)}&limit=20`);
    const out = (Array.isArray(data) ? data : []).map(s => ({
      id   : s.ankama_id,
      name : s.name,
      count: (s.equipment_ids || []).length,
      level: s.highest_equipment_level || 0,
    }));
    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    // 404 = aucune panoplie trouvée → liste vide (pas une erreur pour le front)
    if (String(err.message).includes('404')) return res.json([]);
    console.error('[dofusdb sets/search]', err.message);
    return res.status(502).json({ error: 'API Dofus indisponible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/dofusdb/set/:id?items=1  — bonus de panoplie (+ items si items=1)
// ─────────────────────────────────────────────────────────────
router.get('/set/:id', async (req, res) => {
  const id = encodeURIComponent(req.params.id);
  const withItems = req.query.items === '1';
  const cacheKey = `set:${id}:${withItems ? 1 : 0}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const s = await fetchSetRecord(req.params.id);
    const bonusByCount = bonusFromSet(s, true);

    let items = [];
    if (withItems) {
      const eqIds = s.equipment_ids || [];
      items = (await mapLimit(eqIds, FETCH_CONCURRENCY, async (eqId) => {
        const cacheKey = `item:equipment:${eqId}`;
        const cachedItem = getCache(cacheKey);
        if (cachedItem) {
          return {
            id: cachedItem.id, name: cachedItem.name, type: cachedItem.type,
            level: cachedItem.level, image: cachedItem.image, path: 'equipment',
            effects: cachedItem.effects || [],
          };
        }
        try {
          const it = await apiGet(`${API_BASE}/items/equipment/${eqId}`);
          const effects = (it.effects || []).map(e => ({
            name: e.type?.name || '',
            min : e.int_minimum ?? 0,
            max : e.int_maximum ?? 0,
          }));
          const out = {
            id: it.ankama_id, name: it.name, type: it.type?.name || '',
            level: it.level || 0, image: it.image_urls?.icon || '',
            isWeapon: !!it.is_weapon, effects,
            setId: it.parent_set?.id || null, setName: it.parent_set?.name || null,
          };
          setCache(cacheKey, out);
          setCache(`eqsum:${eqId}`, {
            id: out.id, name: out.name, type: out.type, level: out.level,
            image: out.image, path: 'equipment',
          });
          return {
            id: out.id, name: out.name, type: out.type, level: out.level,
            image: out.image, path: 'equipment', effects,
          };
        } catch { return null; }
      })).filter(Boolean);
    }

    const out = {
      id          : s.ankama_id,
      name        : s.name,
      equipmentIds: s.equipment_ids || [],
      bonusByCount,
      items,
    };
    setCache(cacheKey, out);
    return res.json(out);
  } catch (err) {
    console.error('[dofusdb set]', err.message);
    return res.status(502).json({ error: 'Panoplie introuvable.' });
  }
});

module.exports = router;
