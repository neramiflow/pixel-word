# 🌍 PixelWorld — Jeu multijoueur pixel-art sandbox

> Jeu complet : authentification, éditeur pixel-art, ville multijoueur, maisons privées, éditeur de mondes, WebSocket temps réel.

---

## 🚀 Lancement rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer le serveur
npm start

# 3. Ouvrir dans le navigateur
# → http://localhost:3000
```

---

## 🏗 Architecture

```
pixelworld/
├── server.js              # Serveur Express + WebSocket
├── src/
│   └── database.js        # Couche d'accès aux données (JSON/fichier)
├── public/
│   ├── index.html         # Interface unique (SPA)
│   ├── css/style.css      # Styles complets
│   └── js/
│       ├── api.js         # Utilitaires HTTP
│       ├── sprite-editor.js  # Éditeur pixel-art 8×8 / 16×16
│       ├── town.js        # Ville multijoueur
│       ├── house.js       # Maison + éditeur de tuiles
│       ├── computer.js    # Ordinateur + CodeNet
│       └── app.js         # Contrôleur principal + WebSocket
└── db/
    └── pixelworld.json    # Base de données (générée auto)
```

---

## 🗄 Schéma de données

```json
{
  "users": [
    {
      "id": "uuid",
      "pseudo": "string",
      "password_hash": "bcrypt_hash",
      "sprite": ["#ff0000", null, ...],  // tableau 64 ou 256 couleurs
      "created_at": 1700000000000
    }
  ],
  "houses": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "x": 10,
      "y": 8,
      "world_id": "uuid"
    }
  ],
  "worlds": [
    {
      "id": "uuid",
      "owner_id": "uuid",
      "name": "Ma maison",
      "type": "house | custom",
      "created_at": 1700000000000
    }
  ],
  "tiles": [
    {
      "id": "worldId_x_y_layer",
      "world_id": "uuid",
      "x": 5,
      "y": 3,
      "layer": "floor | object",
      "tile_type": "grass | stone | ...",
      "tile_data": null
    }
  ],
  "codenet_posts": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "world_id": "uuid",
      "title": "Mon projet",
      "code": "{\"world\":{...},\"tiles\":[...]}",
      "created_at": 1700000000000
    }
  ]
}
```

---

## 🔌 Endpoints API REST

### Authentification
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/register` | Créer un compte `{ pseudo, password }` |
| POST | `/api/login` | Connexion `{ pseudo, password }` |
| POST | `/api/logout` | Déconnexion |
| GET  | `/api/me` | Profil courant (session requise) |

### Sprite / Personnage
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/sprite` | Sauvegarder sprite `{ spriteData: [colors] }` |

### Maisons
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/houses` | Toutes les maisons placées |
| POST | `/api/houses` | Placer sa maison `{ x, y }` |

### Mondes
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/worlds` | Mes mondes |
| POST | `/api/worlds` | Créer un monde `{ name }` |
| GET  | `/api/worlds/:id` | Données d'un monde + ses tuiles |

### Tuiles
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/tiles` | Placer/supprimer une tuile `{ worldId, x, y, layer, tileType }` |

### CodeNet
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/codenet` | Liste des projets partagés |
| POST | `/api/codenet` | Partager un monde `{ worldId, title }` |

---

## 📡 Messages WebSocket

### Client → Serveur
```json
{ "type": "MOVE", "x": 10, "y": 8 }
{ "type": "ENTER_WORLD", "worldId": "uuid" }
{ "type": "LEAVE_WORLD" }
{ "type": "CHAT", "text": "Bonjour !" }
{ "type": "PING" }
```

### Serveur → Client
```json
{ "type": "INIT", "socketId": "...", "player": {...}, "players": [...], "houses": [...] }
{ "type": "PLAYER_JOINED", "player": {...} }
{ "type": "PLAYER_LEFT", "socketId": "..." }
{ "type": "PLAYER_MOVED", "socketId": "...", "x": 10, "y": 8 }
{ "type": "PLAYER_SPRITE_UPDATE", "userId": "...", "sprite": [...] }
{ "type": "HOUSE_PLACED", "house": {...} }
{ "type": "TILE_UPDATE", "worldId": "...", "x": 5, "y": 3, "layer": "floor", "tileType": "grass" }
{ "type": "WORLD_STATE", "worldId": "...", "tiles": [...], "players": [...] }
{ "type": "RETURNED_TO_TOWN", "players": [...] }
{ "type": "CHAT", "pseudo": "...", "text": "..." }
```

---

## 🎮 Contrôles

- **ZQSD** ou **Flèches** : déplacer le personnage
- **Entrée** ou **Espace** : interagir (entrer dans une maison, placer sa maison)
- **Clic** sur la carte : déplacement / interaction
- **Clic** sur une tuile de palette + clic sur la grille : dessiner

---

## 🛠 Stack technique

- **Front** : HTML5 + CSS3 + JavaScript vanilla (Canvas API)
- **Back** : Node.js + Express.js
- **WebSocket** : ws (bibliothèque native Node.js)
- **Authentification** : express-session + bcryptjs (bcrypt)
- **BDD** : JSON fichier (compatible SQLite/PostgreSQL avec migration triviale)
- **Temps réel** : WebSocket bidirectionnel

---

## 🔄 Migration vers une vraie BDD SQL

Pour passer à SQLite ou PostgreSQL, remplace `src/database.js` par :

```js
// Exemple SQLite avec better-sqlite3
const Database = require('better-sqlite3');
const db = new Database('./db/pixelworld.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    pseudo TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    sprite TEXT,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS houses (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    x INTEGER,
    y INTEGER,
    world_id TEXT
  );
  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    name TEXT,
    type TEXT,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tiles (
    id TEXT PRIMARY KEY,
    world_id TEXT,
    x INTEGER,
    y INTEGER,
    layer TEXT,
    tile_type TEXT,
    tile_data TEXT
  );
  CREATE TABLE IF NOT EXISTS codenet_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    world_id TEXT,
    title TEXT,
    code TEXT,
    created_at INTEGER
  );
`);
```
