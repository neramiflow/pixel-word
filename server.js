/**
 * server.js — Serveur principal PixelWorld
 * Express + WebSocket + API REST + Sessions
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const db = require('./src/database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'pixelworld-secret-2024';

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
  }
});
app.use(sessionMiddleware);

// Partager la session avec WebSocket
function getSession(req) {
  return new Promise((resolve, reject) => {
    sessionMiddleware(req, {}, () => resolve(req.session));
  });
}

// Middleware d'authentification
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
// ÉTAT MULTIJOUEUR EN MÉMOIRE
// ═══════════════════════════════════════════════════════════

// { socketId → { userId, pseudo, sprite, worldId, x, y, ws } }
const connectedPlayers = new Map();

// ═══════════════════════════════════════════════════════════
// API — AUTHENTIFICATION
// ═══════════════════════════════════════════════════════════

/** POST /api/register — Créer un compte */
app.post('/api/register', async (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  if (pseudo.length < 2 || pseudo.length > 20) return res.status(400).json({ error: 'Pseudo entre 2 et 20 caractères.' });
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court (min 4).' });

  if (db.getUserByPseudo(pseudo)) {
    return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  const user = db.createUser(userId, pseudo, hash);

  req.session.userId = user.id;
  req.session.pseudo = user.pseudo;
  res.json({ success: true, user: { id: user.id, pseudo: user.pseudo, sprite: user.sprite } });
});

/** POST /api/login — Connexion */
app.post('/api/login', async (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo || !password) return res.status(400).json({ error: 'Champs manquants.' });

  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });

  req.session.userId = user.id;
  req.session.pseudo = user.pseudo;
  res.json({ success: true, user: { id: user.id, pseudo: user.pseudo, sprite: user.sprite } });
});

/** POST /api/logout — Déconnexion */
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

/** GET /api/me — Profil courant */
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ id: user.id, pseudo: user.pseudo, sprite: user.sprite });
});

// ═══════════════════════════════════════════════════════════
// API — SPRITE / PERSONNAGE
// ═══════════════════════════════════════════════════════════

