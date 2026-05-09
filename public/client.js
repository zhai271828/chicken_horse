// ── DOM refs ──────────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const phaseEl = document.getElementById('phase');
const timerEl = document.getElementById('timer');
const scoreboardEl = document.getElementById('scoreboard');
const nameInput = document.getElementById('name');
const joinButton = document.getElementById('join');
const readyButton = document.getElementById('ready');
const sidebarToggle = document.getElementById('sidebar-toggle');
const animalList = document.getElementById('animal-list');
const toolList = document.getElementById('tool-list');
const lobbyPanel = document.getElementById('lobby-panel');
const gamePanel = document.getElementById('game-panel');
const uiRoot = document.getElementById('ui');
const localInfoEl = document.getElementById('local-info');
const resultEl = document.getElementById('result');
const hintEl = document.getElementById('hint');

// ── State ────────────────────────────────────────────────────────────
let ws = null;
let clientId = null;
let state = null;
let selectedAnimalId = null;
let selectedToolId = 'spring';
let selectedDirectionIndex = 1;
let mouse = { x: 0, y: 0, inside: false };

// 输入状态：分离 edge-triggered 和 level-triggered
let input = {
  left: false,
  right: false,
  jump: false,      // edge-triggered: 只在按下瞬间为 true
  jumpHeld: false,   // level-triggered: 按住期间为 true
};
let jumpConsumed = false; // 防止同一帧重复发送 jump

let sidebarCollapsed = false;

// ── Animation state ──────────────────────────────────────────────────
let animTime = 0;
let lastFrameTime = 0;
const particles = [];
const floatingTexts = [];

// ── Direction labels ─────────────────────────────────────────────────
const DIR_LABELS = ['上', '右', '下', '左'];
const DIR_ARROWS = ['↑', '→', '↓', '←'];

// ── Particle system ──────────────────────────────────────────────────
function spawnParticles(x, y, count, color, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = opts.angle ?? (Math.random() * Math.PI * 2);
    const speed = opts.speed ?? (1 + Math.random() * 3);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed + (opts.vx ?? 0),
      vy: Math.sin(angle) * speed + (opts.vy ?? -2),
      life: opts.life ?? (0.4 + Math.random() * 0.6),
      maxLife: opts.life ?? (0.4 + Math.random() * 0.6),
      size: opts.size ?? (2 + Math.random() * 4),
      color,
      gravity: opts.gravity ?? 0.15,
      shape: opts.shape ?? 'circle',
    });
  }
}

function spawnFloatingText(x, y, text, color = '#fff') {
  floatingTexts.push({ x, y, text, color, life: 1.2, maxLife: 1.2 });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
  }
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y -= 40 * dt;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }
}

function drawParticles(cameraX) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    const x = p.x - cameraX;
    const y = p.y;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.shape === 'star') {
      drawStar(x, y, p.size, 5);
    } else if (p.shape === 'square') {
      ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  for (const ft of floatingTexts) {
    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 18px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x - cameraX, ft.y);
  }
  ctx.globalAlpha = 1;
}

