import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const START_PORT = Number(process.env.PORT || 3000);
const WORLD = { width: 2400, height: 720, tile: 48, groundY: 624 };
const ROUND_DURATION_MS = 60000;
const COUNTDOWN_MS = 3000;
const RESULTS_MS = 5000;

const ANIMALS = [
  { id: 'rabbit', name: '兔子', color: '#f8f0ff', emoji: '🐰' },
  { id: 'fox', name: '狐狸', color: '#ff8a3d', emoji: '🦊' },
  { id: 'pig', name: '小猪', color: '#ffb4c8', emoji: '🐷' },
  { id: 'chick', name: '小鸡', color: '#ffe36e', emoji: '🐔' },
];

const TOOLS = [
  { id: 'spring', name: '弹簧跳板', kind: 'spring' },
  { id: 'spike', name: '尖刺地板', kind: 'spike' },
  { id: 'arrow', name: '箭矢炮塔', kind: 'turret' },
  { id: 'cannon', name: '加农炮塔', kind: 'turret' },
];

const DIRECTIONS = [
  { id: 'up', dx: 0, dy: -1, angle: -Math.PI / 2 },
  { id: 'right', dx: 1, dy: 0, angle: 0 },
  { id: 'down', dx: 0, dy: 1, angle: Math.PI / 2 },
  { id: 'left', dx: -1, dy: 0, angle: Math.PI },
];

const staticPlatforms = [
  { x: 160, y: 520, w: 240, h: 24 },
  { x: 520, y: 440, w: 180, h: 24 },
  { x: 900, y: 380, w: 220, h: 24 },
  { x: 1320, y: 500, w: 220, h: 24 },
  { x: 1700, y: 420, w: 260, h: 24 },
  { x: 2040, y: 360, w: 180, h: 24 },
  { x: 2320, y: 500, w: 160, h: 24 },
];

const goal = { x: WORLD.width - 120, y: WORLD.groundY - 104, w: 52, h: 104 };

const sockets = new Map();
const players = new Map();
let items = [];
let projectiles = [];
let phase = 'lobby';
let phaseEndsAt = 0;
let roundNumber = 1;
let resultMessage = '';
let lastBroadcastAt = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function randomColor(seed) {
  const colors = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#f783ac', '#ffa94d', '#74c0fc', '#b197fc'];
  return colors[seed % colors.length];
}

function spawnPointFor(index) {
  return {
    x: 96 + index * 48,
    y: WORLD.groundY - 60,
  };
}

function makePlayer(id, name, animalId, index = 0) {
  const animal = ANIMALS.find((entry) => entry.id === animalId) || ANIMALS[0];
  const spawn = spawnPointFor(index);
  const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return {
    id,
    name: name?.trim().slice(0, 16) || `P${players.size + 1}`,
    animalId: animal.id,
    animalName: animal.name,
    animalColor: animal.color,
    color: randomColor(seed),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    w: 30,
    h: 42,
    onGround: false,
    facing: 1,
    input: { left: false, right: false, jump: false, jumpHeld: false },
    toolId: 'spring',
    directionIndex: 1,
    lobbyReady: false,
    buildPlaced: false,
    finished: false,
    finishUntil: 0,
    respawnUntil: 0,
    springBounceUntil: 0,
    score: 0,
  };
}

function itemDefinition(toolId) {
  switch (toolId) {
    case 'spring':
      return { toolId, kind: 'spring', w: 48, h: 20 };
    case 'spike':
      return { toolId, kind: 'spike', w: 48, h: 28 };
    case 'arrow':
    case 'cannon':
      return { toolId, kind: 'turret', w: 48, h: 48 };
    default:
      return { toolId: 'spring', kind: 'spring', w: 48, h: 20 };
  }
}

