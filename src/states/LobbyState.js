/**
 * LobbyState - Room creation and joining UI
 *
 * Allows players to create new rooms or join existing ones.
 */

import { State } from './State.js';
import { GameConfig } from '../config/GameConfig.js';
import { GameStage } from '../config/GameStage.js';

export class LobbyState extends State {
  constructor(ctx, goTo, networkManager) {
    super(ctx, goTo);
    this.networkManager = networkManager;

    // UI state
    this.mode = 'menu'; // 'menu', 'create', 'join', 'waiting'
    this.playerName = '';
    this.roomIdInput = '';
    this.selectedCharacter = 'chicken';
    this.error = '';
    this.loading = false;

    // Room data
    this.roomId = null;
    this.players = [];
    this.isHost = false;
    this.hostId = null;
    this.selectedMapKey = 'map1';
    this.selectedBgIndex = 0;

    // Characters
    this.characters = [
      { id: 'chicken', name: '小鸡', color: [255, 200, 0] },
      { id: 'bunny', name: '兔兔', color: [255, 180, 200] },
      { id: 'duck', name: '鸭鸭', color: [255, 165, 0] },
      { id: 'polar', name: '北极熊', color: [200, 220, 255] },
    ];

    // Input handling
    this.inputActive = false;
    this.cursorVisible = true;
    this.cursorTimer = 0;
    this.previewAnimTick = 0;
  }

  enter() {
    this.mode = 'menu';
    this.playerName = '';
    this.roomIdInput = '';
    this.error = '';
    this.loading = false;
    this.roomId = null;
    this.players = [];
    this.isHost = false;
    this.hostId = null;

    // Create hidden HTML inputs for Chinese input support
    this.createHTMLInputs();

    // Register network handlers (save bound references for proper cleanup)
    this._onRoomCreated = this.onRoomCreated.bind(this);
    this._onRoomJoined = this.onRoomJoined.bind(this);
    this._onPlayerJoined = this.onPlayerJoined.bind(this);
    this._onPlayerLeft = this.onPlayerLeft.bind(this);
    this._onError = this.onError.bind(this);
    this._onGameStarted = this.onGameStarted.bind(this);
    this._onMapSelected = this.onMapSelected.bind(this);

    this.networkManager.on('ROOM_CREATED', this._onRoomCreated);
    this.networkManager.on('ROOM_JOINED', this._onRoomJoined);
    this.networkManager.on('PLAYER_JOINED', this._onPlayerJoined);
    this.networkManager.on('PLAYER_LEFT', this._onPlayerLeft);
    this.networkManager.on('ERROR', this._onError);
    this.networkManager.on('GAME_STARTED', this._onGameStarted);
    this.networkManager.on('MAP_SELECTED', this._onMapSelected);
  }

  createHTMLInputs() {
    // Remove existing inputs
    this.removeHTMLInputs();

    // Create name input
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = '输入昵称（支持中文）';
    this.nameInput.maxLength = 20;
    this.nameInput.autocomplete = 'off';
    this.nameInput.lang = 'zh-CN';
    this.nameInput.style.cssText = 'position:fixed; left:8px; top:8px; width:1px; height:1px; opacity:0.01; pointer-events:none; z-index:-1;';
    this.nameInput.addEventListener('input', (e) => {
      this.playerName = e.target.value;
    });
    document.body.appendChild(this.nameInput);

    // Create room ID input
    this.roomInput = document.createElement('input');
    this.roomInput.type = 'text';
    this.roomInput.placeholder = '输入房间号';
    this.roomInput.maxLength = 6;
    this.roomInput.autocomplete = 'off';
    this.roomInput.inputMode = 'numeric';
    this.roomInput.style.cssText = 'position:fixed; left:8px; top:8px; width:1px; height:1px; opacity:0.01; pointer-events:none; z-index:-1;';
    this.roomInput.addEventListener('input', (e) => {
      this.roomIdInput = e.target.value.replace(/\D/g, '').slice(0, 6);
      e.target.value = this.roomIdInput;
    });
    document.body.appendChild(this.roomInput);
  }