function drawStar(cx, cy, r, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.45;
    const method = i === 0 ? 'moveTo' : 'lineTo';
    ctx[method](cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

// ── Helpers ──────────────────────────────────────────────────────────
nameInput.value = localStorage.getItem('demo-name') || `玩家${Math.floor(Math.random() * 90 + 10)}`;

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function localPlayer() {
  return state?.players?.find((player) => player.id === clientId) || null;
}

function canUseBuildTools() {
  return state?.phase === 'build' && localPlayer() && !localPlayer().buildPlaced;
}

function setSidebarCollapsed(next) {
  sidebarCollapsed = next;
  uiRoot.classList.toggle('collapsed', sidebarCollapsed);
  sidebarToggle.classList.toggle('hidden', !sidebarCollapsed);
  sidebarToggle.textContent = sidebarCollapsed ? '显示工具栏' : '隐藏工具栏';
}

function syncSelections() {
  const player = localPlayer();
  if (player) {
    selectedToolId = player.toolId || selectedToolId;
    selectedDirectionIndex = player.directionIndex ?? selectedDirectionIndex;
    if (!selectedAnimalId) selectedAnimalId = player.animalId;
    return;
  }
  if (!selectedAnimalId && state?.animals?.length) {
    const taken = new Set((state.players || []).map((entry) => entry.animalId));
    const firstFree = state.animals.find((animal) => !taken.has(animal.id));
    selectedAnimalId = firstFree?.id || state.animals[0].id;
  }
}

// ── WebSocket ────────────────────────────────────────────────────────
function connect() {
  if (ws) ws.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  statusEl.textContent = '连接中...';

  ws.addEventListener('open', () => {
    statusEl.textContent = '已连接';
    joinButton.disabled = false;
    readyButton.disabled = true;
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'welcome') { clientId = message.id; return; }
    if (message.type === 'state') {
      detectStateChanges(message);
      state = message;
      if (state.phase !== 'build' && state.phase !== 'battle') setSidebarCollapsed(false);
      syncSelections();
      renderUI();
      updateHUD();
      return;
    }
    if (message.type === 'joinAccepted') { statusEl.textContent = '已加入房间'; return; }
    if (message.type === 'joinRejected') {
      const reasons = { lobby_only: '只能在大厅加入', already_joined: '已经加入过了', invalid_animal: '无效角色', animal_taken: '角色已被选择' };
      statusEl.textContent = `加入失败: ${reasons[message.reason] || message.reason}`;
      return;
    }
    if (message.type === 'selectRejected') { statusEl.textContent = `角色不可用: 已被选择`; return; }
    if (message.type === 'placeRejected') { statusEl.textContent = '无法放置在此处'; return; }
    if (message.type === 'placeAccepted') { statusEl.textContent = '已放置'; }
  });

  ws.addEventListener('close', () => { statusEl.textContent = '已断开连接'; });
}

function detectStateChanges(newState) {
  if (!state) return;
  for (const newP of newState.players || []) {
    const oldP = state.players?.find(p => p.id === newP.id);
    if (oldP && oldP.respawnUntil === 0 && newP.respawnUntil > 0) {
      spawnParticles(newP.x + newP.w / 2, newP.y + newP.h / 2, 20, newP.animalColor || '#fff', { shape: 'star', speed: 3, life: 0.8 });
      spawnFloatingText(newP.x + newP.w / 2, newP.y - 10, '💀 击杀!', '#ff4444');
    }
    if (oldP && !oldP.finished && newP.finished) {
      spawnParticles(newP.x + newP.w / 2, newP.y + newP.h / 2, 15, '#ffd43b', { shape: 'star', speed: 2.5, life: 1 });
      spawnFloatingText(newP.x + newP.w / 2, newP.y - 20, '+1 ⭐', '#ffd43b');
    }
  }
  const oldProjIds = new Set((state.projectiles || []).map(p => p.id));
  for (const proj of newState.projectiles || []) {
    if (!oldProjIds.has(proj.id)) {
      spawnParticles(proj.x, proj.y, 5, proj.type === 'arrow' ? '#f4b183' : '#ffd166', { speed: 1.5, life: 0.3 });
    }
  }
}

// ── UI ───────────────────────────────────────────────────────────────
function isAnimalTaken(animalId) {
  return Boolean(state?.players?.some((player) => player.id !== clientId && player.animalId === animalId));
}

function renderUI() {
  if (!state) return;
  const player = localPlayer();
  const inLobby = state.phase === 'lobby';
  const inBuild = state.phase === 'build';
  const inBattle = state.phase === 'battle' || state.phase === 'results';

  // 大厅阶段始终显示 lobby panel，不参与 collapsed 逻辑
  uiRoot.classList.toggle('collapsed', sidebarCollapsed && (inBuild || inBattle));
  sidebarToggle.classList.toggle('hidden', !(sidebarCollapsed && (inBuild || inBattle)));
  sidebarToggle.textContent = sidebarCollapsed ? '显示工具栏' : '隐藏工具栏';

  // 大厅面板：大厅阶段始终显示
  if (inLobby) {
    lobbyPanel.classList.remove('hidden');
  } else {
    lobbyPanel.classList.add('hidden');
  }

  // 游戏面板：建造阶段显示（除非被折叠）
  if (inBuild && !sidebarCollapsed) {
    gamePanel.classList.remove('hidden');
  } else {
    gamePanel.classList.add('hidden');
  }

  // ── 角色选择 ──
  animalList.innerHTML = '';
  if (state.animals && state.animals.length > 0) {
    state.animals.forEach((animal) => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.style.setProperty('--swatch', animal.color);

      const taken = isAnimalTaken(animal.id);
      const owned = player?.animalId === animal.id;
      const selected = selectedAnimalId === animal.id;

      // 状态文本
      let statusText = '点击选择';
      if (owned) statusText = '✅ 已选择';
      else if (taken) statusText = '🔒 已被占用';

      btn.innerHTML = `${animal.emoji || ''} ${animal.name}<br><small>${statusText}</small>`;

      if (taken && !owned) btn.classList.add('locked');
      if (selected || owned) btn.classList.add('active');

      // 只有被其他玩家占用的才禁用
      btn.disabled = taken && !owned;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (taken && !owned) return;
        selectedAnimalId = animal.id;
        // 如果已加入房间且未准备，发送切换请求
        if (player && inLobby && !player.lobbyReady) {
          send({ type: 'selectAnimal', animalId: animal.id });
        }
        renderUI();
      });

      animalList.appendChild(btn);
    });
  }

  // 加入按钮：大厅阶段、未加入、已选角色时可用
  joinButton.disabled = !inLobby || Boolean(player) || !selectedAnimalId;
  // 准备按钮：大厅阶段、已加入、未准备时可用
  readyButton.disabled = !inLobby || !player || player.lobbyReady;
  readyButton.textContent = player?.lobbyReady ? '✅ 已准备!' : '✅ 准备';

  // ── 工具选择 ──
  toolList.innerHTML = '';
  if (state.tools && state.tools.length > 0) {
    state.tools.forEach((tool) => {
      const btn = document.createElement('button');
      btn.className = 'choice tool-choice';

      const dirArrow = DIR_ARROWS[selectedDirectionIndex] || '→';
      const dirLabel = DIR_LABELS[selectedDirectionIndex] || '右';

      if (tool.kind === 'turret') {
        btn.innerHTML = `${tool.name}<br><small>方向: ${dirArrow} ${dirLabel} | 空格切换</small>`;
      } else {
        btn.innerHTML = `${tool.name}<br><small>数字键或点击选择</small>`;
      }

      // 建造阶段且未放置时可选择
      const canSelect = inBuild && player && !player.buildPlaced;
      btn.disabled = !canSelect;
      if (selectedToolId === tool.id) btn.classList.add('active');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!canSelect) return;
        selectedToolId = tool.id;
        send({ type: 'config', toolId: selectedToolId, directionIndex: selectedDirectionIndex });
        setSidebarCollapsed(true);
        renderUI();
      });

      toolList.appendChild(btn);
    });
  }

  // 本地信息
  const dirInfo = state.tools?.find(t => t.id === selectedToolId)?.kind === 'turret'
    ? ` | 方向: ${DIR_ARROWS[selectedDirectionIndex]}${DIR_LABELS[selectedDirectionIndex]}`
    : '';
  localInfoEl.textContent = player
    ? `角色: ${player.animalName} | 已放置: ${player.buildPlaced ? '是' : '否'} | 工具: ${player.toolId}${dirInfo}`
    : '请先加入房间';

  // 计分板
  scoreboardEl.textContent = (state.players || [])
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((entry) => `${entry.id === clientId ? '★ ' : ''}${entry.name} (${entry.animalName}) - ${entry.score}分${entry.lobbyReady ? ' [已准备]' : ''}${entry.buildPlaced ? ' [已放置]' : ''}`)
    .join('\n');

  resultEl.textContent = state.resultMessage || '';
}

