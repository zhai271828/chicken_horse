/**
 * GameRoom - Durable Object for managing a multiplayer game room
 *
 * Handles WebSocket connections, game state, physics, and synchronization.
 */

// Game configuration (mirrored from client)
const CONFIG = {
  GAME_WIDTH: 960,
  GAME_HEIGHT: 544,
  TILE: 32,
  PLAYERSPEED: 3.2,
  JUMP_VELOCITY: 12,
  GRAVITY: 0.7,
  MAX_FALL_SPEED: 18,
  RESPAWN_TIME: 2000,
  TIME_LIMIT: 90,
  TICK_RATE: 20, // FPS
};

// Game stages
const GameStage = {
  LOBBY: 'LOBBY',
  CHAR_SELECT: 'CHAR_SELECT',
  BUILD: 'BUILD',
  RUN: 'RUN',
  RESULTS: 'RESULTS',
  SHOP: 'SHOP',
};

// Player states
const PlayerState = {
  ALIVE: 'ALIVE',
  DEAD: 'DEAD',
  RESPAWNING: 'RESPAWNING',
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // playerId -> { ws, lastInput, lastInputTime }
    this.gameState = this.createInitialState();
    this.tickInterval = null;
    this.lastTick = 0;
    this.buildTimer = 0;
    this.buildTimeLimit = 30; // 30 seconds for building
    this.shopPhaseTimer = null;
  }

  createInitialState() {
    return {
      stage: GameStage.LOBBY,
      roomId: null,
      hostId: null,
      players: new Map(),
      obstacles: [],
      coins: [],
      scores: new Map(),
      round: 0,
      mapKey: 'map1',
      mapData: null,
      bgIndex: 0,
      timeLeft: CONFIG.TIME_LIMIT,
      buildTimeLeft: 0,
      // Track which players have finished each simultaneous phase
      shopDonePlayers: new Set(),
      buildDonePlayers: new Set(),
      resultsDonePlayers: new Set(),
      paused: false,
      pausedById: null,
      pausedByName: null,
      // Shop items for the current round (server-generated for sync)
      shopItems: [],
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle WebSocket connection
    if (url.pathname.endsWith('/websocket')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      // Extract roomId from URL path (e.g., /room/ABC123/websocket)
      const pathParts = url.pathname.split('/').filter(p => p);
      if (pathParts.length >= 2 && pathParts[0] === 'room') {
        const roomId = pathParts[1];
        if (!this.gameState.roomId) {
          this.gameState.roomId = roomId;
          console.log('[GameRoom] Set roomId:', roomId);
        }
      }

      const pair = new WebSocketPair();
      await this.handleSession(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Handle init request from HTTP API
    if (url.pathname === '/init' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.roomId) {
          this.gameState.roomId = body.roomId;
          console.log('[GameRoom] Init roomId:', body.roomId);
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/status') {
      return new Response(
        JSON.stringify({
          players: this.sessions.size,
          stage: this.gameState.stage,
          roomId: this.gameState.roomId,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  async handleSession(ws) {
    ws.accept();
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const session = {
      ws,
      playerId,
      lastInput: { left: false, right: false, jump: false },
      lastInputTime: 0,
    };

    this.sessions.set(playerId, session);

    // Let the handshake finish before the first server push. Sending during the
    // upgrade response phase can work locally but has proven flaky on edge.
    queueMicrotask(() => {
      try {
        ws.send(
          JSON.stringify({
            type: 'WELCOME',
            data: {
              playerId,
              roomId: this.gameState.roomId
            },
          })
        );
      } catch (error) {
        console.error('WELCOME send error:', error);
      }
    });

    ws.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleMessage(playerId, message);
      } catch (error) {
        console.error('Message error:', error);
        this.sendToPlayer(playerId, {
          type: 'ERROR',
          data: { code: 'INVALID_MESSAGE', message: error.message },
        });
      }
    });

    ws.addEventListener('close', () => {
      this.handleDisconnect(playerId);
    });

    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.handleDisconnect(playerId);
    });
  }

  async handleMessage(playerId, message) {
    const { type, data } = message;

    switch (type) {
      case 'CREATE_ROOM':
        this.handleCreateRoom(playerId, data);
        break;

      case 'JOIN_ROOM':
        this.handleJoinRoom(playerId, data);
        break;

      case 'PLAYER_INPUT':
        this.handlePlayerInput(playerId, data);
        break;

      case 'REJOIN':
        this.handleRejoin(playerId, data);
        break;

      case 'GAME_STATE':
        this.handleGameStateBroadcast(playerId, data);
        break;

      case 'PLAYER_READY':
        this.handlePlayerReady(playerId);
        break;

      case 'START_GAME':
        this.handleStartGame(playerId, data);
        break;

      case 'SELECT_CHARACTER':
        this.handleSelectCharacter(playerId, data);
        break;

      case 'SELECT_MAP':
        this.handleSelectMap(playerId, data);
        break;

      case 'PLACE_OBSTACLE':
        this.handlePlaceObstacle(playerId, data);
        break;

      case 'UNDO_OBSTACLE':
        this.handleUndoObstacle(playerId, data);
        break;

      case 'BUY_OBSTACLE':
        this.handleBuyObstacle(playerId, data);
        break;

      case 'USE_ERASER':
        this.handleUseEraser(playerId, data);
        break;

      case 'SHOP_PURCHASE':
        this.handleShopPurchase(playerId, data);
        break;

      case 'SHOP_DONE':
        this.handleShopDone(playerId);
        break;

      case 'BUILD_DONE':
        this.handleBuildDone(playerId);
        break;

      case 'RESULTS_DONE':
        this.handleResultsDone(playerId);
        break;

      case 'PAUSE_GAME':
        this.handlePauseGame(playerId, true);
        break;

      case 'RESUME_GAME':
        this.handlePauseGame(playerId, false);
        break;

      // Host relay messages — forward to all other clients
      case 'ROUND_ENDED':
      case 'STAGE_CHANGE':
        console.log(`[GameRoom] Received ${type} from ${playerId}, relaying...`);
        this.relayToClients(playerId, type, data);
        break;

      case 'ROUND_RESULTS':
        this.handleRoundResults(playerId, data);
        break;

      default:
        console.warn('[GameRoom] Unknown message type:', type);
    }
  }

  handleRoundResults(playerId, data) {
    if (playerId !== this.gameState.hostId) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_HOST', message: 'Only host can commit round results' },
      });
      return;
    }

    this.gameState.stage = GameStage.RESULTS;
    this.gameState.resultsDonePlayers = new Set();

    for (const ranking of data?.rankings || []) {
      if (!ranking?.id) continue;
      if (!this.gameState.scores.has(ranking.id)) {
        this.gameState.scores.set(ranking.id, this.createScore());
      }

      const score = this.gameState.scores.get(ranking.id);
      score.points = ranking.totalPoints ?? score.points ?? 0;
      score.coins = ranking.coins ?? score.coins ?? 0;
      score.rainbowCoins = ranking.rainbowCoins ?? score.rainbowCoins ?? 0;
      score.roundCoins = 0;
      score.wallet = ranking.wallet ?? score.wallet ?? 0;
      score.kills = ranking.kills ?? score.kills ?? 0;
      score.deaths = ranking.deaths ?? score.deaths ?? 0;
      score.finished = Boolean(ranking.finished);
      score.finishTime = ranking.finishTime ?? null;

      const player = this.gameState.players.get(ranking.id);
      if (player) {
        player.finished = Boolean(ranking.finished);
        player.deaths = ranking.deaths ?? player.deaths ?? 0;
      }
    }

    const anyoneFinished = (data?.rankings || []).some(player => player.finished);
    if (!anyoneFinished) {
      this.gameState.noFinishRounds = (this.gameState.noFinishRounds || 0) + 1;
    } else {
      this.gameState.noFinishRounds = 0;
    }

    const shouldAdvance = Boolean(data?.shouldAdvance) || this.checkMapAdvance();
    if (shouldAdvance) {
      this.advanceMap(data);
    }

    const results = {
      ...(data || {}),
      shouldAdvance,
      titles: shouldAdvance ? (data?.titles || {}) : {},
      mapKey: this.gameState.mapKey,
      bgIndex: this.gameState.bgIndex ?? 0,
      mapData: this.gameState.mapData,
    };

    this.gameState.lastRoundResults = results;
    this.broadcast({
      type: 'ROUND_RESULTS',
      data: results,
    });

    if (this.shopPhaseTimer) {
      clearTimeout(this.shopPhaseTimer);
      this.shopPhaseTimer = null;
    }
  }

  handleResultsDone(playerId) {
    if (this.gameState.stage !== GameStage.RESULTS) return;
    if (!this.gameState.players.has(playerId)) return;

    this.gameState.resultsDonePlayers.add(playerId);

    this.broadcast({
      type: 'RESULTS_SYNC',
      data: {
        playerId,
        done: true,
        doneCount: this.gameState.resultsDonePlayers.size,
        totalPlayers: this.gameState.players.size,
      },
    });

    if (this.gameState.resultsDonePlayers.size >= this.gameState.players.size) {
      if (this.gameState.lastRoundResults?.shouldAdvance) {
        this.startRunPhase();
      } else {
        this.startShopPhase();
      }
    }
  }

  handlePauseGame(playerId, paused) {
    if (this.gameState.stage !== GameStage.RUN) return;
    if (!this.gameState.players.has(playerId)) return;

    const player = this.gameState.players.get(playerId);
    this.gameState.paused = paused;
    this.gameState.pausedById = paused ? playerId : null;
    this.gameState.pausedByName = paused ? (player?.name || 'Player') : null;

    this.broadcast({
      type: 'GAME_PAUSE_CHANGED',
      data: {
        paused: this.gameState.paused,
        pausedById: this.gameState.pausedById,
        pausedByName: this.gameState.pausedByName,
      },
    });
  }

  // ===== Reconnection =====

  handleRejoin(newPlayerId, data) {
    const { playerId: oldPlayerId, roomId } = data;

    // Check if the old player session exists (was disconnected)
    const oldPlayer = this.gameState.players.get(oldPlayerId);
    if (!oldPlayer) {
      this.sendToPlayer(newPlayerId, {
        type: 'ERROR',
        data: { code: 'REJOIN_FAILED', message: 'Session expired' },
      });
      return;
    }

    // Migrate the player to the new session
    this.gameState.players.delete(oldPlayerId);
    this.gameState.players.set(newPlayerId, oldPlayer);
    oldPlayer.id = newPlayerId;

    // Migrate score
    const score = this.gameState.scores.get(oldPlayerId);
    if (score) {
      this.gameState.scores.delete(oldPlayerId);
      this.gameState.scores.set(newPlayerId, score);
    }

    // Migrate shop/build done state
    if (this.gameState.shopDonePlayers.has(oldPlayerId)) {
      this.gameState.shopDonePlayers.delete(oldPlayerId);
      this.gameState.shopDonePlayers.add(newPlayerId);
    }
    if (this.gameState.buildDonePlayers.has(oldPlayerId)) {
      this.gameState.buildDonePlayers.delete(oldPlayerId);
      this.gameState.buildDonePlayers.add(newPlayerId);
    }
    if (this.gameState.resultsDonePlayers.has(oldPlayerId)) {
      this.gameState.resultsDonePlayers.delete(oldPlayerId);
      this.gameState.resultsDonePlayers.add(newPlayerId);
    }

    // Update host if needed
    if (this.gameState.hostId === oldPlayerId) {
      this.gameState.hostId = newPlayerId;
    }

    // Send current state to reconnected player
    this.sendToPlayer(newPlayerId, {
      type: 'REJOIN_SUCCESS',
      data: {
        playerId: newPlayerId,
        roomId: this.gameState.roomId,
        stage: this.gameState.stage,
        players: this.getPlayersArray(),
        mapKey: this.gameState.mapKey,
        mapData: this.gameState.mapData,
        bgIndex: this.gameState.bgIndex ?? 0,
        obstacles: this.gameState.obstacles,
        scores: Object.fromEntries(this.gameState.scores),
        paused: this.gameState.paused,
        pausedById: this.gameState.pausedById,
        pausedByName: this.gameState.pausedByName,
      },
    });

    // Notify others
    this.broadcast({
      type: 'PLAYER_REJOINED',
      data: { oldPlayerId, newPlayerId, playerName: oldPlayer.name },
    }, newPlayerId);
  }

  // ===== Room Management =====

  handleCreateRoom(playerId, data) {
    if (!this.gameState.roomId) {
      this.gameState.roomId = this.generateRoomId();
    }

    this.gameState.hostId = playerId;

    const player = this.createPlayer(playerId, data.playerName, data.character);
    this.gameState.players.set(playerId, player);
    this.gameState.scores.set(playerId, this.createScore());

    this.sendToPlayer(playerId, {
      type: 'ROOM_CREATED',
      data: {
        roomId: this.gameState.roomId,
        playerId,
        players: this.getPlayersArray(),
        mapKey: this.gameState.mapKey,
        bgIndex: this.gameState.bgIndex ?? 0,
      },
    });
  }

  handleJoinRoom(playerId, data) {
    if (this.gameState.stage !== GameStage.LOBBY) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'GAME_IN_PROGRESS', message: 'Game already in progress' },
      });
      return;
    }

    if (this.gameState.players.size >= 4) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'ROOM_FULL', message: 'Room is full' },
      });
      return;
    }

    // If no players yet, this player becomes host
    if (this.gameState.players.size === 0) {
      this.gameState.hostId = playerId;
    }

    const player = this.createPlayer(playerId, data.playerName, data.character);
    this.gameState.players.set(playerId, player);
    this.gameState.scores.set(playerId, this.createScore());

    this.sendToPlayer(playerId, {
      type: 'ROOM_JOINED',
      data: {
        roomId: this.gameState.roomId,
        playerId,
        players: this.getPlayersArray(),
        mapKey: this.gameState.mapKey,
        bgIndex: this.gameState.bgIndex ?? 0,
      },
    });

    // Broadcast to other players
    this.broadcast(
      {
        type: 'PLAYER_JOINED',
        data: {
          playerId,
          playerName: data.playerName,
          character: data.character,
        },
      },
      playerId
    );
  }

  handlePlayerReady(playerId) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    player.ready = !player.ready;

    this.broadcast({
      type: 'PLAYER_READY_CHANGED',
      data: {
        playerId,
        ready: player.ready,
      },
    });
  }

  handleSelectCharacter(playerId, data) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    player.character = data.character;

    this.broadcast({
      type: 'CHARACTER_SELECTED',
      data: {
        playerId,
        character: data.character,
      },
    });
  }

  handleSelectMap(playerId, data) {
    if (playerId !== this.gameState.hostId) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_HOST', message: 'Only host can select the map' },
      });
      return;
    }

    if (data?.mapKey) {
      this.gameState.mapKey = data.mapKey === 'map2' ? 'map2' : 'map1';
    }
    this.gameState.bgIndex = data?.bgIndex ?? 0;
    this.gameState.mapData = null;

    this.broadcast({
      type: 'MAP_SELECTED',
      data: {
        mapKey: this.gameState.mapKey,
        bgIndex: this.gameState.bgIndex,
      },
    });
  }

  handleStartGame(playerId, data) {
    if (playerId !== this.gameState.hostId) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_HOST', message: 'Only host can start the game' },
      });
      return;
    }

    if (this.gameState.players.size < 2) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 2 players' },
      });
      return;
    }

    this.gameState.mapKey = data?.mapKey === 'map2' ? 'map2' : 'map1';
    this.gameState.mapData = data?.mapData || null;
    this.gameState.bgIndex = data?.bgIndex ?? 0;
    this.startGame();
  }

  // ===== Game Logic =====

  startGame() {
    this.gameState.round = 1;
    this.gameState.stage = GameStage.RUN;

    console.log('[GameRoom] Game started, players:', this.gameState.players.size);

    // Broadcast game started to all players
    // The host client will run the actual game logic
    this.broadcast({
      type: 'GAME_STARTED',
      data: {
        stage: GameStage.RUN,
        round: 1,
        players: this.getPlayersArray(),
        mapKey: this.gameState.mapKey,
        mapData: this.gameState.mapData,
        bgIndex: this.gameState.bgIndex ?? 0,
      },
    });
  }

  endRound() {
    this.gameState.stage = GameStage.RESULTS;

    // Deposit round coins into wallet for each player
    for (const [playerId, score] of this.gameState.scores) {
      if (score.wallet === undefined) score.wallet = 0;
      score.wallet += score.roundCoins || 0;
      score.roundCoins = 0;
      score.rainbowCoins = 0;
    }

    // Track stuck state
    const anyoneFinished = Array.from(this.gameState.players.values()).some(p => p.finished);
    if (!anyoneFinished) {
      this.gameState.noFinishRounds = (this.gameState.noFinishRounds || 0) + 1;
    } else {
      this.gameState.noFinishRounds = 0;
    }

    // Check map advance
    const shouldAdvance = this.checkMapAdvance();
    if (shouldAdvance) {
      this.advanceMap();
    }

    // NOTE: ROUND_ENDED and ROUND_RESULTS are sent by the Host client
    // and relayed via handleMessage. The server only manages state
    // and triggers the next phase.

    // The active network flow waits for RESULTS_DONE from every player before
    // starting the shop. Keep this legacy path from auto-skipping results.
  }

  calculateTitles(rankings) {
    const titles = {};

    // MVP - highest total points
    let mvpId = null, mvpPts = -1;
    for (const r of rankings) {
      if (r.totalPoints > mvpPts) { mvpPts = r.totalPoints; mvpId = r.id; }
    }
    if (mvpId) titles[mvpId] = 'MVP';

    // 天选倒霉蛋 - most deaths
    let maxDeaths = 0, unluckyId = null;
    for (const r of rankings) {
      if (r.deaths > maxDeaths) { maxDeaths = r.deaths; unluckyId = r.id; }
    }
    if (unluckyId && maxDeaths >= 3) titles[unluckyId] = '天选倒霉蛋';

    // 人类奇迹 - only finisher
    const finishers = rankings.filter(r => r.finished);
    if (finishers.length === 1) {
      titles[finishers[0].id] = '人类奇迹';
    }

    // 金币大盗 - most coins
    let maxCoins = 0, coinThiefId = null;
    for (const r of rankings) {
      if (r.coins > maxCoins) { maxCoins = r.coins; coinThiefId = r.id; }
    }
    if (coinThiefId && maxCoins >= 5) titles[coinThiefId] = '金币大盗';

    // 生存大师 - fewest deaths among finishers
    if (finishers.length > 0) {
      let minD = Infinity, survivorId = null;
      for (const r of finishers) {
        if (r.deaths < minD) { minD = r.deaths; survivorId = r.id; }
      }
      if (survivorId !== null && minD === 0) titles[survivorId] = '生存大师';
    }

    return titles;
  }

  startShopPhase() {
    if (this.shopPhaseTimer) {
      clearTimeout(this.shopPhaseTimer);
      this.shopPhaseTimer = null;
    }

    this.gameState.stage = GameStage.SHOP;
    this.gameState.shopDonePlayers = new Set();
    this.gameState.resultsDonePlayers = new Set();

    // Check stuck state (2+ rounds with no finishers)
    const isStuck = (this.gameState.noFinishRounds || 0) >= 2;

    // Generate shop items (same for all players)
    let shopItems = this.generateShopItems();
    if (isStuck) {
      shopItems = [
        'ERASER',
        ...shopItems.filter((type) => type !== 'ERASER').slice(0, 7),
      ];
      this.gameState.shopItems = shopItems;
    }

    console.log('[GameRoom] Starting SHOP phase, items:', shopItems.length);

    this.broadcast({
      type: 'SHOP_PHASE_START',
      data: {
        shopItems,
        isStuck,
        round: this.gameState.round,
        mapKey: this.gameState.mapKey,
        mapData: this.gameState.mapData,
        bgIndex: this.gameState.bgIndex ?? 0,
        scores: Object.fromEntries(this.gameState.scores),
        obstacles: this.gameState.obstacles,
      },
    });
  }

  startRunPhase() {
    this.gameState.stage = GameStage.RUN;
    this.gameState.round += 1;
    this.gameState.timeLeft = CONFIG.TIME_LIMIT;
    this.gameState.paused = false;
    this.gameState.pausedById = null;
    this.gameState.pausedByName = null;

    // Reset players for run
    const spawnX = this.gameState.mapData?.startX ?? 100;
    const spawnY = this.gameState.mapData?.startY ?? 100;
    let spawnIndex = 0;
    for (const player of this.gameState.players.values()) {
      player.x = spawnX + spawnIndex * 16;
      player.y = spawnY;
      player.vx = 0;
      player.vy = 0;
      player.onGround = false;
      player.lifeState = PlayerState.ALIVE;
      player.finished = false;
      player.input = { left: false, right: false, jump: false };
      spawnIndex++;
    }

    // Generate coins for the round
    this.generateCoins();

    console.log('[GameRoom] Starting RUN phase, round:', this.gameState.round);

    this.broadcast({
      type: 'STAGE_CHANGE',
      data: {
        stage: GameStage.RUN,
        timeLeft: CONFIG.TIME_LIMIT,
        round: this.gameState.round,
        players: this.getPlayersArray(),
        mapKey: this.gameState.mapKey,
        mapData: this.gameState.mapData,
        bgIndex: this.gameState.bgIndex ?? 0,
        obstacles: this.gameState.obstacles,
        coins: this.gameState.coins,
        paused: false,
      },
    });
  }

  // ===== Player Input =====

  handleGameStateBroadcast(hostId, gameState) {
    // Forward game state from host to all other clients
    const message = {
      type: 'GAME_STATE',
      data: gameState,
    };

    for (const [playerId, session] of this.sessions) {
      if (playerId === hostId) continue; // Don't send back to host
      try {
        session.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[GameRoom] Error sending game state to', playerId, error);
      }
    }
  }

  relayToClients(senderId, type, data) {
    const message = JSON.stringify({ type, data });
    for (const [playerId, session] of this.sessions) {
      if (playerId === senderId) continue;
      try {
        session.ws.send(message);
      } catch (error) {
        console.error('[GameRoom] Relay error for', playerId, error);
      }
    }
  }

  handlePlayerInput(playerId, data) {
    // Forward input to host
    const hostId = this.gameState.hostId;
    if (!hostId || hostId === playerId) return; // Don't forward host's own input

    const hostSession = this.sessions.get(hostId);
    if (hostSession) {
      try {
        hostSession.ws.send(JSON.stringify({
          type: 'PLAYER_INPUT',
          data: {
            playerId: playerId,
            input: data.input,
          },
        }));
      } catch (error) {
        console.error('[GameRoom] Error forwarding input to host:', error);
      }
    }
  }

  // ===== Obstacles =====

  handlePlaceObstacle(playerId, data) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    if (this.gameState.stage !== GameStage.BUILD) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'INVALID_STAGE', message: 'Not in build phase' },
      });
      return;
    }

    const pairId = typeof data.pairId === 'string' ? data.pairId : null;
    const isTeleporter = data.type === 'TELEPORTER';
    const isTeleporterSecond =
      isTeleporter &&
      pairId &&
      player.pendingTeleporterPair === pairId;

    const count = player.inventory?.[data.type] || 0;
    if (!isTeleporterSecond && count <= 0) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NO_INVENTORY', message: 'No item left to place' },
      });
      return;
    }

    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'INVALID_POSITION', message: 'Invalid obstacle position' },
      });
      return;
    }

    const occupied = this.gameState.obstacles.some(obs => obs.x === x && obs.y === y);
    if (occupied) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'POSITION_OCCUPIED', message: 'Position already occupied' },
      });
      return;
    }

    if (!isTeleporterSecond) {
      player.inventory[data.type] = count - 1;
    }

    const obstacle = {
      id: `obs_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: data.type,
      x,
      y,
      unit: 'tile',
      direction: data.direction || 'right',
      pairId,
      placedBy: playerId,
      state: 'active',
      timer: 0,
      inventory: player.inventory,
    };

    this.gameState.obstacles.push(obstacle);

    if (isTeleporter && pairId) {
      player.pendingTeleporterPair = isTeleporterSecond ? null : pairId;
    }

    this.broadcast({
      type: 'OBSTACLE_PLACED',
      data: obstacle,
    });
  }

  handleUndoObstacle(playerId, data) {
    const player = this.gameState.players.get(playerId);
    if (!player || this.gameState.stage !== GameStage.BUILD) return;

    const id = data?.id;
    const index = this.gameState.obstacles.findIndex((obs) => obs.id === id);
    if (index < 0) return;

    const obstacle = this.gameState.obstacles[index];
    if (obstacle.placedBy !== playerId) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_OWNER', message: 'Can only undo your own placement' },
      });
      return;
    }

    this.gameState.obstacles.splice(index, 1);

    let shouldRefund = true;
    if (obstacle.type === 'TELEPORTER' && obstacle.pairId) {
      const remainingPair = this.gameState.obstacles.filter(
        (obs) =>
          obs.type === 'TELEPORTER' &&
          obs.pairId === obstacle.pairId &&
          obs.placedBy === playerId,
      );
      if (remainingPair.length > 0) {
        player.pendingTeleporterPair = obstacle.pairId;
        shouldRefund = false;
      } else if (player.pendingTeleporterPair === obstacle.pairId) {
        player.pendingTeleporterPair = null;
      }
    }

    if (shouldRefund) {
      player.inventory = player.inventory || {};
      player.inventory[obstacle.type] = (player.inventory[obstacle.type] || 0) + 1;
    }

    this.broadcast({
      type: 'OBSTACLE_REMOVED',
      data: {
        id: obstacle.id,
        type: obstacle.type,
        pairId: obstacle.pairId,
        placedBy: playerId,
        inventory: player.inventory,
        pendingPairId: player.pendingTeleporterPair || null,
      },
    });
  }

  handleBuyObstacle(playerId, data) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    const score = this.gameState.scores.get(playerId);
    const price = this.getObstaclePrice(data.type);

    if (score.coins < price) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_ENOUGH_COINS', message: 'Not enough coins' },
      });
      return;
    }

    score.coins -= price;
    player.inventory = player.inventory || {};
    player.inventory[data.type] = (player.inventory[data.type] || 0) + 1;

    this.sendToPlayer(playerId, {
      type: 'OBSTACLE_BOUGHT',
      data: { type: data.type, inventory: player.inventory },
    });
  }

  handleUseEraser(playerId, data) {
    const radius = 3 * CONFIG.TILE;
    const centerX = data.x * CONFIG.TILE + CONFIG.TILE / 2;
    const centerY = data.y * CONFIG.TILE + CONFIG.TILE / 2;

    this.gameState.obstacles = this.gameState.obstacles.filter((obs) => {
      const obsX = obs.x * CONFIG.TILE + CONFIG.TILE / 2;
      const obsY = obs.y * CONFIG.TILE + CONFIG.TILE / 2;
      const dist = Math.sqrt((obsX - centerX) ** 2 + (obsY - centerY) ** 2);
      return dist > radius;
    });

    this.broadcast({
      type: 'OBSTACLES_ERASED',
      data: { x: data.x, y: data.y },
    });
  }

  // ===== Simultaneous Shop Phase =====

  handleShopPurchase(playerId, data) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    const score = this.gameState.scores.get(playerId);
    if (!score) return;

    const price = this.getObstaclePrice(data.type);
    if (data.type === 'ERASER' && (player.inventory?.ERASER || 0) >= 1) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'LIMIT_REACHED', message: 'Only one eraser per player' },
      });
      return;
    }

    if (score.wallet < price) {
      this.sendToPlayer(playerId, {
        type: 'ERROR',
        data: { code: 'NOT_ENOUGH_COINS', message: 'Not enough coins' },
      });
      return;
    }

    // Deduct from wallet and add to inventory
    score.wallet -= price;
    player.inventory = player.inventory || {};
    player.inventory[data.type] = (player.inventory[data.type] || 0) + 1;

    // Confirm purchase to every client so the host keeps authoritative wallets in sync.
    this.broadcast({
      type: 'SHOP_SYNC',
      data: {
        playerId,
        type: data.type,
        wallet: score.wallet,
        inventory: player.inventory,
      },
    });
  }

  handleShopDone(playerId) {
    this.gameState.shopDonePlayers.add(playerId);
    console.log('[GameRoom] Player done shopping:', playerId, 'Done:', this.gameState.shopDonePlayers.size, '/', this.gameState.players.size);

    // Notify all players
    this.broadcast({
      type: 'SHOP_SYNC',
      data: {
        playerId,
        done: true,
        doneCount: this.gameState.shopDonePlayers.size,
        totalPlayers: this.gameState.players.size,
      },
    });

    // Check if all players are done
    if (this.gameState.shopDonePlayers.size >= this.gameState.players.size) {
      this.startBuildPhase();
    }
  }

  startBuildPhase() {
    this.gameState.stage = GameStage.BUILD;
    this.gameState.buildDonePlayers = new Set();
    for (const player of this.gameState.players.values()) {
      player.pendingTeleporterPair = null;
    }

    console.log('[GameRoom] All players done shopping, starting BUILD phase');

    // Send inventory sync so each player knows their items
    const inventories = {};
    for (const [pid, player] of this.gameState.players) {
      inventories[pid] = player.inventory || {};
    }

    this.broadcast({
      type: 'BUILD_PHASE_START',
      data: {
        round: this.gameState.round,
        mapKey: this.gameState.mapKey,
        bgIndex: this.gameState.bgIndex ?? 0,
        inventories,
        obstacles: this.gameState.obstacles,
      },
    });
  }

  handleBuildDone(playerId) {
    this.gameState.buildDonePlayers.add(playerId);
    console.log('[GameRoom] Player done building:', playerId, 'Done:', this.gameState.buildDonePlayers.size, '/', this.gameState.players.size);

    // Notify all players
    this.broadcast({
      type: 'BUILD_SYNC',
      data: {
        playerId,
        done: true,
        doneCount: this.gameState.buildDonePlayers.size,
        totalPlayers: this.gameState.players.size,
      },
    });

    // Check if all players are done
    if (this.gameState.buildDonePlayers.size >= this.gameState.players.size) {
      this.startRunPhase();
    }
  }

  generateShopItems() {
    const allTypes = [
      'PLATFORM', 'MOVING_PLATFORM', 'FALLING_PLATFORM', 'ICE_PLATFORM',
      'BOUNCE_PAD', 'SPIKE', 'CANNON', 'SAW', 'FLAME', 'SPIKED_BALL',
      'WIND_ZONE', 'TELEPORTER', 'BOMB', 'SHADOW', 'SLIME',
      'BLACK_HOLE', 'MUSHROOM_TELEPORTER', 'ARROW', 'LASER',
    ];

    // Shuffle using a simple seed based on round number
    const shuffled = [...allTypes];
    let seed = this.gameState.round * 7919; // deterministic seed
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 16807 + 12345) % 2147483647;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    this.gameState.shopItems = shuffled.slice(0, 8);
    return this.gameState.shopItems;
  }

  checkMapAdvance() {
    for (const score of this.gameState.scores.values()) {
      if (score.points >= 100) {
        return true;
      }
    }
    return false;
  }

  advanceMap(data = {}) {
    this.gameState.mapKey = data?.mapKey || this.gameState.mapKey || 'map1';
    this.gameState.mapData = data?.mapData || this.gameState.mapData || null;
    this.gameState.bgIndex = data?.bgIndex ?? ((this.gameState.bgIndex ?? 0) + 1);
    this.gameState.obstacles = [];
    this.gameState.coins = [];
    this.gameState.noFinishRounds = 0;

    for (const score of this.gameState.scores.values()) {
      score.points = 0;
      score.coins = 0;
      score.roundCoins = 0;
      score.wallet = 0;
      score.kills = 0;
      score.deaths = 0;
      score.finished = false;
      score.finishTime = null;
    }

    for (const player of this.gameState.players.values()) {
      player.finished = false;
      player.deaths = 0;
      player.pendingTeleporterPair = null;
    }

    this.broadcast({
      type: 'MAP_CHANGED',
      data: {
        mapKey: this.gameState.mapKey,
        bgIndex: this.gameState.bgIndex,
        mapData: this.gameState.mapData,
        obstacles: this.gameState.obstacles,
        coins: this.gameState.coins,
        scores: Object.fromEntries(this.gameState.scores),
      },
    });
  }

  // ===== Coins =====

  generateCoins() {
    this.gameState.coins = [];
    const coinCount = 20;
    const groundY = CONFIG.GAME_HEIGHT - 100;

    // Deterministic rainbow index based on round number
    const rainbowIndex = this.gameState.round % coinCount;

    for (let i = 0; i < coinCount; i++) {
      this.gameState.coins.push({
        id: `coin_${i}`,
        x: 150 + Math.random() * (CONFIG.GAME_WIDTH - 300),
        y: 100 + Math.random() * (groundY - 200),
        collected: false,
        isRainbow: i === rainbowIndex,
        radius: 12,
      });
    }

    console.log('[GameRoom] Generated', coinCount, 'coins');
  }

  // ===== Helpers =====

  createPlayer(id, name, character) {
    return {
      id,
      name: name || `Player ${this.gameState.players.size + 1}`,
      character: character || 'chicken',
      x: 100,
      y: 100,
      w: 28,
      h: 34,
      vx: 0,
      vy: 0,
      onGround: false,
      lifeState: PlayerState.ALIVE,
      movementState: 'IDLE',
      facingRight: true,
      ready: false,
      finished: false,
      deaths: 0,
      inventory: {},
      pendingTeleporterPair: null,
      input: { left: false, right: false, jump: false },
    };
  }

  createScore() {
    return {
      points: 0,
      coins: 0,
      roundCoins: 0,
      rainbowCoins: 0,
      wallet: 0,
      kills: 0,
      deaths: 0,
    };
  }

  getPlayersArray() {
    return Array.from(this.gameState.players.values());
  }

  getObstaclePrice(type) {
    // Must match GameConfig.SHOP_PRICES on the client
    const prices = {
      PLATFORM: 3,
      SPIKE: 5,
      SAW: 7,
      CANNON: 8,
      ARROW: 7,
      MOVING_PLATFORM: 6,
      FALLING_PLATFORM: 5,
      ICE_PLATFORM: 4,
      BOUNCE_PAD: 5,
      FLAME: 6,
      SPIKED_BALL: 7,
      WIND_ZONE: 6,
      TELEPORTER: 10,
      BOMB: 8,
      SHADOW: 9,
      SLIME: 5,
      BLACK_HOLE: 10,
      MUSHROOM_TELEPORTER: 8,
      LASER: 12,
      ERASER: 0,
    };
    return prices[type] ?? 5;
  }

  generateRoomId() {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ===== Networking =====

  sendToPlayer(playerId, message) {
    const session = this.sessions.get(playerId);
    if (session && session.ws) {
      try {
        session.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Send error:', error);
      }
    }
  }

  broadcast(message, excludePlayerId) {
    const data = JSON.stringify(message);
    for (const [playerId, session] of this.sessions) {
      if (playerId === excludePlayerId) continue;
      try {
        session.ws.send(data);
      } catch (error) {
        console.error('[GameRoom] Broadcast error for player:', playerId, error);
      }
    }
  }

  handleDisconnect(playerId) {
    const player = this.gameState.players.get(playerId);
    this.sessions.delete(playerId);
    this.gameState.players.delete(playerId);
    this.gameState.scores.delete(playerId);

    this.broadcast({
      type: 'PLAYER_LEFT',
      data: { playerId, playerName: player?.name },
    });

    // If room is empty, cleanup
    if (this.sessions.size === 0) {
      this.cleanup();
    }

    // If host left, assign new host
    if (playerId === this.gameState.hostId && this.sessions.size > 0) {
      this.gameState.hostId = this.sessions.keys().next().value;
      this.broadcast({
        type: 'HOST_CHANGED',
        data: { newHostId: this.gameState.hostId },
      });
    }

    if (
      this.gameState.stage === GameStage.RESULTS &&
      this.gameState.players.size > 0 &&
      this.gameState.resultsDonePlayers.size >= this.gameState.players.size
    ) {
      this.startShopPhase();
    }
  }

  cleanup() {
    if (this.shopPhaseTimer) {
      clearTimeout(this.shopPhaseTimer);
      this.shopPhaseTimer = null;
    }
    this.gameState = this.createInitialState();
  }
}