  removeHTMLInputs() {
    if (this.nameInput) {
      this.nameInput.remove();
      this.nameInput = null;
    }
    if (this.roomInput) {
      this.roomInput.remove();
      this.roomInput = null;
    }
  }

  exit() {
    this.removeHTMLInputs();

    // Unregister network handlers
    this.networkManager.off('ROOM_CREATED', this._onRoomCreated);
    this.networkManager.off('ROOM_JOINED', this._onRoomJoined);
    this.networkManager.off('PLAYER_JOINED', this._onPlayerJoined);
    this.networkManager.off('PLAYER_LEFT', this._onPlayerLeft);
    this.networkManager.off('ERROR', this._onError);
    this.networkManager.off('GAME_STARTED', this._onGameStarted);
    this.networkManager.off('MAP_SELECTED', this._onMapSelected);
  }

  // ===== Network Event Handlers =====

  onRoomCreated(data) {
    console.log('[Lobby] Room created:', data);
    this.roomId = data.roomId;
    this.players = data.players || [];
    this.isHost = true;
    this.hostId = data.playerId || this.networkManager.getPlayerId();
    this.selectedMapKey = data.mapKey || 'map1';
    this.selectedBgIndex = data.bgIndex ?? 0;
    this.mode = 'waiting';
    this.loading = false;
    this.error = '';
  }

  onRoomJoined(data) {
    console.log('[Lobby] Room joined:', data);
    this.roomId = data.roomId;
    this.players = data.players || [];
    this.isHost = false;
    // First player in the list is the host
    this.hostId = this.players[0]?.id || null;
    this.selectedMapKey = data.mapKey || 'map1';
    this.selectedBgIndex = data.bgIndex ?? 0;
    this.mode = 'waiting';
    this.loading = false;
    this.error = '';
  }

  onPlayerJoined(data) {
    console.log('[Lobby] Player joined event:', data);
    console.log('[Lobby] Current players before:', JSON.stringify(this.players));

    // Add player if not already in list
    const exists = this.players.find(p => p.id === data.playerId);
    if (!exists) {
      const newPlayer = {
        id: data.playerId,
        name: data.playerName,
        character: data.character,
      };
      this.players = [...this.players, newPlayer];
      console.log('[Lobby] Added player, new list:', JSON.stringify(this.players));
    } else {
      console.log('[Lobby] Player already in list');
    }
  }

  onPlayerLeft(data) {
    console.log('[Lobby] Player left:', data);
    this.players = this.players.filter((p) => p.id !== data.playerId);
  }

  onMapSelected(data) {
    this.selectedMapKey = data.mapKey || 'map1';
    this.selectedBgIndex = data.bgIndex ?? 0;
  }

  onError(data) {
    console.error('[Lobby] Error:', data);
    this.error = data.message;
    this.loading = false;
  }

  onGameStarted(data) {
    console.log('[Lobby] Game started:', data);
    // Store game data and transition to network run
    this.ctx.networkPlayers = data.players;
    this.ctx.isNetworkHost = this.isHost;
    this.ctx.networkBgIndex = data.bgIndex ?? 0;
    this.ctx.networkMapKey = data.mapKey || this.ctx.mapKey;
    this.ctx.networkMapData = data.mapData || null;

    // Load the server-selected map/background on both peers so later phases
    // start from the same visual state.
    if (data.mapData) {
      this.ctx.mapManager.applyNetworkMapData(data.mapData, this.ctx, data.bgIndex);
    } else if (data.mapKey) {
      this.ctx.mapManager.selectMapWithBg(data.mapKey, this.ctx, data.bgIndex);
    }

    this.goTo(GameStage.NETWORK_RUN);
  }

  // ===== Update =====

  update(deltaTime) {
    this.previewAnimTick += deltaTime;

    // Blink cursor
    this.cursorTimer += deltaTime;
    if (this.cursorTimer > 500) {
      this.cursorTimer = 0;
      this.cursorVisible = !this.cursorVisible;
    }
  }