function itemBox(item) {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function solids() {
  return [
    { kind: 'ground', x: 0, y: WORLD.groundY, w: WORLD.width, h: WORLD.height - WORLD.groundY },
    ...staticPlatforms.map((platform) => ({ ...platform, kind: 'platform' })),
    ...items.map((item) => ({ ...itemBox(item), kind: item.kind, toolId: item.toolId })),
  ];
}

function resetToLobby() {
  phase = 'lobby';
  phaseEndsAt = 0;
  resultMessage = '';
  items = [];
  projectiles = [];
  for (const player of players.values()) {
    const index = Array.from(players.keys()).indexOf(player.id);
    const spawn = spawnPointFor(index);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.facing = 1;
    player.input = { left: false, right: false, jump: false, jumpHeld: false };
    player.toolId = 'spring';
    player.directionIndex = 1;
    player.lobbyReady = false;
    player.buildPlaced = false;
    player.finished = false;
    player.finishUntil = 0;
    player.respawnUntil = 0;
    player.springBounceUntil = 0;
  }
}


function startBuild(now) {
  phase = 'build';
  phaseEndsAt = 0;
  for (const player of players.values()) {
    player.buildPlaced = false;
    player.finished = false;
    player.finishUntil = 0;
    player.respawnUntil = 0;
    player.springBounceUntil = 0;
  }
  items = [];
  projectiles = [];
}

function startCountdownToBattle(now) {
  phase = 'countdown_to_battle';
  phaseEndsAt = now + COUNTDOWN_MS;
}

function startBattle(now) {
  phase = 'battle';
  phaseEndsAt = now + ROUND_DURATION_MS;
  for (const item of items) {
    if (item.kind === 'turret') {
      item.lastShotAt = now;
    }
  }
}

function startResults(now, message) {
  phase = 'results';
  phaseEndsAt = now + RESULTS_MS;
  resultMessage = message;
}

function clampSpawn(index) {
  const spawn = spawnPointFor(index);
  return {
    x: spawn.x,
    y: spawn.y,
  };
}

function respawnPlayer(player) {
  const index = Array.from(players.keys()).indexOf(player.id);
  const spawn = clampSpawn(index);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  player.respawnUntil = 0;
  player.finished = false;
  player.springBounceUntil = 0;
}

function killPlayer(player, now) {
  player.respawnUntil = now + 1500;
  player.vx = 0;
  player.vy = 0;
}

function allJoinedPlayers(conditionFn) {
  const list = Array.from(players.values());
  return list.length > 0 && list.every(conditionFn);
}

function canJoin() {
  return phase === 'lobby';
}

function setPlayerAnimal(player, animalId) {
  const animal = ANIMALS.find((entry) => entry.id === animalId);
  if (!animal) return false;
  const takenByOther = Array.from(players.values()).some((entry) => entry.id !== player.id && entry.animalId === animalId);
  if (takenByOther) return false;
  player.animalId = animal.id;
  player.animalName = animal.name;
  player.animalColor = animal.color;
  player.lobbyReady = false;
  return true;
}

function makeProjectile(item, now) {
  const dir = DIRECTIONS[item.directionIndex] || DIRECTIONS[1];
  const centerX = item.x + item.w / 2;
  const centerY = item.y + item.h / 2;
  const offset = 28;

  if (item.toolId === 'arrow') {
    return {
      id: randomUUID(),
      type: 'arrow',
      ownerId: item.ownerId,
      x: centerX + dir.dx * offset,
      y: centerY + dir.dy * offset,
      vx: dir.dx * 7.2,
      vy: dir.dy * 7.2,
      w: 18,
      h: 6,
      angle: dir.angle,
      gravity: 0.18,
      bornAt: now,
    };
  }

  return {
    id: randomUUID(),
    type: 'cannon',
    ownerId: item.ownerId,
    x: centerX + dir.dx * offset,
    y: centerY + dir.dy * offset,
    vx: dir.dx * 11,
    vy: dir.dy * 11,
    r: 11,
    angle: dir.angle,
    gravity: 0,
    bornAt: now,
  };
}

function handlePlayerMotion(player, now) {
  if (player.respawnUntil && now >= player.respawnUntil) {
    respawnPlayer(player);
  }
  if (player.finished) {
    if (now >= player.finishUntil) {
      respawnPlayer(player);
    }
    return;
  }

  // 丝滑物理参数
  const accel = 0.85;
  const maxSpeed = 5.8;
  const friction = 0.85;
  const airFriction = 0.92;
  const gravity = 0.48;
  const jumpVelocity = 12.0;
  const airControl = 0.6;

  const inp = player.input;

  // 水平移动
  if (inp.left) {
    const control = player.onGround ? accel : accel * airControl;
    player.vx = Math.max(player.vx - control, -maxSpeed);
    player.facing = -1;
  }
  if (inp.right) {
    const control = player.onGround ? accel : accel * airControl;
    player.vx = Math.min(player.vx + control, maxSpeed);
    player.facing = 1;
  }
  if (!inp.left && !inp.right) {
    const fric = player.onGround ? friction : airFriction;
    player.vx *= fric;
    if (Math.abs(player.vx) < 0.08) player.vx = 0;
  }

  // 跳跃：edge-triggered（jump 只在按下瞬间为 true）
  if (inp.jump && player.onGround) {
    player.vy = -jumpVelocity;
    player.onGround = false;
  }

  // 变量跳跃高度：松开跳跃键（jumpHeld 为 false）时削减上升速度
  // 这样短按空格跳得低，长按空格跳得高
  if (!inp.jumpHeld && player.vy < -3) {
    player.vy += 0.8; // 快速削减上升速度
  }

  player.vy += gravity;
  player.vy = Math.min(player.vy, 18);

  // 水平碰撞
  player.x += player.vx;
  for (const solid of solids()) {
    if (!rectsIntersect(player, solid)) continue;
    if (solid.kind === 'spike') {
      killPlayer(player, now);
      return;
    }
    if (player.vx > 0) player.x = solid.x - player.w;
    else if (player.vx < 0) player.x = solid.x + solid.w;
    player.vx = 0;
  }

  // 垂直碰撞
  player.y += player.vy;
  player.onGround = false;
  let landedOnSpring = false;
  for (const solid of solids()) {
    if (!rectsIntersect(player, solid)) continue;
    if (solid.kind === 'spike') {
      killPlayer(player, now);
      return;
    }
    if (player.vy > 0) {
      player.y = solid.y - player.h;
      player.vy = 0;
      player.onGround = true;
      if (solid.kind === 'spring' && now >= player.springBounceUntil) {
        landedOnSpring = true;
        player.springBounceUntil = now + 200;
      }
    } else if (player.vy < 0) {
      player.y = solid.y + solid.h;
      player.vy = 0;
    }
  }

  // 弹簧弹跳
  if (landedOnSpring) {
    player.vy = -14.0;
    player.onGround = false;
  }

  player.x = clamp(player.x, 0, WORLD.width - player.w);
  if (player.y > WORLD.height + 120) {
    killPlayer(player, now);
  }

  if (rectsIntersect(player, goal)) {
    player.score += 1;
    player.finished = true;
    player.finishUntil = now + 1800;
  }
}

function stepProjectiles(now) {
  const next = [];
  for (const projectile of projectiles) {
    projectile.vy += projectile.gravity || 0;
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.angle = Math.atan2(projectile.vy, projectile.vx || 0.0001);

    const outOfBounds =
      projectile.x < -80 ||
      projectile.x > WORLD.width + 80 ||
      projectile.y < -120 ||
      projectile.y > WORLD.height + 120;
    if (outOfBounds) {
      continue;
    }

    const hitBox = projectile.type === 'cannon'
      ? { x: projectile.x - projectile.r, y: projectile.y - projectile.r, w: projectile.r * 2, h: projectile.r * 2 }
      : { x: projectile.x - projectile.w / 2, y: projectile.y - projectile.h / 2, w: projectile.w, h: projectile.h };

    let dead = false;
    for (const solid of solids()) {
      if (rectsIntersect(hitBox, solid)) {
        dead = true;
        break;
      }
    }
    if (dead) continue;

    for (const player of players.values()) {
      if (player.id === projectile.ownerId) continue;
      if (rectsIntersect(hitBox, player)) {
        killPlayer(player, now);
        dead = true;
        break;
      }
    }
    if (!dead) next.push(projectile);
  }
  projectiles = next;
}

function getRoundWinnerMessage() {
  if (players.size === 0) return 'No players';
  const sorted = Array.from(players.values()).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = sorted[0];
  return top ? `Winner: ${top.name}` : 'Round complete';
}

function serializeState(now) {
  return {
    type: 'state',
    phase,
    phaseEndsAt,
    roundNumber,
    resultMessage,
    world: WORLD,
    goal,
    animals: ANIMALS.map(a => ({ id: a.id, name: a.name, color: a.color, emoji: a.emoji })),
    tools: TOOLS,
    directions: DIRECTIONS,
    platforms: staticPlatforms,
    items: items.map((item) => ({
      id: item.id,
      ownerId: item.ownerId,
      toolId: item.toolId,
      kind: item.kind,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      directionIndex: item.directionIndex,
      angle: DIRECTIONS[item.directionIndex]?.angle || 0,
      nextShotIn: item.kind === 'turret' ? Math.max(0, 2000 - ((now - item.lastShotAt) || 0)) : 0,
    })),
    projectiles: projectiles.map((projectile) => ({
      id: projectile.id,
      type: projectile.type,
      x: projectile.x,
      y: projectile.y,
      w: projectile.w || projectile.r * 2,
      h: projectile.h || projectile.r * 2,
      r: projectile.r || 0,
      angle: projectile.angle,
    })),
    players: Array.from(players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      animalId: player.animalId,
      animalName: player.animalName,
      animalColor: player.animalColor,
      color: player.color,
      x: player.x,
      y: player.y,
      w: player.w,
      h: player.h,
      score: player.score,
      facing: player.facing,
      lobbyReady: player.lobbyReady,
      buildPlaced: player.buildPlaced,
      finished: player.finished,
      toolId: player.toolId,
      directionIndex: player.directionIndex,
      respawnUntil: player.respawnUntil,
    })),
  };
}