function updateHUD() {
  if (!state) return;
  const phaseNames = {
    lobby: '大厅',
    build: '建造阶段',
    countdown_to_battle: '倒计时',
    battle: '竞速阶段',
    results: '结算',
  };
  phaseEl.textContent = `阶段: ${phaseNames[state.phase] || state.phase}`;
  if (state.phase === 'countdown_to_battle') {
    timerEl.textContent = `开始倒计时: ${Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))}`;
    hintEl.textContent = '等待倒计时结束...';
  } else if (state.phase === 'build') {
    timerEl.textContent = '建造中';
    hintEl.textContent = '移动鼠标预览位置，点击或按E放置，空格键旋转方向';
  } else if (state.phase === 'battle') {
    timerEl.textContent = `竞速: ${Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))}秒`;
    hintEl.textContent = '← → 移动 | 空格跳跃（按住跳更高）';
  } else if (state.phase === 'results') {
    timerEl.textContent = '结算中';
    hintEl.textContent = '即将返回大厅...';
  } else {
    timerEl.textContent = '大厅';
    hintEl.textContent = '选择角色，输入名字，点击加入房间';
  }
}

// ── Canvas ───────────────────────────────────────────────────────────
function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldCameraX() {
  const player = localPlayer();
  if (!state || !player) return 0;
  return Math.max(0, Math.min(state.world.width - window.innerWidth, player.x - window.innerWidth * 0.45));
}

function mouseWorldPos() {
  const cam = worldCameraX();
  return { x: mouse.x + cam, y: mouse.y };
}

function itemSize(toolId) {
  switch (toolId) {
    case 'spring': return { w: 48, h: 20 };
    case 'spike': return { w: 48, h: 28 };
    case 'arrow': case 'cannon': return { w: 48, h: 48 };
    default: return { w: 48, h: 20 };
  }
}