  // ===== Render =====

  render(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    p.background(20, 25, 40);

    switch (this.mode) {
      case 'menu':
        this.renderMenu(mx, my);
        break;
      case 'create':
        this.renderCreate(mx, my);
        break;
      case 'join':
        this.renderJoin(mx, my);
        break;
      case 'waiting':
        this.renderWaiting(mx, my);
        break;
    }

    // Error message
    if (this.error) {
      p.fill(255, 80, 80);
      p.textAlign(p.CENTER, p.TOP);
      p.textSize(5);
      p.text(this.error, gameWidth / 2, gameHeight - 40);
    }
  }

  renderMenu(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    // Title
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(14);
    p.text('超级鸡马', gameWidth / 2, 120);

    p.fill(200, 200, 220);
    p.textSize(6);
    p.text('多人在线版', gameWidth / 2, 155);

    // Create Room button
    this.drawButton(
      gameWidth / 2 - 100,
      220,
      200,
      50,
      '创建房间',
      mx,
      my
    );

    // Join Room button
    this.drawButton(
      gameWidth / 2 - 100,
      290,
      200,
      50,
      '加入房间',
      mx,
      my
    );

    // Back button
    this.drawButton(
      gameWidth / 2 - 100,
      360,
      200,
      50,
      '返回主菜单',
      mx,
      my,
      [100, 100, 120]
    );
  }

  renderCreate(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    // Title
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    p.text('创建房间', gameWidth / 2, 60);

    // Player name input
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    p.text('你的昵称:', 200, 130);

    this.drawInput(300, 120, 300, 40, this.playerName, this.inputActive === 'name');

    // Character selection
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    p.text('选择角色:', 200, 190);

    this.renderCharacterSelection(300, 180, mx, my);

    // Create button
    this.drawButton(
      gameWidth / 2 - 100,
      300,
      200,
      50,
      this.loading ? '创建中...' : '创建',
      mx,
      my,
      this.loading ? [80, 80, 100] : [80, 180, 80]
    );

    // Back button
    this.drawButton(
      gameWidth / 2 - 100,
      370,
      200,
      50,
      '返回',
      mx,
      my,
      [100, 100, 120]
    );
  }

  renderJoin(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    // Title
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    p.text('加入房间', gameWidth / 2, 60);

    // Player name input
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    p.text('你的昵称:', 200, 130);

    this.drawInput(300, 120, 300, 40, this.playerName, this.inputActive === 'name');

    // Room ID input
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    p.text('房间号:', 200, 190);

    this.drawInput(
      300,
      180,
      300,
      40,
      this.roomIdInput,
      this.inputActive === 'roomId'
    );

    // Character selection
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    p.text('选择角色:', 200, 250);

    this.renderCharacterSelection(300, 240, mx, my);

    // Join button
    this.drawButton(
      gameWidth / 2 - 100,
      350,
      200,
      50,
      this.loading ? '加入中...' : '加入',
      mx,
      my,
      this.loading ? [80, 80, 100] : [80, 120, 200]
    );

    // Back button
    this.drawButton(
      gameWidth / 2 - 100,
      420,
      200,
      50,
      '返回',
      mx,
      my,
      [100, 100, 120]
    );
  }