function broadcastState(now = Date.now()) {
  const payload = JSON.stringify(serializeState(now));
  for (const socket of sockets.keys()) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
  lastBroadcastAt = now;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(publicDir, path.normalize(urlPath).replace(/^([.][.][/\\])+/, ''));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('error', (error) => {
  if (error?.code !== 'EADDRINUSE') {
    console.error(error);
  }
});

wss.on('connection', (socket) => {
  const id = randomUUID();
  sockets.set(socket, { id });
  socket.send(JSON.stringify({ type: 'welcome', id }));
  broadcastState();

  socket.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const session = sockets.get(socket);
    const player = session ? players.get(session.id) : null;

    if (data.type === 'join') {
      if (!canJoin()) {
        socket.send(JSON.stringify({ type: 'joinRejected', reason: 'lobby_only' }));
        return;
      }
      if (player) {
        socket.send(JSON.stringify({ type: 'joinRejected', reason: 'already_joined' }));
        return;
      }

      const animalId = typeof data.animalId === 'string' ? data.animalId : '';
      const animal = ANIMALS.find((entry) => entry.id === animalId);
      if (!animal) {
        socket.send(JSON.stringify({ type: 'joinRejected', reason: 'invalid_animal' }));
        return;
      }
      if (Array.from(players.values()).some((entry) => entry.animalId === animalId)) {
        socket.send(JSON.stringify({ type: 'joinRejected', reason: 'animal_taken' }));
        return;
      }

      const index = players.size;
      players.set(session.id, makePlayer(session.id, data.name, animalId, index));
      socket.send(JSON.stringify({ type: 'joinAccepted', playerId: session.id }));
      broadcastState();
      return;
    }

    if (!player) {
      return;
    }

    if (data.type === 'selectAnimal' && phase === 'lobby' && !player.lobbyReady) {
      if (typeof data.animalId === 'string' && setPlayerAnimal(player, data.animalId)) {
        broadcastState();
      } else {
        socket.send(JSON.stringify({ type: 'selectRejected', reason: 'animal_taken' }));
      }
      return;
    }

    if (data.type === 'ready' && phase === 'lobby' && !player.lobbyReady) {
      player.lobbyReady = true;
      broadcastState();
      if (allJoinedPlayers((entry) => entry.lobbyReady)) {
        startBuild(Date.now());
      }
      return;
    }

    if (data.type === 'config' && phase === 'build' && !player.buildPlaced) {
      if (typeof data.toolId === 'string' && TOOLS.some((tool) => tool.id === data.toolId)) {
        player.toolId = data.toolId;
      }
      if (typeof data.directionIndex === 'number') {
        player.directionIndex = ((data.directionIndex % 4) + 4) % 4;
      }
      broadcastState();
      return;
    }

    if (data.type === 'input' && (phase === 'build' || phase === 'battle')) {
      player.input = {
        left: Boolean(data.left),
        right: Boolean(data.right),
        jump: Boolean(data.jump),
        jumpHeld: Boolean(data.jumpHeld),
      };
      return;
    }

    if (data.type === 'place' && phase === 'build' && !player.buildPlaced) {
      if (typeof data.toolId === 'string' && TOOLS.some((tool) => tool.id === data.toolId)) {
        player.toolId = data.toolId;
      }
      if (typeof data.directionIndex === 'number') {
        player.directionIndex = ((data.directionIndex % 4) + 4) % 4;
      }
      const def = itemDefinition(player.toolId);
      const rawX = Number.isFinite(data.x) ? data.x : player.x;
      const rawY = Number.isFinite(data.y) ? data.y : player.y;
      const candidate = {
        id: randomUUID(),
        ownerId: player.id,
        toolId: player.toolId,
        kind: def.kind,
        x: clamp(Math.round(rawX / WORLD.tile) * WORLD.tile, 0, WORLD.width - def.w),
        y: clamp(Math.round(rawY / WORLD.tile) * WORLD.tile, 0, WORLD.height - def.h),
        w: def.w,
        h: def.h,
        directionIndex: player.directionIndex,
        lastShotAt: 0,
      };

      const candidateBox = itemBox(candidate);
      const overlaps = items.some((item) => rectsIntersect(candidateBox, itemBox(item)));
      if (overlaps || rectsIntersect(candidateBox, goal)) {
        socket.send(JSON.stringify({ type: 'placeRejected', reason: 'overlap' }));
        return;
      }

      items.push(candidate);
      player.buildPlaced = true;
      socket.send(JSON.stringify({ type: 'placeAccepted' }));
      broadcastState();
      if (allJoinedPlayers((entry) => entry.buildPlaced)) {
        startCountdownToBattle(Date.now());
      }
      return;
    }

    if (data.type === 'respawn') {
      respawnPlayer(player);
      broadcastState();
    }
  });

  socket.on('close', () => {
    const session = sockets.get(socket);
    if (session) {
      players.delete(session.id);
    }
    sockets.delete(socket);
    if (players.size === 0) {
      resetToLobby();
    } else if (phase === 'lobby' && allJoinedPlayers((entry) => entry.lobbyReady)) {
      startBuild(Date.now());
    } else if (phase === 'build' && allJoinedPlayers((entry) => entry.buildPlaced)) {
      startCountdownToBattle(Date.now());
    }
    broadcastState();
  });
});

setInterval(() => {
  const now = Date.now();

  if (phase === 'countdown_to_battle' && now >= phaseEndsAt) {
    startBattle(now);
  } else if (phase === 'battle') {
    for (const item of items) {
      if (item.kind === 'turret') {
        while (now - item.lastShotAt >= 2000) {
          item.lastShotAt += 2000;
          projectiles.push(makeProjectile(item, now));
        }
      }
    }

    for (const player of players.values()) {
      handlePlayerMotion(player, now);
    }
    stepProjectiles(now);

    if (now >= phaseEndsAt) {
      startResults(now, getRoundWinnerMessage());
    }
  } else if (phase === 'results' && now >= phaseEndsAt) {
    resetToLobby();
  }

  if (now - lastBroadcastAt >= 33) {
    broadcastState(now);
  }
}, 1000 / 60);

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function boot() {
  for (let port = START_PORT; port < START_PORT + 20; port += 1) {
    try {
      const actualPort = await listen(port);
      console.log(`Demo running at http://localhost:${actualPort}`);
      return;
    } catch (error) {
      if (error?.code === 'EADDRINUSE') {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`No free port found starting from ${START_PORT}`);
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