function previewBox() {
  if (!state || !canUseBuildTools()) return null;
  const { w, h } = itemSize(selectedToolId);
  const world = mouseWorldPos();
  return {
    toolId: selectedToolId,
    directionIndex: selectedDirectionIndex,
    x: Math.max(0, Math.min(state.world.width - w, world.x - w / 2)),
    y: Math.max(0, Math.min(state.world.height - h, world.y - h / 2)),
    w, h,
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function previewValid(box) {
  if (!state || !box) return false;
  if (box.x < 0 || box.y < 0 || box.x + box.w > state.world.width || box.y + box.h > state.world.height) return false;
  if (overlaps(box, state.goal)) return false;
  return !state.items.some((item) => overlaps(box, item));
}

// ── Drawing helpers ──────────────────────────────────────────────────
function drawRoundedRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawRoundedRectStroke(x, y, w, h, r, stroke, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

// ── Background rendering ─────────────────────────────────────────────
function drawBackground(w, h, cameraX) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1a2a4a');
  sky.addColorStop(0.3, '#2d5a8e');
  sky.addColorStop(0.6, '#5b9fd4');
  sky.addColorStop(1, '#87ceeb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i < 30; i++) {
    const sx = ((i * 137 + 50) % (w + 100)) - 50;
    const sy = ((i * 89 + 20) % (h * 0.4));
    const twinkle = Math.sin(animTime * 2 + i) * 0.3 + 0.7;
    ctx.globalAlpha = twinkle * 0.4;
    ctx.beginPath();
    ctx.arc(sx, sy, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawMountains(cameraX * 0.08, h, '#1a3a5c', 0.7, 180);
  drawMountains(cameraX * 0.15, h, '#2a5a7c', 0.5, 140);
  drawClouds(cameraX * 0.25, w, h);
  drawHills(cameraX * 0.4, w, h);
}

function drawMountains(offset, h, color, alpha, baseY) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(-50, h);
  for (let x = -50; x <= window.innerWidth + 50; x += 80) {
    const wx = x + offset;
    const peak = baseY + Math.sin(wx * 0.008) * 60 + Math.sin(wx * 0.015) * 30 + Math.cos(wx * 0.003) * 40;
    ctx.lineTo(x, h - peak);
  }
  ctx.lineTo(window.innerWidth + 50, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawClouds(offset, w, h) {
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (let i = 0; i < 12; i++) {
    const baseX = (i * 220 - offset) % (w + 300) - 150;
    const y = 40 + (i % 4) * 35 + Math.sin(i * 1.5) * 15;
    const cw = 80 + (i % 3) * 40;
    const ch = 20 + (i % 2) * 10;
    ctx.beginPath();
    ctx.ellipse(baseX, y, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(baseX - cw * 0.3, y + 5, cw * 0.6, ch * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(baseX + cw * 0.35, y + 3, cw * 0.5, ch * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHills(offset, w, h) {
  const groundY = state?.world?.groundY ?? 624;
  ctx.fillStyle = '#3a7a4a';
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(-50, groundY);
  for (let x = -50; x <= w + 50; x += 60) {
    const wx = x + offset;
    const hill = Math.sin(wx * 0.01) * 30 + Math.sin(wx * 0.025) * 15;
    ctx.lineTo(x, groundY - hill);
  }
  ctx.lineTo(w + 50, groundY);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Ground & platforms ───────────────────────────────────────────────
function drawGround(cameraX, w, h) {
  if (!state) return;
  const groundY = state.world.groundY;
  const gx = -cameraX;

  const dirtGrad = ctx.createLinearGradient(0, groundY, 0, h);
  dirtGrad.addColorStop(0, '#6b4226');
  dirtGrad.addColorStop(0.3, '#5a3520');
  dirtGrad.addColorStop(1, '#3d2213');
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(gx, groundY, state.world.width, h - groundY);

  const grassGrad = ctx.createLinearGradient(0, groundY - 8, 0, groundY + 12);
  grassGrad.addColorStop(0, '#4caf50');
  grassGrad.addColorStop(0.5, '#388e3c');
  grassGrad.addColorStop(1, '#2e7d32');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(gx, groundY - 4, state.world.width, 16);

  ctx.fillStyle = '#66bb6a';
  for (let x = 0; x < state.world.width; x += 24) {
    const sx = x - cameraX;
    if (sx < -30 || sx > w + 30) continue;
    const sway = Math.sin(animTime * 1.5 + x * 0.1) * 2;
    ctx.beginPath();
    ctx.moveTo(sx, groundY - 2);
    ctx.quadraticCurveTo(sx + 4 + sway, groundY - 12, sx + 8, groundY - 2);
    ctx.fill();
  }
}

function drawPlatform(platform, cameraX) {
  const x = platform.x - cameraX;
  const y = platform.y;
  const w = platform.w;
  const h = platform.h;
  if (x + w < -50 || x > window.innerWidth + 50) return;

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  drawRoundedRect(x + 3, y + 4, w, h, 6, 'rgba(0,0,0,0.2)');

  const woodGrad = ctx.createLinearGradient(x, y, x, y + h);
  woodGrad.addColorStop(0, '#a0724e');
  woodGrad.addColorStop(0.4, '#8b5e3c');
  woodGrad.addColorStop(1, '#6b4226');
  drawRoundedRect(x, y, w, h, 6, woodGrad);

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const ly = y + 4 + i * 6;
    ctx.beginPath();
    ctx.moveTo(x + 4, ly);
    ctx.lineTo(x + w - 4, ly);
    ctx.stroke();
  }

  const grassGrad = ctx.createLinearGradient(x, y - 3, x, y + 6);
  grassGrad.addColorStop(0, '#66bb6a');
  grassGrad.addColorStop(1, '#4caf50');
  drawRoundedRect(x - 2, y - 3, w + 4, 8, 4, grassGrad);

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  drawRoundedRect(x + 2, y + 1, w - 4, 4, 3, 'rgba(255,255,255,0.15)');
}

// ── Item rendering ───────────────────────────────────────────────────
function drawSpring(item, cameraX) {
  const x = item.x - cameraX;
  const y = item.y;
  const bounce = Math.sin(animTime * 6) * 2;

  drawRoundedRect(x + 4, y + 10, item.w - 8, item.h - 10, 4, '#8b6914');
  drawRoundedRect(x + 6, y + 12, item.w - 12, item.h - 14, 3, '#a07a1e');

  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const sy = y + 8 - i * 3 + bounce * (1 - i / 3);
    ctx.beginPath();
    ctx.moveTo(x + 10 + i * 2, sy);
    ctx.quadraticCurveTo(x + item.w / 2, sy - 6, x + item.w - 10 - i * 2, sy);
    ctx.stroke();
  }

  const plateY = y + bounce - 2;
  drawRoundedRect(x + 2, plateY, item.w - 4, 6, 3, '#e0e0e0');
  drawRoundedRect(x + 4, plateY + 1, item.w - 8, 2, 1, '#ffffff');
}

function drawSpike(item, cameraX) {
  const x = item.x - cameraX;
  const y = item.y;

  drawRoundedRect(x + 2, y + 16, item.w - 4, item.h - 16, 4, '#4a1a1a');

  for (let i = 0; i < 5; i++) {
    const sx = x + 4 + i * 9;
    const grad = ctx.createLinearGradient(sx, y + 16, sx, y);
    grad.addColorStop(0, '#cc3333');
    grad.addColorStop(0.5, '#ff4444');
    grad.addColorStop(1, '#ff6666');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sx, y + 16);
    ctx.lineTo(sx + 4.5, y + 2);
    ctx.lineTo(sx + 9, y + 16);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(sx + 2, y + 14);
    ctx.lineTo(sx + 4.5, y + 4);
    ctx.lineTo(sx + 6, y + 14);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTurret(item, cameraX) {
  const x = item.x - cameraX;
  const y = item.y;
  const angle = [ -Math.PI / 2, 0, Math.PI / 2, Math.PI ][item.directionIndex || 1] || 0;

  drawRoundedRect(x + 4, y + item.h - 16, item.w - 8, 16, 6, '#34495e');
  drawRoundedRect(x + 6, y + item.h - 14, item.w - 12, 12, 5, '#4a6a8a');

  ctx.save();
  ctx.translate(x + item.w / 2, y + item.h / 2 - 4);
  ctx.rotate(angle);

  const barrelColor = item.toolId === 'arrow' ? '#d4842a' : '#6c7a8a';
  const barrelGrad = ctx.createLinearGradient(-4, -6, -4, 6);
  barrelGrad.addColorStop(0, barrelColor);
  barrelGrad.addColorStop(1, item.toolId === 'arrow' ? '#a06420' : '#4a5a6a');
  ctx.fillStyle = barrelGrad;
  drawRoundedRect(-16, -5, 32, 10, 3, barrelGrad);

  ctx.fillStyle = item.toolId === 'arrow' ? '#f0a040' : '#8899aa';
  ctx.beginPath();
  ctx.moveTo(14, -7);
  ctx.lineTo(22, 0);
  ctx.lineTo(14, 7);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a6a8a';
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (item.nextShotIn !== undefined && item.nextShotIn < 500) {
    const pulse = Math.sin(animTime * 10) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255,200,50,${pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(x + item.w / 2, y + item.h / 2 - 4, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawItem(item, cameraX) {
  switch (item.toolId) {
    case 'spring': drawSpring(item, cameraX); break;
    case 'spike': drawSpike(item, cameraX); break;
    case 'arrow': case 'cannon': drawTurret(item, cameraX); break;
  }
}

// ── Projectile rendering ─────────────────────────────────────────────
function drawProjectile(proj, cameraX) {
  const x = proj.x - cameraX;
  const y = proj.y;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(proj.angle || 0);

  if (proj.type === 'arrow') {
    const shaftGrad = ctx.createLinearGradient(-9, 0, 9, 0);
    shaftGrad.addColorStop(0, '#6b4226');
    shaftGrad.addColorStop(1, '#8b5e3c');
    ctx.fillStyle = shaftGrad;
    ctx.fillRect(-9, -2, 16, 4);

    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(15, -4);
    ctx.lineTo(15, 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(-13, -4);
    ctx.lineTo(-9, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(-13, 4);
    ctx.lineTo(-9, 1);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#f4b183';
    ctx.beginPath();
    ctx.arc(-14, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    const r = proj.r || 11;
    const ballGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, r);
    ballGrad.addColorStop(0, '#6a7a8a');
    ballGrad.addColorStop(0.7, '#3a4a5a');
    ballGrad.addColorStop(1, '#2a3a4a');
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(-3, -3, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(-r - 2, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.arc(-r - 2, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ── Goal rendering ───────────────────────────────────────────────────
function drawGoal(cameraX) {
  if (!state) return;
  const gx = state.goal.x - cameraX;
  const gy = state.goal.y;
  const gw = state.goal.w;
  const gh = state.goal.h;

  ctx.fillStyle = '#8b8b8b';
  ctx.fillRect(gx + gw / 2 - 3, gy - 70, 6, gh + 70);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(gx + gw / 2 - 1, gy - 70, 2, gh + 70);

  const wave = Math.sin(animTime * 3) * 5;
  const flagGrad = ctx.createLinearGradient(gx + gw / 2, gy - 70, gx + gw / 2 + 50, gy - 30);
  flagGrad.addColorStop(0, '#ffd43b');
  flagGrad.addColorStop(1, '#ffaa00');
  ctx.fillStyle = flagGrad;
  ctx.beginPath();
  ctx.moveTo(gx + gw / 2 + 3, gy - 70);
  ctx.quadraticCurveTo(gx + gw / 2 + 25 + wave, gy - 60, gx + gw / 2 + 48, gy - 52);
  ctx.lineTo(gx + gw / 2 + 40 + wave * 0.5, gy - 35);
  ctx.quadraticCurveTo(gx + gw / 2 + 20 + wave, gy - 40, gx + gw / 2 + 3, gy - 32);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  drawStar(gx + gw / 2 + 22 + wave * 0.3, gy - 52, 8, 5);

  const glowAlpha = Math.sin(animTime * 2) * 0.1 + 0.15;
  drawRoundedRect(gx - 5, gy - 5, gw + 10, gh + 10, 8, `rgba(255,212,59,${glowAlpha})`);

  ctx.strokeStyle = 'rgba(255,212,59,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  drawRoundedRectStroke(gx - 2, gy - 2, gw + 4, gh + 4, 6, 'rgba(255,212,59,0.5)', 2);
  ctx.setLineDash([]);

  ctx.fillStyle = '#ffd43b';
  ctx.font = 'bold 12px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('终点', gx + gw / 2, gy - 78);
}

// ── Player rendering ─────────────────────────────────────────────────
function drawAnimalBody(player, x, y) {
  const w = player.w;
  const h = player.h;
  const color = player.animalColor || '#ffffff';
  const facing = player.facing || 1;

  const walkCycle = Math.abs(player.vx || 0) > 0.5 ? Math.sin(animTime * 10) : 0;
  const jumpStretch = (player.vy || 0) < -2 ? 1.1 : (player.vy || 0) > 2 ? 0.9 : 1;

  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);
  ctx.translate(-w / 2, -h);

  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h + 2, w * 0.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (player.animalId === 'rabbit') {
    drawRabbit(color, w, h, walkCycle, jumpStretch);
  } else if (player.animalId === 'fox') {
    drawFox(color, w, h, walkCycle, jumpStretch);
  } else if (player.animalId === 'pig') {
    drawPig(color, w, h, walkCycle, jumpStretch);
  } else {
    drawChick(color, w, h, walkCycle, jumpStretch);
  }

  ctx.restore();
}

function drawRabbit(color, w, h, walk, stretch) {
  const earSway = walk * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(8 + earSway, 2, 5, 14, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22 - earSway, 2, 5, 14, 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffcce0';
  ctx.beginPath();
  ctx.ellipse(8 + earSway, 2, 3, 10, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22 - earSway, 2, 3, 10, 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  drawRoundedRect(2, 14 * stretch, 26, 28 * stretch, 12, color);

  ctx.fillStyle = '#fff0f8';
  drawRoundedRect(6, 20 * stretch, 18, 16 * stretch, 8, '#fff0f8');

  const footY = h - 4 + walk * 2;
  ctx.fillStyle = color;
  drawRoundedRect(2, footY, 10, 5, 3, color);
  drawRoundedRect(18, footY, 10, 5, 3, color);

  drawEyes(9, 20, 13, 20, 3.5);

  ctx.fillStyle = '#ff88aa';
  ctx.beginPath();
  ctx.arc(15, 26, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, 25); ctx.lineTo(0, 23);
  ctx.moveTo(10, 27); ctx.lineTo(0, 28);
  ctx.moveTo(20, 25); ctx.lineTo(30, 23);
  ctx.moveTo(20, 27); ctx.lineTo(30, 28);
  ctx.stroke();
}

function drawFox(color, w, h, walk, stretch) {
  const tailWag = Math.sin(animTime * 4) * 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-2, 28 * stretch);
  ctx.quadraticCurveTo(-12 + tailWag, 20 * stretch, -8 + tailWag, 10 * stretch);
  ctx.quadraticCurveTo(-4 + tailWag, 16 * stretch, 2, 24 * stretch);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-6 + tailWag, 12 * stretch, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(4, 14); ctx.lineTo(8, 0); ctx.lineTo(14, 12); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, 12); ctx.lineTo(22, 0); ctx.lineTo(26, 14); ctx.closePath();
  ctx.fill();

  drawRoundedRect(2, 14 * stretch, 26, 26 * stretch, 12, color);

  ctx.fillStyle = '#ffe8d0';
  drawRoundedRect(6, 22 * stretch, 18, 14 * stretch, 7, '#ffe8d0');

  ctx.fillStyle = '#ffe0c0';
  ctx.beginPath();
  ctx.ellipse(15, 28 * stretch, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const footY = h - 4 + walk * 2;
  ctx.fillStyle = '#2a2a2a';
  drawRoundedRect(4, footY, 8, 5, 3, '#2a2a2a');
  drawRoundedRect(18, footY, 8, 5, 3, '#2a2a2a');

  drawEyes(9, 20, 20, 20, 3);

  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.arc(15, 27, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawPig(color, w, h, walk, stretch) {
  ctx.fillStyle = '#ff8aaa';
  ctx.beginPath();
  ctx.ellipse(6, 12, 6, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(24, 12, 6, 5, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  drawRoundedRect(1, 14 * stretch, 28, 26 * stretch, 13, color);

  ctx.fillStyle = '#ffe0ec';
  drawRoundedRect(5, 22 * stretch, 20, 14 * stretch, 8, '#ffe0ec');

  ctx.fillStyle = '#ff9eb8';
  ctx.beginPath();
  ctx.ellipse(15, 28 * stretch, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e07090';
  ctx.beginPath();
  ctx.ellipse(12, 28 * stretch, 2, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(18, 28 * stretch, 2, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const footY = h - 4 + walk * 2;
  ctx.fillStyle = color;
  drawRoundedRect(3, footY, 9, 5, 3, color);
  drawRoundedRect(18, footY, 9, 5, 3, color);

  drawEyes(9, 20, 20, 20, 3.5);

  ctx.fillStyle = 'rgba(255,150,180,0.3)';
  ctx.beginPath();
  ctx.arc(5, 26, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(25, 26, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawChick(color, w, h, walk, stretch) {
  const wingFlap = walk * 3;
  ctx.fillStyle = '#ffd060';
  ctx.save();
  ctx.translate(2, 22 * stretch);
  ctx.rotate((-20 + wingFlap) * Math.PI / 180);
  drawRoundedRect(-2, 0, 10, 14, 5, '#ffd060');
  ctx.restore();
  ctx.save();
  ctx.translate(28, 22 * stretch);
  ctx.rotate((20 - wingFlap) * Math.PI / 180);
  drawRoundedRect(-8, 0, 10, 14, 5, '#ffd060');
  ctx.restore();

  ctx.fillStyle = color;
  drawRoundedRect(2, 14 * stretch, 26, 28 * stretch, 13, color);

  ctx.fillStyle = '#fff8e0';
  drawRoundedRect(6, 22 * stretch, 18, 14 * stretch, 8, '#fff8e0');

  const footY = h - 4 + walk * 2;
  ctx.fillStyle = '#ff8800';
  drawRoundedRect(4, footY, 8, 5, 3, '#ff8800');
  drawRoundedRect(18, footY, 8, 5, 3, '#ff8800');

  drawEyes(9, 20, 20, 20, 3.5);

  ctx.fillStyle = '#ff8800';
  ctx.beginPath();
  ctx.moveTo(12, 26);
  ctx.lineTo(15, 30);
  ctx.lineTo(18, 26);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ff4444';
  ctx.beginPath();
  ctx.arc(12, 13, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16, 11, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(20, 13, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawEyes(lx, ly, rx, ry, size) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lx, ly, size + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rx, ry, size + 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(lx + 1, ly, size - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rx + 1, ry, size - 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lx + 1.5, ly - 1.5, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rx + 1.5, ry - 1.5, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(player, cameraX) {
  const x = player.x - cameraX;
  const y = player.y;
  if (x + player.w < -50 || x > window.innerWidth + 50) return;

  if (player.respawnUntil && player.respawnUntil > Date.now()) {
    const flash = Math.sin(animTime * 15) > 0;
    if (!flash) return;
    ctx.globalAlpha = 0.5;
  }

  if (player.finished) {
    ctx.shadowColor = '#ffd43b';
    ctx.shadowBlur = 15;
  }

  drawAnimalBody(player, x, y);

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  if (player.id === clientId) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    drawRoundedRectStroke(x - 4, y - 4, player.w + 8, player.h + 8, 8, 'rgba(255,255,255,0.6)', 2);
    ctx.setLineDash([]);
  }

  const nameTagY = y - 14;
  ctx.font = 'bold 11px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  const nameWidth = ctx.measureText(player.name).width + 12;
  const nameX = x + player.w / 2;

  drawRoundedRect(nameX - nameWidth / 2, nameTagY - 8, nameWidth, 16, 8, 'rgba(0,0,0,0.5)');
  drawRoundedRectStroke(nameX - nameWidth / 2, nameTagY - 8, nameWidth, 16, 8, 'rgba(255,255,255,0.2)', 1);

  ctx.fillStyle = player.id === clientId ? '#ffd43b' : '#ffffff';
  ctx.fillText(player.name, nameX, nameTagY + 4);

  if (player.score > 0) {
    const badgeX = x + player.w + 4;
    const badgeY = y - 4;
    drawRoundedRect(badgeX, badgeY, 20, 16, 8, 'rgba(255,212,59,0.9)');
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 10px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(player.score), badgeX + 10, badgeY + 12);
  }
}

// ── Preview rendering ────────────────────────────────────────────────
function drawCardinalPreview(box, cameraX, valid) {
  const x = box.x - cameraX;
  const y = box.y;
  const tint = valid ? 'rgba(88, 217, 152, 0.35)' : 'rgba(255, 80, 80, 0.35)';
  const edge = valid ? '#58d998' : '#ff5050';

  const pulse = Math.sin(animTime * 4) * 0.1 + 0.9;
  ctx.globalAlpha = pulse;

  if (box.toolId === 'spring') {
    drawRoundedRect(x, y + 8, box.w, box.h - 8, 10, tint);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(x + 8, y + 2, 32, 6);
  } else if (box.toolId === 'spike') {
    drawRoundedRect(x, y + 16, box.w, box.h - 16, 8, tint);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = valid ? 'rgba(88,217,152,0.5)' : 'rgba(255,80,80,0.5)';
      ctx.beginPath();
      ctx.moveTo(x + 2 + i * 10, y + 16);
      ctx.lineTo(x + 7 + i * 10, y + 2);
      ctx.lineTo(x + 12 + i * 10, y + 16);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    drawRoundedRect(x, y + 12, box.w, box.h - 12, 10, tint);
    ctx.save();
    ctx.translate(x + box.w / 2, y + box.h / 2);
    const angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][box.directionIndex] || 0;
    ctx.rotate(angle);
    ctx.fillStyle = box.toolId === 'arrow' ? '#f2a65a' : '#adb5bd';
    ctx.fillRect(-14, -4, 28, 8);
    ctx.beginPath();
    ctx.moveTo(12, -8);
    ctx.lineTo(22, 0);
    ctx.lineTo(12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const dirArrow = DIR_ARROWS[box.directionIndex] || '→';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dirArrow, x + box.w / 2, y - 6);
  }

  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  drawRoundedRectStroke(x, y, box.w, box.h, 6, edge, 2);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ── HUD rendering ────────────────────────────────────────────────────
function drawHUD(w, h) {
  if (!state) return;

  const barH = 52;
  const barY = h - barH - 10;
  const barW = Math.min(480, w - 36);

  drawRoundedRect(18, barY, barW, barH, 12, 'rgba(0,0,0,0.45)');
  drawRoundedRectStroke(18, barY, barW, barH, 12, 'rgba(255,255,255,0.1)', 1);

  const topText = state.phase === 'build'
    ? '🖱️ 鼠标预览 | 点击/E放置 | 空格旋转方向'
    : state.phase === 'countdown_to_battle'
      ? `🏁 竞速开始倒计时: ${Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))}秒`
      : state.phase === 'battle'
        ? `⏱️ 竞速剩余: ${Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))}秒`
        : state.phase === 'results'
          ? '🏆 回合结束'
          : '🎮 选择角色，输入名字，点击加入房间';

  ctx.fillStyle = '#fff';
  ctx.font = '13px Trebuchet MS, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(topText, 28, barY + 22);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px Trebuchet MS, sans-serif';
  const phaseNames = { lobby: '大厅', build: '建造', countdown_to_battle: '倒计时', battle: '竞速', results: '结算' };
  ctx.fillText(`阶段: ${phaseNames[state.phase] || state.phase} | 第 ${state.roundNumber} 回合`, 28, barY + 40);

  if (state.phase === 'countdown_to_battle') {
    const secs = Math.max(1, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
    const scale = 1 + Math.sin(animTime * 8) * 0.05;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);

    ctx.shadowColor = '#ffd43b';
    ctx.shadowBlur = 30;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(secs), 0, 0);

    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '16px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('准备竞速!', w / 2, h / 2 + 50);
  }

  if (state.phase === 'results' && state.resultMessage) {
    const alpha = Math.min(1, (Date.now() - (state.phaseEndsAt - 5000)) / 500);
    ctx.globalAlpha = alpha;

    drawRoundedRect(w / 2 - 200, h / 2 - 60, 400, 120, 16, 'rgba(0,0,0,0.7)');
    drawRoundedRectStroke(w / 2 - 200, h / 2 - 60, 400, 120, 16, 'rgba(255,212,59,0.5)', 2);

    ctx.fillStyle = '#ffd43b';
    ctx.font = 'bold 28px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.resultMessage, w / 2, h / 2 - 10);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px Trebuchet MS, sans-serif';
    ctx.fillText('即将返回大厅...', w / 2, h / 2 + 30);

    ctx.globalAlpha = 1;
  }
}

// ── Main draw ────────────────────────────────────────────────────────
function drawWorld() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cameraX = worldCameraX();

  ctx.clearRect(0, 0, w, h);

  drawBackground(w, h, cameraX);

  if (!state) return;

  drawGround(cameraX, w, h);

  state.platforms.forEach((platform) => drawPlatform(platform, cameraX));

  drawGoal(cameraX);

  state.items.forEach((item) => drawItem(item, cameraX));

  state.projectiles.forEach((proj) => drawProjectile(proj, cameraX));

  const sortedPlayers = [...state.players].sort((a, b) => {
    if (a.id === clientId) return 1;
    if (b.id === clientId) return -1;
    return 0;
  });
  sortedPlayers.forEach((player) => drawPlayer(player, cameraX));

  drawParticles(cameraX);

  const preview = previewBox();
  if (preview) drawCardinalPreview(preview, cameraX, previewValid(preview));

  drawHUD(w, h);
}

// ── Input ────────────────────────────────────────────────────────────
window.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = event.clientX - rect.left;
  mouse.y = event.clientY - rect.top;
  mouse.inside = true;
});

window.addEventListener('pointerleave', () => { mouse.inside = false; });

canvas.addEventListener('click', () => {
  if (!canUseBuildTools()) return;
  const box = previewBox();
  if (!box || !previewValid(box)) return;
  send({ type: 'place', x: box.x, y: box.y, toolId: box.toolId, directionIndex: box.directionIndex });
});

window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyW', 'Space', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(event.code)) {
    event.preventDefault();
  }

  const player = localPlayer();

  // 建造阶段快捷键
  if (state?.phase === 'build' && player && !player.buildPlaced) {
    if (event.code === 'Digit1') selectedToolId = 'spring';
    if (event.code === 'Digit2') selectedToolId = 'spike';
    if (event.code === 'Digit3') selectedToolId = 'arrow';
    if (event.code === 'Digit4') selectedToolId = 'cannon';
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(event.code)) {
      send({ type: 'config', toolId: selectedToolId, directionIndex: selectedDirectionIndex });
      renderUI();
    }
    if (event.code === 'Space') {
      selectedDirectionIndex = (selectedDirectionIndex + 1) % 4;
      send({ type: 'config', toolId: selectedToolId, directionIndex: selectedDirectionIndex });
      renderUI();
    }
    if (event.code === 'KeyE') {
      const box = previewBox();
      if (box && previewValid(box)) {
        send({ type: 'place', x: box.x, y: box.y, toolId: box.toolId, directionIndex: box.directionIndex });
      }
    }
    return;
  }

  // 竞速阶段输入
  if (state?.phase === 'battle' && player) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') input.left = true;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') input.right = true;
    if (event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'Space') {
      // edge-triggered: 只在第一次按下时触发跳跃
      if (!input.jumpHeld) {
        input.jump = true;
      }
      input.jumpHeld = true;
    }
  }

  if (event.code === 'KeyR') send({ type: 'respawn' });
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') input.left = false;
  if (event.code === 'ArrowRight' || event.code === 'KeyD') input.right = false;
  if (event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'Space') {
    input.jump = false;
    input.jumpHeld = false;
  }
});

joinButton.addEventListener('click', () => {
  if (!selectedAnimalId) { statusEl.textContent = '请先选择一个角色'; return; }
  localStorage.setItem('demo-name', nameInput.value);
  send({ type: 'join', name: nameInput.value, animalId: selectedAnimalId });
});

readyButton.addEventListener('click', () => { send({ type: 'ready' }); });
sidebarToggle.addEventListener('click', () => { setSidebarCollapsed(false); renderUI(); });

window.addEventListener('resize', resize);
resize();
connect();

// ── Game loop ────────────────────────────────────────────────────────
// 60fps 输入发送
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN && state?.phase === 'battle' && localPlayer()) {
    send({
      type: 'input',
      left: input.left,
      right: input.right,
      jump: input.jump,
      jumpHeld: input.jumpHeld,
    });
    // jump 是 edge-triggered，发送后重置
    input.jump = false;
  }
}, 1000 / 60);

function frame(timestamp) {
  const dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;
  animTime += dt;

  updateParticles(dt);
  drawWorld();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