  renderWaiting(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    // Title
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    p.text('等待玩家加入', gameWidth / 2, 60);

    // Room ID - make it more visible
    p.fill(200, 200, 220);
    p.textSize(6);
    p.text('房间号:', gameWidth / 2, 100);

    p.fill(255, 255, 100);
    p.textSize(16);
    p.text(this.roomId || '------', gameWidth / 2, 130);

    p.fill(150, 150, 170);
    p.textSize(4);
    p.text('分享此房间号给朋友加入', gameWidth / 2, 160);

    // Player list - show all players
    p.fill(200, 200, 220);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(6);
    p.text(`玩家列表 (${this.players.length}/4):`, 200, 200);

    let y = 230;
    for (const player of this.players) {
      const isLocal = player.id === this.networkManager.getPlayerId();
      const isHost = player.id === this.hostId;

      // Player card background
      p.fill(isLocal ? p.color(40, 60, 100) : p.color(30, 35, 50));
      p.rect(200, y - 15, 500, 40, 8);

      // Player info
      p.fill(isLocal ? p.color(90, 170, 255) : p.color(200, 200, 200));
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(5);

      const characterName = this.getCharacterName(player.character);
      const hostTag = isHost ? ' [房主]' : '';
      const localTag = isLocal ? ' (你)' : '';
      p.text(
        `${player.name}${localTag}${hostTag} - ${characterName}`,
        220,
        y
      );
      y += 50;
    }

    // Empty slots
    for (let i = this.players.length; i < 4; i++) {
      p.fill(60, 60, 80);
      p.textAlign(p.LEFT, p.CENTER);
      p.text('等待玩家加入...', 220, y);
      y += 50;
    }

    this.renderMapSelection(mx, my);

    // Start button (host only)
    if (this.isHost) {
      const canStart = this.players.length >= 2;
      this.drawButton(
        gameWidth / 2 - 100,
        430,
        200,
        50,
        canStart ? '开始游戏' : '需要2人以上',
        mx,
        my,
        canStart ? [80, 180, 80] : [80, 80, 100]
      );
    } else {
      p.fill(150, 150, 170);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5);
      p.text('等待房主开始游戏...', gameWidth / 2, 440);
    }

