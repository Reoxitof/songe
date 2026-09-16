# Songe Tracker

Suivi des drops de songe, de la forgemagie et créateur de panoplie Dofus. Node.js 18+, Express, JWT, SQLite en mémoire via `sql.js` (aucun binaire natif, compatible cPanel / Passenger).

## Lancer en local

```bash
cp .env.example .env
# renseigner JWT_SECRET (64 caractères min) et ADMIN_PASSWORD
npm install
npm run dev
```

Ouvre `http://localhost:3000`. `npm start` lance `app.js` (mode Passenger / production). `npm run dev` lance `server.js` + nodemon.

## Scripts

| Commande | Rôle |
|---|---|
| `npm start` | Production / cPanel |
| `npm run dev` | Développement |
| `npm test` | Tests `node:test` |

## Données

La base est écrite dans `data/songe.db` (ignoré par git). Un ancien `data/db.json` est migré automatiquement au premier démarrage.

## Modules

- **Songe** — sessions, drops, valeur kamas, export CSV
- **Forgemagie** — coûts, runes, exo, stats
- **Panoplies** — stuff live via [DofusDude](https://api.dofusdu.de), brouillon local (F5), builds sauvegardés
- **Entraide** — demandes d’alliance
- **Admin** — `/admin.html` (compte admin créé au boot)

## Déploiement cPanel

Passenger charge `app.js` (pas de `listen()` sous Passenger). Garder `.htaccess`. Variables d’environnement injectées par cPanel ; `dotenv` reste optionnel.