/** POST /api/sprite — Sauvegarder le sprite */
app.post('/api/sprite', requireAuth, (req, res) => {
  const { spriteData } = req.body; // tableau 16x16 de couleurs hex
  if (!spriteData || !Array.isArray(spriteData)) {
    return res.status(400).json({ error: 'Données de sprite invalides.' });
  }
  db.updateUserSprite(req.session.userId, spriteData);

  // Notifier les autres joueurs de la mise à jour du sprite
  broadcastToWorld('town', {
    type: 'PLAYER_SPRITE_UPDATE',
    userId: req.session.userId,
    sprite: spriteData
  });

  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// API — MAISONS
// ═══════════════════════════════════════════════════════════

/** GET /api/houses — Toutes les maisons placées */
app.get('/api/houses', (req, res) => {
  const houses = db.getAllHouses().map(h => {
    const owner = db.getUserById(h.user_id);
    return { ...h, pseudo: owner ? owner.pseudo : '???' };
  });
  res.json(houses);
});

/** POST /api/houses — Placer sa maison */
app.post('/api/houses', requireAuth, (req, res) => {
  const { x, y } = req.body;
  if (x === undefined || y === undefined) return res.status(400).json({ error: 'Coordonnées manquantes.' });

  // Un joueur = une seule maison
  if (db.getHouseByUser(req.session.userId)) {
    return res.status(409).json({ error: 'Tu as déjà placé ta maison.' });
  }
  // Vérifier si la case est libre
  if (db.getHouseByPos(x, y)) {
    return res.status(409).json({ error: 'Cette case est déjà occupée.' });
  }

  // Créer le monde privé de la maison
  const worldId = uuidv4();
  db.createWorld(worldId, req.session.userId, `Maison de ${req.session.pseudo}`, 'house');

  const houseId = uuidv4();
  const house = db.createHouse(houseId, req.session.userId, x, y, worldId);

  // Notifier tous les joueurs
  broadcast({ type: 'HOUSE_PLACED', house: { ...house, pseudo: req.session.pseudo } });

  res.json({ success: true, house, worldId });
});

// ═══════════════════════════════════════════════════════════
// API — MONDES
// ═══════════════════════════════════════════════════════════

/** GET /api/worlds — Mes mondes */
app.get('/api/worlds', requireAuth, (req, res) => {
  const worlds = db.getWorldsByOwner(req.session.userId);
  res.json(worlds);
});

/** POST /api/worlds — Créer un nouveau monde (depuis l'ordinateur) */
app.post('/api/worlds', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis.' });

  const worldId = uuidv4();
  const world = db.createWorld(worldId, req.session.userId, name, 'custom');
  res.json({ success: true, world });
});

/** GET /api/worlds/:id — Données d'un monde */
app.get('/api/worlds/:id', requireAuth, (req, res) => {
  const world = db.getWorldById(req.params.id);
  if (!world) return res.status(404).json({ error: 'Monde introuvable.' });
  const tiles = db.getTilesByWorld(req.params.id);
  res.json({ world, tiles });
});

// ═══════════════════════════════════════════════════════════
// API — TUILES
// ═══════════════════════════════════════════════════════════

/** POST /api/tiles — Placer/supprimer une tuile */
app.post('/api/tiles', requireAuth, (req, res) => {
  const { worldId, x, y, layer, tileType, tileData } = req.body;
  if (!worldId || x === undefined || y === undefined || !layer) {
    return res.status(400).json({ error: 'Données manquantes.' });
  }

  // Vérifier que le monde appartient au joueur
  const world = db.getWorldById(worldId);
  if (!world) return res.status(404).json({ error: 'Monde introuvable.' });
  if (world.owner_id !== req.session.userId) return res.status(403).json({ error: 'Non autorisé.' });

  db.setTile(worldId, x, y, layer, tileType, tileData);

  // Diffuser aux joueurs dans ce monde
  broadcastToWorld(worldId, {
    type: 'TILE_UPDATE',
    worldId, x, y, layer, tileType, tileData
  });

  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// API — CODENET
// ═══════════════════════════════════════════════════════════

/** GET /api/codenet — Liste des projets partagés */
app.get('/api/codenet', (req, res) => {
  const posts = db.getAllCodenetPosts().map(p => {
    const user = db.getUserById(p.user_id);
    return { ...p, pseudo: user ? user.pseudo : '???' };
  });
  res.json(posts);
});

/** POST /api/codenet — Partager un monde sur CodeNet */
app.post('/api/codenet', requireAuth, (req, res) => {
  const { worldId, title } = req.body;
  if (!worldId || !title) return res.status(400).json({ error: 'Données manquantes.' });

  const world = db.getWorldById(worldId);
  if (!world || world.owner_id !== req.session.userId) {
    return res.status(403).json({ error: 'Non autorisé.' });
  }

  const tiles = db.getTilesByWorld(worldId);
  const code = JSON.stringify({ world, tiles }, null, 2);

  const postId = uuidv4();
  const post = db.createCodenetPost(postId, req.session.userId, worldId, title, code);

  res.json({ success: true, post });
});

// ═══════════════════════════════════════════════════════════
// WEBSOCKET — MULTIJOUEUR EN TEMPS RÉEL
// ═══════════════════════════════════════════════════════════

wss.on('connection', async (ws, req) => {
  const session = await getSession(req);
  if (!session.userId) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Non authentifié' }));
    ws.close();
    return;
  }

  const socketId = uuidv4();
  const user = db.getUserById(session.userId);

  // Enregistrer le joueur connecté
  connectedPlayers.set(socketId, {
    socketId,
    userId: session.userId,
    pseudo: session.pseudo,
    sprite: user ? user.sprite : null,
    worldId: 'town',
    x: Math.floor(Math.random() * 20) + 5,
    y: Math.floor(Math.random() * 15) + 5,
    ws
  });

  console.log(`[WS] ${session.pseudo} connecté (${socketId})`);

  // Envoyer l'état initial à ce joueur
  const player = connectedPlayers.get(socketId);
  ws.send(JSON.stringify({
    type: 'INIT',
    socketId,
    player: sanitizePlayer(player),
    players: getPlayersInWorld('town').map(sanitizePlayer),
    houses: db.getAllHouses().map(h => {
      const owner = db.getUserById(h.user_id);
      return { ...h, pseudo: owner ? owner.pseudo : '???' };
    })
  }));

  // Annoncer l'arrivée aux autres
  broadcastToWorld('town', {
    type: 'PLAYER_JOINED',
    player: sanitizePlayer(player)
  }, socketId);

  // ─── Réception des messages ───────────────────────────────

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const p = connectedPlayers.get(socketId);
    if (!p) return;

    switch (msg.type) {

      case 'MOVE': {
        // Déplacement du joueur
        p.x = Math.max(0, Math.min(39, msg.x));
        p.y = Math.max(0, Math.min(29, msg.y));
        broadcastToWorld(p.worldId, {
          type: 'PLAYER_MOVED',
          socketId,
          x: p.x,
          y: p.y
        }, socketId);
        break;
      }

      case 'ENTER_WORLD': {
        // Changer de monde (entrer dans une maison, etc.)
        const oldWorld = p.worldId;
        p.worldId = msg.worldId;
        p.x = 5;
        p.y = 5;

        // Quitter l'ancien monde
        broadcastToWorld(oldWorld, { type: 'PLAYER_LEFT', socketId }, socketId);

        // Rejoindre le nouveau monde
        broadcastToWorld(msg.worldId, {
          type: 'PLAYER_JOINED',
          player: sanitizePlayer(p)
        }, socketId);

        // Envoyer l'état du nouveau monde
        const world = db.getWorldById(msg.worldId);
        const tiles = world ? db.getTilesByWorld(msg.worldId) : [];
        ws.send(JSON.stringify({
          type: 'WORLD_STATE',
          worldId: msg.worldId,
          tiles,
          players: getPlayersInWorld(msg.worldId).map(sanitizePlayer)
        }));
        break;
      }

      case 'LEAVE_WORLD': {
        // Retourner en ville
        broadcastToWorld(p.worldId, { type: 'PLAYER_LEFT', socketId }, socketId);
        p.worldId = 'town';
        p.x = Math.floor(Math.random() * 20) + 5;
        p.y = Math.floor(Math.random() * 15) + 5;
        broadcastToWorld('town', {
          type: 'PLAYER_JOINED',
          player: sanitizePlayer(p)
        }, socketId);
        ws.send(JSON.stringify({
          type: 'RETURNED_TO_TOWN',
          players: getPlayersInWorld('town').map(sanitizePlayer)
        }));
        break;
      }

      case 'CHAT': {
        // Message de chat simple
        broadcastToWorld(p.worldId, {
          type: 'CHAT',
          pseudo: p.pseudo,
          text: String(msg.text).slice(0, 100)
        });
        break;
      }

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;
    }
  });

  // ─── Déconnexion ─────────────────────────────────────────

  ws.on('close', () => {
    const p = connectedPlayers.get(socketId);
    if (p) {
      broadcastToWorld(p.worldId, { type: 'PLAYER_LEFT', socketId });
      connectedPlayers.delete(socketId);
      console.log(`[WS] ${session.pseudo} déconnecté`);
    }
  });
});

// ─── Helpers WebSocket ────────────────────────────────────

function sanitizePlayer(p) {
  return { socketId: p.socketId, userId: p.userId, pseudo: p.pseudo, sprite: p.sprite, x: p.x, y: p.y, worldId: p.worldId };
}

function getPlayersInWorld(worldId) {
  return [...connectedPlayers.values()].filter(p => p.worldId === worldId);
}

function broadcast(msg, exceptSocketId = null) {
  const data = JSON.stringify(msg);
  for (const p of connectedPlayers.values()) {
    if (p.socketId !== exceptSocketId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

function broadcastToWorld(worldId, msg, exceptSocketId = null) {
  const data = JSON.stringify(msg);
  for (const p of connectedPlayers.values()) {
    if (p.worldId === worldId && p.socketId !== exceptSocketId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// DÉMARRAGE
// ═══════════════════════════════════════════════════════════

server.listen(PORT, () => {
  console.log(`\n🌍 PixelWorld démarré sur http://localhost:${PORT}`);
  console.log(`🔌 WebSocket sur ws://localhost:${PORT}`);
});