    // Leave button
    this.drawButton(
      50,
      gameHeight - 60,
      100,
      40,
      '离开',
      mx,
      my,
      [180, 60, 60]
    );
  }

  renderMapSelection(mx, my) {
    const { p } = this.ctx;
    const cards = [
      { key: 'map1', label: '森林', x: 725, y: 205, color: [80, 170, 110] },
      { key: 'map2', label: '雪原', x: 725, y: 315, color: [115, 185, 245] },
    ];

    p.fill(210, 220, 240);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(5.2);
    p.text(this.isHost ? '选择地图' : '房主地图', 805, 182);

    for (const card of cards) {
      this.drawMapCard(card, mx, my);
    }
  }

  drawMapCard(card, mx, my) {
    const { p, mapPreviews } = this.ctx;
    const w = 160;
    const h = 88;
    const selected = this.selectedMapKey === card.key;
    const hovered = mx >= card.x && mx <= card.x + w && my >= card.y && my <= card.y + h;
    const preview = mapPreviews?.[card.key];

    p.noStroke();
    p.fill(selected ? p.color(35, 64, 92, 235) : p.color(28, 34, 50, 220));
    p.rect(card.x, card.y, w, h, 8);

    if (preview) {
      p.image(preview, card.x + 6, card.y + 6, w - 12, h - 32);
      p.fill(0, 0, 0, 85);
      p.rect(card.x + 6, card.y + 6, w - 12, h - 32);
    } else {
      p.fill(...card.color, 145);
      p.rect(card.x + 6, card.y + 6, w - 12, h - 32, 5);
    }

    p.stroke(...card.color, selected || hovered ? 255 : 150);
    p.strokeWeight(selected ? 2.4 : 1.4);
    p.noFill();
    p.rect(card.x, card.y, w, h, 8);
    p.noStroke();

    p.fill(selected ? p.color(255, 240, 135) : p.color(230, 236, 248));
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(5);
    p.text(card.label, card.x + w / 2, card.y + h - 14);
  }

  getCharacterName(characterId) {
    const names = {
      chicken: '小鸡',
      bunny: '兔兔',
      duck: '鸭鸭',
      polar: '北极熊',
    };
    return names[characterId] || characterId;
  }

  // ===== Character Selection =====

  renderCharacterSelection(x, y, mx, my) {
    const { p } = this.ctx;
    const size = 60;
    const gap = 10;

    for (let i = 0; i < this.characters.length; i++) {
      const char = this.characters[i];
      const cx = x + i * (size + gap);
      const isSelected = this.selectedCharacter === char.id;

      // Background
      p.fill(isSelected ? p.color(60, 80, 120) : p.color(40, 45, 60));
      p.rect(cx, y, size, size, 8);

      // Border
      if (isSelected) {
        p.stroke(90, 170, 255);
        p.strokeWeight(2);
        p.noFill();
        p.rect(cx, y, size, size, 8);
        p.noStroke();
      }

      // Character sprite preview
      this.drawCharacterPreview(char, cx, y, size);

      // Name
      p.fill(255);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.textSize(3.5);
      p.text(char.name, cx + size / 2, y + size - 2);
    }
  }

  drawCharacterPreview(char, x, y, size) {
    const { p, sprites } = this.ctx;
    const sheet = sprites?.[char.id];
    const cx = x + size / 2;
    const cy = y + size / 2 - 5;

    if (!sheet) {
      p.fill(...char.color);
      p.circle(cx, cy, 30);
      return;
    }

    const frameW = 28;
    const frameH = sheet.height;
    const frameCount = Math.max(1, Math.floor(sheet.width / frameW));
    const frameIndex = Math.floor(this.previewAnimTick / 180) % frameCount;
    const drawH = Math.min(42, frameH * 1.7);
    const drawW = frameW * (drawH / frameH);
    const drawX = cx - drawW / 2;
    const drawY = y + 8;

    p.push();
    p.noSmooth();
    p.image(
      sheet,
      drawX,
      drawY,
      drawW,
      drawH,
      frameIndex * frameW,
      0,
      frameW,
      frameH,
    );
    p.pop();
  }

  // ===== UI Helpers =====

  drawButton(x, y, w, h, text, mx, my, color = [60, 100, 180]) {
    const { p } = this.ctx;
    const isHover = mx >= x && mx <= x + w && my >= y && my <= y + h;

    // Background
    p.fill(isHover ? p.color(color[0] + 20, color[1] + 20, color[2] + 20) : p.color(...color));
    p.rect(x, y, w, h, 8);

    // Text
    p.fill(255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(6);
    p.text(text, x + w / 2, y + h / 2);

    return isHover;
  }

  drawInput(x, y, w, h, value, isActive) {
    const { p } = this.ctx;

    // Background
    p.fill(isActive ? p.color(50, 55, 70) : p.color(35, 40, 55));
    p.rect(x, y, w, h, 6);

    // Border
    if (isActive) {
      p.stroke(90, 170, 255);
      p.strokeWeight(2);
      p.noFill();
      p.rect(x, y, w, h, 6);
      p.noStroke();
    }

    // Text
    p.fill(255);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(5);
    const displayText = isActive && this.cursorVisible ? value + '|' : value;
    p.text(displayText || '请输入...', x + 10, y + h / 2);

    // Handle click for focus
    if (this.ctx.p.mouseIsPressed) {
      const mx = this.ctx.p.mouseX;
      const my = this.ctx.p.mouseY;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        return true;
      }
    }
    return false;
  }

  // ===== Actions =====

  async createRoom() {
    if (!this.playerName.trim()) {
      this.error = '请输入昵称';
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      // Generate a temporary roomId for WebSocket connection
      const tempRoomId = this.generateTempRoomId();

      // Connect to WebSocket with a new room
      const workerBase = this.ctx.workerUrl || 'ws://127.0.0.1:8787';
      const wsUrl = `${workerBase}/room/${tempRoomId}/websocket`;
      console.log('Connecting to WebSocket:', wsUrl);
      await this.networkManager.connect(wsUrl);

      // Wait for WELCOME message (event-driven, not fixed timeout)
      await this.networkManager.waitFor('WELCOME', 5000);

      // Send CREATE_ROOM via WebSocket
      console.log('Sending CREATE_ROOM...');
      const result = await this.networkManager.createRoom(
        this.playerName,
        this.selectedCharacter
      );
      console.log('Room created:', result);
    } catch (error) {
      console.error('Create room error:', error);
      this.error = '创建房间失败: ' + (error.message || '连接服务器失败');
      this.loading = false;
    }
  }

  async joinRoom() {
    if (!this.playerName.trim()) {
      this.error = '请输入昵称';
      return;
    }

    if (!this.roomIdInput.trim()) {
      this.error = '请输入房间号';
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const roomId = this.roomIdInput.replace(/\D/g, '').slice(0, 6);

      // Connect to WebSocket for the specific room
      const workerBase = this.ctx.workerUrl || 'ws://127.0.0.1:8787';
      const wsUrl = `${workerBase}/room/${roomId}/websocket`;
      console.log('Connecting to WebSocket:', wsUrl);
      await this.networkManager.connect(wsUrl);

      // Wait for WELCOME message (event-driven, not fixed timeout)
      await this.networkManager.waitFor('WELCOME', 5000);

      // Send JOIN_ROOM via WebSocket
      console.log('Sending JOIN_ROOM...');
      const result = await this.networkManager.joinRoom(
        roomId,
        this.playerName,
        this.selectedCharacter
      );
      console.log('Join room result:', result);
    } catch (error) {
      console.error('Join room error:', error);
      this.error = '加入房间失败: ' + (error.message || '连接服务器失败');
      this.loading = false;
    }
  }

  generateTempRoomId() {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  focusHiddenInput(type) {
    this.inputActive = type;
    if (type === 'name' && this.nameInput) {
      this.nameInput.value = this.playerName;
      setTimeout(() => this.nameInput?.focus(), 0);
      return;
    }
    if (type === 'roomId' && this.roomInput) {
      this.roomInput.value = this.roomIdInput;
      setTimeout(() => this.roomInput?.focus(), 0);
      return;
    }
  }

  blurHiddenInputs() {
    this.inputActive = null;
    this.nameInput?.blur();
    this.roomInput?.blur();
  }

  isDomInputFocused(type) {
    if (typeof document === 'undefined') return false;
    if (type === 'name') return document.activeElement === this.nameInput;
    if (type === 'roomId') return document.activeElement === this.roomInput;
    return false;
  }

  // ===== Input Handling =====

  keyPressed() {
    const { p } = this.ctx;
    const nameDomFocused = this.isDomInputFocused('name');
    const roomDomFocused = this.isDomInputFocused('roomId');

    if (p.keyCode === p.BACKSPACE) {
      if (this.inputActive === 'roomId' && !roomDomFocused) {
        this.roomIdInput = this.roomIdInput.slice(0, -1);
        if (this.roomInput) this.roomInput.value = this.roomIdInput;
      }
    } else if (p.keyCode === p.ENTER) {
      if (this.mode === 'create') {
        this.createRoom();
      } else if (this.mode === 'join') {
        this.joinRoom();
      }
    } else if (p.keyCode === p.ESCAPE) {
      if (this.mode !== 'menu') {
        this.mode = 'menu';
        this.blurHiddenInputs();
      } else {
        this.goTo(GameStage.MENU);
      }
    } else if (p.key.length === 1) {
      if (this.inputActive === 'name' && !nameDomFocused && this.playerName.length < 20) {
        this.playerName += p.key;
        if (this.nameInput) this.nameInput.value = this.playerName;
      } else if (
        this.inputActive === 'roomId' &&
        !roomDomFocused &&
        this.roomIdInput.length < 6 &&
        /^\d$/.test(p.key)
      ) {
        this.roomIdInput += p.key;
        if (this.roomInput) this.roomInput.value = this.roomIdInput;
      }
    }
  }

  mousePressed(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    if (this.mode === 'menu') {
      // Menu buttons
      const btnW = 200;
      const btnH = 50;
      const btnX = gameWidth / 2 - 100;

      // Create Room button (y=220)
      if (mx >= btnX && mx <= btnX + btnW && my >= 220 && my <= 220 + btnH) {
        this.mode = 'create';
        this.error = '';
        return;
      }

      // Join Room button (y=290)
      if (mx >= btnX && mx <= btnX + btnW && my >= 290 && my <= 290 + btnH) {
        this.mode = 'join';
        this.error = '';
        return;
      }

      // Back button (y=360)
      if (mx >= btnX && mx <= btnX + btnW && my >= 360 && my <= 360 + btnH) {
        this.goTo(GameStage.MENU);
        return;
      }
    } else if (this.mode === 'create') {
      // Input focus - use HTML input for Chinese support
      if (mx >= 300 && mx <= 600 && my >= 120 && my <= 160) {
        this.focusHiddenInput('name');
      } else {
        this.blurHiddenInputs();
      }

      // Character selection
      this.handleCharacterClick(mx, my);

      const btnW = 200;
      const btnH = 50;
      const btnX = gameWidth / 2 - 100;

      // Create button (y=300)
      if (mx >= btnX && mx <= btnX + btnW && my >= 300 && my <= 300 + btnH && !this.loading) {
        this.createRoom();
        return;
      }

      // Back button (y=370)
      if (mx >= btnX && mx <= btnX + btnW && my >= 370 && my <= 370 + btnH) {
        this.mode = 'menu';
        return;
      }
    } else if (this.mode === 'join') {
      // Input focus - use HTML input for Chinese support
      if (mx >= 300 && mx <= 600 && my >= 120 && my <= 160) {
        this.focusHiddenInput('name');
      } else if (mx >= 300 && mx <= 600 && my >= 180 && my <= 220) {
        this.focusHiddenInput('roomId');
      } else {
        this.blurHiddenInputs();
      }

      // Character selection
      this.handleCharacterClick(mx, my);

      const btnW = 200;
      const btnH = 50;
      const btnX = gameWidth / 2 - 100;

      // Join button (y=350)
      if (mx >= btnX && mx <= btnX + btnW && my >= 350 && my <= 350 + btnH && !this.loading) {
        this.joinRoom();
        return;
      }

      // Back button (y=420)
      if (mx >= btnX && mx <= btnX + btnW && my >= 420 && my <= 420 + btnH) {
        this.mode = 'menu';
        return;
      }
    } else if (this.mode === 'waiting') {
      const btnW = 200;
      const btnH = 50;
      const btnX = gameWidth / 2 - 100;

      if (this.handleMapClick(mx, my)) {
        return;
      }

      // Start button (host only, y=420)
      if (this.isHost && mx >= btnX && mx <= btnX + btnW && my >= 420 && my <= 420 + btnH) {
        if (this.players.length >= 2) {
          this.networkManager.startGame({
            mapKey: this.selectedMapKey,
            bgIndex: this.selectedBgIndex,
          });
        }
        return;
      }

      // Leave button (x=50, y=gameHeight-60)
      if (mx >= 50 && mx <= 150 && my >= gameHeight - 60 && my <= gameHeight - 20) {
        this.networkManager.disconnect();
        this.mode = 'menu';
        return;
      }
    }
  }

  handleMapClick(mx, my) {
    if (!this.isHost) return false;

    const cards = [
      { key: 'map1', x: 725, y: 205 },
      { key: 'map2', x: 725, y: 315 },
    ];
    const w = 160;
    const h = 88;
    for (const card of cards) {
      if (mx >= card.x && mx <= card.x + w && my >= card.y && my <= card.y + h) {
        this.selectedMapKey = card.key;
        this.selectedBgIndex = Math.floor(Math.random() * 8);
        this.networkManager.selectMap?.(this.selectedMapKey, this.selectedBgIndex);
        return true;
      }
    }
    return false;
  }

  handleCharacterClick(mx, my) {
    const size = 60;
    const gap = 10;
    const startX = 300;
    const startY = this.mode === 'create' ? 180 : 240;

    for (let i = 0; i < this.characters.length; i++) {
      const cx = startX + i * (size + gap);
      if (mx >= cx && mx <= cx + size && my >= startY && my <= startY + size) {
        this.selectedCharacter = this.characters[i].id;
        break;
      }
    }
  }
}
