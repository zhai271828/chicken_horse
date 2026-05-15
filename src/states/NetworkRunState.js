/**
 * NetworkRunState - Multiplayer run state that uses existing RunState logic
 *
 * Host runs the full game logic, other players sync state.
 */

import { State } from './State.js';
import { GameConfig } from '../config/GameConfig.js';
import { GameStage } from '../config/GameStage.js';
import { PlayerState } from '../network/MessageTypes.js';
import { PlayerMovementState } from '../config/PlayerMovementState.js';
import { Player } from '../entities/Player.js';
import { Coin } from '../entities/Coin.js';
import { DrawPlayer } from '../utils/DrawPlayer.js';
import { AnimationConfigChick } from '../config/AnimationConfigChick.js';
import { AnimationConfigBunny } from '../config/AnimationConfigBunny.js';
import { AnimationConfigDuck } from '../config/AnimationConfigDuck.js';
import { AnimationConfigPolar } from '../config/AnimationConfigPolar.js';
import { RunState } from './RunState.js';
import { runFixedSteps } from '../sim/core/fixedStep.js';
import {
  createObstacleFromNetwork,
  hydrateNetworkObstacles,
  linkNetworkTeleporters,
} from '../network/NetworkObstacleFactory.js';

function isRuntimeObstacle(obstacle) {
  return obstacle && typeof obstacle.update === 'function';
}

function networkIdForPlayerNo(ctx, playerNo) {
  return ctx.networkPlayers?.[playerNo]?.id ?? playerNo;
}

function obstacleCoordForNetwork(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function serializeObstacleVisualState(obs) {
  return {
    angle: obs._angle,
    age: obs._age,
    swingAngle: obs._swingAngle,
    timer: obs._timer,
    active: obs._active,
    fireTimer: obs._fireTimer,
    frameIndex: obs.frameIndex,
  };
}

function serializeObstacleForNetwork(ctx, obs) {
  const placedBy = obs._networkPlacedBy ?? (
    typeof obs._placedBy === 'number'
      ? networkIdForPlayerNo(ctx, obs._placedBy)
      : obs._placedBy
  ) ?? obs.placedBy ?? null;

  return {
    type: obs.type || obs.constructor?.name,
    x: obstacleCoordForNetwork(obs.x),
    y: obstacleCoordForNetwork(obs.y),
    unit: isRuntimeObstacle(obs) ? 'pixel' : (obs.unit || 'tile'),
    w: obs.w,
    h: obs.h,
    direction: obs.direction,
    pairId: obs._networkPairId || obs.pairId,
    placedBy,
    id: obs._id || obs.id || obs._obstacleId,
    visualState: serializeObstacleVisualState(obs),
  };
}

function scoresFromRankings(rankings = []) {
  return Object.fromEntries(
    rankings
      .filter((ranking) => ranking?.id)
      .map((ranking) => [
        ranking.id,
        {
          points: ranking.totalPoints ?? 0,
          coins: ranking.coins ?? 0,
          roundPoints: ranking.roundPoints ?? 0,
          wallet: ranking.wallet ?? 0,
          kills: ranking.kills ?? 0,
          deaths: ranking.deaths ?? 0,
          rainbowCoins: ranking.rainbowCoins ?? 0,
          finished: Boolean(ranking.finished),
          finishTime: ranking.finishTime ?? null,
        },
      ]),
  );
}

function networkObstacleKey(obstacle, index) {
  return obstacle?.id || obstacle?._id || `${obstacle?.type || 'obstacle'}_${index}`;
}

function networkCoordToWorld(value, unit) {
  const n = Number(value) || 0;
  return unit === 'pixel' ? n : n * GameConfig.TILE;
}

function applyNetworkMapSelection(ctx, data) {
  if (!data?.mapKey) return;

  const bgIndex = data.bgIndex ?? ctx.networkBgIndex;
  const needsMap = ctx.mapKey !== data.mapKey;
  const needsBg = bgIndex !== undefined && ctx.networkBgIndex !== bgIndex;
  const hasMapData = Boolean(data.mapData);

  ctx.networkMapKey = data.mapKey;
  ctx.networkBgIndex = bgIndex;
  if (hasMapData) ctx.networkMapData = data.mapData;

  if (!needsMap && !needsBg && !hasMapData) return;

  const networkPlayers = ctx.networkPlayers;
  const networkInventories = ctx.networkInventories;
  const networkObstacleData = ctx.networkObstacleData;
  const lastScores = ctx.lastScores;
  if (hasMapData) {
    ctx.mapManager?.applyNetworkMapData?.(data.mapData, ctx, bgIndex);
  } else {
    ctx.mapManager?.selectMapWithBg?.(data.mapKey, ctx, bgIndex);
  }
  ctx.networkPlayers = networkPlayers;
  ctx.networkInventories = networkInventories;
  ctx.networkObstacleData = networkObstacleData;
  ctx.lastScores = lastScores;
}

export class NetworkRunState extends State {
  constructor(ctx, goTo, networkManager) {
    super(ctx, goTo);
    this.networkManager = networkManager;
    this.isHost = false;
    this.runState = null;
    this.serverState = null;
    this.localPlayerId = null;
    this.playerInstances = new Map();
    this._gameLoopInterval = null;
    this._lastTick = 0;
    this._roundEnding = false;
    // Interpolation state for smooth remote player rendering
    this._prevPlayerPositions = new Map(); // id -> {x, y, time}
    this._lastGameStateTime = 0;
    this._gameStateInterval = 33; // expected ms between GAME_STATE updates (~30fps)
    this._obstacleBroadcastInterval = 100;
    this._lastObstacleBroadcast = 0;
    this.renderObstacleInstances = [];
    this._renderObstacleCache = new Map();
    this._renderCoinInstances = [];
    this.pauseManager = null;
    this.networkPaused = false;
    this.pausedById = null;
    this.pausedByName = null;
    this._activePauseSlider = null;
    this._lastLocalInput = null;
    this._lastLocalInputAt = 0;
    this._playerLifeStates = new Map();
    this._lastObstacleBroadcast = 0;
    this._displayTimeLeft = null;
    this._tickAccumulator = 0;
    this._fixedTickMs = 1000 / 60;
    this._maxCatchUpMs = 1000;
  }

  enter() {
    this.localPlayerId = this.networkManager.getPlayerId();
    this.isHost = this.ctx.isNetworkHost || false;
    this.serverState = null;
    this.playerInstances = new Map();
    this.remoteInputs = new Map();
    this._roundEnding = false;
    this.renderObstacleInstances = [];
    this._renderObstacleCache = new Map();
    this._renderCoinInstances = [];
    this.pauseManager = null;
    this.networkPaused = false;
    this.pausedById = null;
    this.pausedByName = null;
    this._activePauseSlider = null;
    this._lastLocalInput = null;
    this._lastLocalInputAt = 0;
    this._playerLifeStates = new Map();
    this._displayTimeLeft = null;
    this._tickAccumulator = 0;
    this.ctx.isNetworkRunActive = true;

    console.log('[NetworkRun] Entering, isHost:', this.isHost, 'playerId:', this.localPlayerId);

    if (this.isHost) {
      this.setupAsHost();
    } else {
      this.setupAsClient();
    }

    // Register network handlers (save bound references for proper cleanup)
    this._onGameState = this.onGameState.bind(this);
    this._onRemoteInput = this.onRemoteInput.bind(this);
    this._onPlayerDeath = this.onPlayerDeath.bind(this);
    this._onPlayerRespawn = this.onPlayerRespawn.bind(this);
    this._onPlayerFinish = this.onPlayerFinish.bind(this);
    this._onCoinCollected = this.onCoinCollected.bind(this);
    this._onRoundEnded = this.onRoundEnded.bind(this);
    this._onRoundResults = this.onRoundResults.bind(this);
    this._onStageChange = this.onStageChange.bind(this);
    this._onMapChanged = this.onMapChanged.bind(this);
    this._onGamePauseChanged = this.onGamePauseChanged.bind(this);

    this.networkManager.on('GAME_STATE', this._onGameState);
    this.networkManager.on('PLAYER_INPUT', this._onRemoteInput);
    this.networkManager.on('PLAYER_DEATH', this._onPlayerDeath);
    this.networkManager.on('PLAYER_RESPAWN', this._onPlayerRespawn);
    this.networkManager.on('PLAYER_FINISH', this._onPlayerFinish);
    this.networkManager.on('COIN_COLLECTED', this._onCoinCollected);
    this.networkManager.on('ROUND_ENDED', this._onRoundEnded);
    this.networkManager.on('ROUND_RESULTS', this._onRoundResults);
    this.networkManager.on('STAGE_CHANGE', this._onStageChange);
    this.networkManager.on('MAP_CHANGED', this._onMapChanged);
    this.networkManager.on('GAME_PAUSE_CHANGED', this._onGamePauseChanged);

    const pendingMap = this.networkManager.consumeLast?.('MAP_CHANGED');
    if (pendingMap) {
      this.onMapChanged(pendingMap);
    }

    this.ctx.audioManager?.playMusic();
  }

  setupAsHost() {
    const { p, sprites } = this.ctx;
    const networkPlayers = this.ctx.networkPlayers || [];

    const animConfigs = {
      chicken: AnimationConfigChick,
      bunny: AnimationConfigBunny,
      duck: AnimationConfigDuck,
      polar: AnimationConfigPolar,
    };

    networkPlayers.forEach((playerInfo, index) => {
      const character = playerInfo.character || 'chicken';
      const spriteSheet = sprites[character];
      const animConfig = animConfigs[character] || AnimationConfigChick;
      const spawnX = this.ctx.tiledMap?.startX ?? 100;
      const spawnY = this.ctx.tiledMap?.startY ?? 100;

      const player = new Player(
        p,
        spawnX + index * 16,
        spawnY,
        index,
        spriteSheet,
        animConfig
      );

      player.nickname = playerInfo.name;
      player.character = character;
      player.networkId = playerInfo.id;
      player.isRemote = playerInfo.id !== this.localPlayerId;

      this.playerInstances.set(playerInfo.id, player);
      this.ctx.players[index] = player;
    });

    this.ctx.playerCount = networkPlayers.length;
    this.ctx.players.length = networkPlayers.length;
    this.ctx.placedObstacles = hydrateNetworkObstacles(
      this.ctx,
      this.ctx.networkObstacleData || this.ctx.placedObstacles || [],
    );

    // Intercept goTo so RunState doesn't transition to RESULTS —
    // we handle round-end ourselves so the game loop keeps running.
    const self = this;
    const originalGoTo = this.goTo;
    const interceptedGoTo = (stage) => {
      if (stage === GameStage.RESULTS) {
        self.handleRoundEnd();
        return;
      }
      originalGoTo(stage);
    };

    this.runState = new RunState(this.ctx, interceptedGoTo);
    this.runState.enter();

    // Use setInterval so the game loop keeps running even when the
    // browser tab is in the background.
    this._lastTick = Date.now();
    this._lastBroadcast = 0;
    this._tickAccumulator = 0;
    this._broadcastInterval = this._gameStateInterval; // 20fps snapshots keep clients responsive without queuing
    this._gameLoopInterval = setInterval(() => {
      if (!this.runState || self._roundEnding) return;
      try {
        const now = Date.now();
        const elapsed = Math.max(0, now - this._lastTick);
        this._lastTick = now;
        if (this.networkPaused) {
          this._tickAccumulator = 0;
          if (now - this._lastBroadcast >= this._broadcastInterval) {
            this._lastBroadcast = now;
            this.broadcastGameState();
          }
          return;
        }

        // Guard: if game is over, trigger round end and stop
        if (this.runState.timeManager?.isGameOver) {
          self.handleRoundEnd();
          return;
        }

        const result = runFixedSteps(
          {
            accumulator: this._tickAccumulator,
            elapsedMs: elapsed,
            fixedStepMs: this._fixedTickMs,
            maxCatchUpMs: this._maxCatchUpMs,
          },
          () => {
          this.applyRemoteInputs();
          this.runState.update(this._fixedTickMs);

          if (this.runState.timeManager?.isGameOver) {
            self.handleRoundEnd();
            throw new Error('__ROUND_ENDED__');
          }
          },
        );
        this._tickAccumulator = result.accumulator;

        // Throttle broadcast to avoid flooding the WebSocket
        if (now - this._lastBroadcast >= this._broadcastInterval) {
          this._lastBroadcast = now;
          this.broadcastGameState();
        }
      } catch (e) {
        if (e?.message === '__ROUND_ENDED__') {
          return;
        }
        console.error('[NetworkRun] Game loop error:', e);
        // If game is already over, end the round cleanly
        if (this.runState?.timeManager?.isGameOver) {
          self.handleRoundEnd();
        }
      }
    }, 16);

    console.log('[NetworkRun] Host setup complete, players:', networkPlayers.length);
  }

  async handleRoundEnd() {
    if (this._roundEnding) return;
    this._roundEnding = true;

    console.log('[NetworkRun] handleRoundEnd called! Broadcasting...');

    // Stop the game loop
    if (this._gameLoopInterval) {
      clearInterval(this._gameLoopInterval);
      this._gameLoopInterval = null;
    }

    // Broadcast round end to clients
    this.networkManager.send('ROUND_ENDED', {
      scores: {},
      players: this.ctx.players.map(p => ({
        id: p.networkId || p.playerNo,
        name: p.nickname,
      })),
    });

    // Broadcast detailed results (rankings, titles)
    const scoreManager = this.ctx.scoreManager;
    const rankings = this.ctx.players.map(p => ({
      id: p.networkId || p.playerNo,
      name: p.nickname,
      character: p.character,
      finished: scoreManager?.getScore(p)?.finished ?? false,
      finishTime: scoreManager?.getScore(p)?.finishTime ?? null,
      deaths: scoreManager?.getScore(p)?.deaths ?? 0,
      coins: scoreManager?.getScore(p)?.coins ?? 0,
      kills: scoreManager?.getScore(p)?.kills ?? 0,
      roundPoints: scoreManager?.getRoundPoints(p.playerNo) ?? 0,
      totalPoints: scoreManager?.getPoints(p.playerNo) ?? 0,
      wallet: scoreManager?.getWallet(p) ?? 0,
      rainbowCoins: scoreManager?.getRainbowCoins?.(p) ?? scoreManager?.getScore(p)?.specialCoins ?? 0,
    }));
    scoreManager?.recordRoundTitleProgress?.(this.ctx.players || []);
    const shouldAdvance = scoreManager?.shouldAdvanceMap() ?? false;
    const titles = shouldAdvance ? this.buildMapAdvanceTitles(rankings) : {};
    let mapData = this.ctx.networkMapData || null;
    let bgIndex = this.ctx.networkBgIndex ?? this.ctx.mapManager?._lastBgIndex ?? 0;

    if (shouldAdvance) {
      scoreManager?.advanceMap(this.ctx);
      this.resetNetworkScoresForAdvancedMap();
      await this.ctx.mapManager?.generateRandomMap?.(this.ctx.mapKey, this.ctx);
      mapData = this.ctx.networkMapData || mapData;
      bgIndex = this.ctx.mapManager?._lastBgIndex ?? bgIndex;
      this.ctx.networkBgIndex = bgIndex;
      this.ctx.networkObstacleData = [];
      this.renderObstacleInstances = [];
      this._renderObstacleCache = new Map();
    }

    const results = {
      rankings,
      titles,
      shouldAdvance,
      round: scoreManager?.currentRound ?? 1,
      mapKey: this.ctx.mapKey,
      bgIndex,
      mapData: shouldAdvance ? mapData : null,
    };
    this.ctx.pendingRoundResults = results;
    this.ctx.lastScores = scoresFromRankings(rankings);

    this.networkManager.send('ROUND_RESULTS', results);

    console.log('[NetworkRun] Sent ROUND_ENDED + ROUND_RESULTS');

    console.log('[NetworkRun] Transitioning to NETWORK_RESULTS...');
    this.networkManager.send('STAGE_CHANGE', { stage: GameStage.NETWORK_RESULTS });
    this.goTo(GameStage.NETWORK_RESULTS);
  }

  buildLegacyMapAdvanceTitles(rankings = []) {
    const pool = [
      '终点猎手', '金币大师', '彩虹侦探', '极速先锋',
      '机关克星', '不屈挑战者', '地图征服者', '冷静王者',
      '跳跃专家', '陷阱艺术家', '生存大师', '奇迹选手',
    ];
    const sorted = [...rankings].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
    const used = new Set();
    const result = {};

    for (const ranking of sorted) {
      const personal = [];
      const candidates = this.titleCandidatesForLegacy(ranking);
      for (const title of [...candidates, ...pool]) {
        if (used.has(title)) continue;
        used.add(title);
        personal.push(title);
        if (personal.length === 3) break;
      }
      result[ranking.id] = personal;
    }

    return result;
  }

  titleCandidatesForLegacy(ranking) {
    const candidates = [];
    if (ranking.finished) candidates.push('终点猎手');
    if ((ranking.coins || 0) >= 5) candidates.push('金币大师');
    if ((ranking.rainbowCoins || 0) > 0) candidates.push('彩虹侦探');
    if ((ranking.deaths || 0) === 0 && ranking.finished) candidates.push('生存大师');
    if ((ranking.kills || 0) > 0) candidates.push('机关克星');
    if ((ranking.roundPoints || 0) >= 10) candidates.push('极速先锋');
    if ((ranking.deaths || 0) >= 3) candidates.push('不屈挑战者');
    return candidates;
  }

  buildMapAdvanceTitles(rankings = []) {
    const scoreManager = this.ctx.scoreManager;
    const summary = scoreManager?.getMapAdvanceTitleSummary?.(this.ctx.players || []);
    const result = {};
    for (const ranking of rankings) {
      const player = this.ctx.players?.find(
        (item) => (item.networkId || item.playerNo) === ranking.id,
      );
      result[ranking.id] = player ? (summary?.get(player.playerNo) || []) : [];
    }
    return result;
  }

  resetNetworkScoresForAdvancedMap() {
    const scoreManager = this.ctx.scoreManager;
    if (!scoreManager) return;

    for (const player of this.ctx.players || []) {
      const playerNo = player.playerNo;
      scoreManager.points?.set(playerNo, 0);
      scoreManager.totalPoints?.set(playerNo, 0);
      scoreManager.roundPoints?.set(playerNo, 0);
      scoreManager.roundCoins?.set(playerNo, 0);
      scoreManager.rainbowCoins?.set(playerNo, 0);
      scoreManager.wallet?.set(playerNo, 0);

      const score = scoreManager.getScore?.(player);
      if (score) {
        score.coins = 0;
        score.wallet = 0;
        score.kills = 0;
        score.deaths = 0;
        score.finished = false;
        score.finishTime = null;
      }
    }
  }

  setupAsClient() {
    const { p, sprites } = this.ctx;
    const networkPlayers = this.ctx.networkPlayers || [];

    const animConfigs = {
      chicken: AnimationConfigChick,
      bunny: AnimationConfigBunny,
      duck: AnimationConfigDuck,
      polar: AnimationConfigPolar,
    };

    networkPlayers.forEach((playerInfo, index) => {
      const character = playerInfo.character || 'chicken';
      const spriteSheet = sprites[character];
      const animConfig = animConfigs[character] || AnimationConfigChick;
      const spawnX = this.ctx.tiledMap?.startX ?? 100;
      const spawnY = this.ctx.tiledMap?.startY ?? 100;

      const player = new Player(
        p,
        spawnX + index * 16,
        spawnY,
        index,
        spriteSheet,
        animConfig
      );

      player.nickname = playerInfo.name;
      player.character = character;
      player.networkId = playerInfo.id;
      player.isRemote = playerInfo.id !== this.localPlayerId;

      this.playerInstances.set(playerInfo.id, player);
      this.ctx.players[index] = player;
    });

    this.ctx.playerCount = networkPlayers.length;
    this.ctx.players.length = networkPlayers.length;

    console.log('[NetworkRun] Client setup complete');
  }

  exit() {
    this.ctx.audioManager?.stopMusic();

    if (this._gameLoopInterval) {
      clearInterval(this._gameLoopInterval);
      this._gameLoopInterval = null;
    }

    if (this.runState) {
      this.runState.exit();
      this.runState = null;
    }

    this.networkManager.off('GAME_STATE', this._onGameState);
    this.networkManager.off('PLAYER_INPUT', this._onRemoteInput);
    this.networkManager.off('PLAYER_DEATH', this._onPlayerDeath);
    this.networkManager.off('PLAYER_RESPAWN', this._onPlayerRespawn);
    this.networkManager.off('PLAYER_FINISH', this._onPlayerFinish);
    this.networkManager.off('COIN_COLLECTED', this._onCoinCollected);
    this.networkManager.off('ROUND_ENDED', this._onRoundEnded);
    this.networkManager.off('ROUND_RESULTS', this._onRoundResults);
    this.networkManager.off('STAGE_CHANGE', this._onStageChange);
    this.networkManager.off('MAP_CHANGED', this._onMapChanged);
    this.networkManager.off('GAME_PAUSE_CHANGED', this._onGamePauseChanged);
    this.ctx.isNetworkRunActive = false;
    this.pauseManager = null;
    this.networkPaused = false;
    this.pausedById = null;
    this.pausedByName = null;
    this._activePauseSlider = null;
    this._renderCoinInstances = [];
    this._playerLifeStates.clear();
    this._displayTimeLeft = null;
    this._tickAccumulator = 0;
  }

  // ===== Network Event Handlers =====

  onGameState(data) {
    const receivedAt = Date.now();
    const previousObstacles = this.serverState?.obstacles || [];
    this.serverState = {
      ...data,
      obstacles: data.obstacles ?? previousObstacles,
      _receivedAt: receivedAt,
    };
    applyNetworkMapSelection(this.ctx, data);
    this.syncPauseState(data);
    this.syncLocalAudioTransitions(this.serverState.players);

    if (!this.isHost) {
      // Sync player positions
      if (data.players) {
        const now = Date.now();
        for (const serverPlayer of data.players) {
          const playerInstance = this.playerInstances.get(serverPlayer.id);
          if (playerInstance) {
            // Save previous position for interpolation
            this._prevPlayerPositions.set(serverPlayer.id, {
              x: playerInstance.x,
              y: playerInstance.y,
              time: this._lastGameStateTime,
            });
            playerInstance.x = serverPlayer.x ?? playerInstance.x;
            playerInstance.y = serverPlayer.y ?? playerInstance.y;
            playerInstance.vx = serverPlayer.vx ?? 0;
            playerInstance.vy = serverPlayer.vy ?? 0;
            playerInstance.lifeState = serverPlayer.lifeState || 'ALIVE';
            playerInstance.facingRight = serverPlayer.facingRight !== false;
            playerInstance.character = serverPlayer.character || playerInstance.character;
            playerInstance.movementState = this.getMovementStateForRender(serverPlayer);
          }
        }
        this._lastGameStateTime = now;
      }

      // Sync obstacles (moving platforms, cannon projectiles, etc.)
      if (data.obstacles) {
        this.ctx.networkObstacleData = data.obstacles;
        this.syncRenderObstacles(data.obstacles);
      }

      // Sync scores
      if (data.scores) {
        this.ctx.lastScores = data.scores;
      }
    }
  }

  onRemoteInput(data) {
    if (this.isHost && data.playerId && data.input) {
      this.remoteInputs.set(data.playerId, data.input);
    }
  }

  onPlayerDeath(data) {
    const { playerId, reason } = data;
    console.log(`Player ${playerId} died: ${reason}`);
    if (playerId === this.localPlayerId) {
      this.ctx.audioManager?.playSound('death');
    }
  }

  onPlayerRespawn(data) {
    console.log(`Player ${data.playerId} respawned`);
  }

  onPlayerFinish(data) {
    const { playerId, rank } = data;
    console.log(`Player ${playerId} finished rank ${rank}`);
    if (playerId === this.localPlayerId) {
      this.ctx.audioManager?.playSound('finish');
    }
  }

  onCoinCollected(data) {
    if (data.playerId === this.localPlayerId) {
      this.ctx.audioManager?.playSound('coin');
    }
  }

  onRainbowCollected(data) {
    void data;
  }

  onGamePauseChanged(data) {
    this.syncPauseState(data);
  }

  syncPauseState(data = {}) {
    if (data.paused === undefined) return;
    this.networkPaused = Boolean(data.paused);
    this.pausedById = data.pausedById || null;
    this.pausedByName = data.pausedByName || null;
  }

  onRoundEnded(data) {
    console.log('[NetworkRun] Round ended, waiting for new round...');
    // Stay in NetworkRunState — the host will send STAGE_CHANGE when ready
  }

  onRoundResults(data) {
    console.log('[NetworkRun] Received round results, storing for later...');
    // Store in ctx so NetworkResultsState can pick it up when it enters
    this.ctx.pendingRoundResults = data;
    this.ctx.lastScores = scoresFromRankings(data?.rankings || []);
  }

  onMapChanged(data) {
    console.log('[NetworkRun] Map changed:', data?.mapKey, data?.bgIndex);
    applyNetworkMapSelection(this.ctx, data);
    this.ctx.networkObstacleData = data?.obstacles || [];
    this.ctx.placedObstacles = [];
    this.renderObstacleInstances = [];
    this._renderObstacleCache = new Map();
    this._renderCoinInstances = [];
    if (data?.scores) {
      this.ctx.lastScores = data.scores;
    }
  }

  onStageChange(data) {
    if (data.stage === GameStage.RUN) {
      applyNetworkMapSelection(this.ctx, data);
      this.syncPauseState(data);
      // New round started — reset local state
      this._roundEnding = false;
      this.ctx.networkRound = data.round ?? this.ctx.networkRound;
      this.ctx.networkPlayers = data.players || this.ctx.networkPlayers;
      this.ctx.networkObstacleData = data.obstacles || [];
      this.ctx.placedObstacles = data.obstacles || [];
      this.renderObstacleInstances = [];
      this._renderObstacleCache = new Map();
      this._renderCoinInstances = [];
      this._playerLifeStates.clear();
      this._lastLocalInput = null;
      this._displayTimeLeft = null;
      console.log('[NetworkRun] New round started');
    } else if (data.stage === GameStage.NETWORK_RESULTS) {
      // Transition to network results phase
      console.log('[NetworkRun] Transitioning to NETWORK_RESULTS...');
      this.goTo(GameStage.NETWORK_RESULTS);
    } else if (data.stage === GameStage.NETWORK_SHOP) {
      // Transition to network shop phase
      console.log('[NetworkRun] Transitioning to NETWORK_SHOP...');
      this.goTo(GameStage.NETWORK_SHOP);
    }
  }

  // ===== Update =====

  update(deltaTime) {
    if (this.isHost) {
      // Game logic runs in setInterval (setupAsHost), not here.
      return;
    }

    if (this.networkPaused) {
      this.networkManager.sendInput({ left: false, right: false, jump: false });
      return;
    }

    this.updateClientVisualObstacles(deltaTime);

    // Client: always send input to host (including "no keys pressed")
    const input = this.getLocalInput();
    this._lastLocalInput = input;
    this._lastLocalInputAt = Date.now();
    this.networkManager.sendInput(input);
  }

  updateClientVisualObstacles(deltaTime) {
    if (!this.renderObstacleInstances.length) return;

    const { gameWidth, gameHeight, mapPixelWidth, mapPixelHeight, tiledMap } = this.ctx;
    for (const obs of this.renderObstacleInstances) {
      try {
        obs.update?.(
          deltaTime,
          mapPixelWidth ?? gameWidth,
          mapPixelHeight ?? gameHeight,
          tiledMap?.MAP,
          this.renderObstacleInstances,
          [],
        );
      } catch (_e) {
        // Render-only obstacles should never break the network client.
      }
    }
  }

  applyRemoteInputs() {
    for (const [playerId, input] of this.remoteInputs) {
      const playerInstance = this.playerInstances.get(playerId);
      if (playerInstance && playerInstance.isRemote) {
        playerInstance.input = input;
      }
    }
    this.remoteInputs.clear();
  }

  markCollectedCoin(coin, players = []) {
    if (!coin?.collected || !coin.isRainbow || coin._networkCollectedAt) return;

    let collector = null;
    let bestDistance = Infinity;
    const cx = coin.x + (coin.w || GameConfig.TILE * 0.5) / 2;
    const cy = coin.y + (coin.h || GameConfig.TILE * 0.5) / 2;

    for (const player of players) {
      const px = player.x + player.w / 2;
      const py = player.y + player.h / 2;
      const distance = (px - cx) ** 2 + (py - cy) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        collector = player;
      }
    }

    coin._networkCollectedAt = coin._networkCollectedAt || Date.now();
    coin._networkCollectedById = coin._networkCollectedById ?? collector?.networkId ?? collector?.playerNo ?? null;
    coin._networkCollectedByName = coin._networkCollectedByName || collector?.nickname || '玩家';
  }

  broadcastGameState() {
    const { players, placedObstacles, scoreManager } = this.ctx;
    const snapshotSentAt = Date.now();
    const includeObstacles =
      snapshotSentAt - this._lastObstacleBroadcast >= this._obstacleBroadcastInterval;
    if (includeObstacles) {
      this._lastObstacleBroadcast = snapshotSentAt;
    }

    // Coins live on the RunState instance, not on ctx
    const coins = this.runState?.coins || [];

    const playersData = players.map(p => ({
      id: p.networkId || p.playerNo,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      lifeState: p.lifeState,
      facingRight: p.facingRight,
      movementState: p.movementState,
      name: p.nickname,
      character: p.character,
      w: p.w,
      h: p.h,
    }));
    this.syncLocalAudioTransitions(playersData);

    const scoresData = {};
    if (scoreManager) {
      players.forEach(p => {
        const score = scoreManager.getScore(p);
        scoresData[p.networkId || p.playerNo] = {
          points: scoreManager.getPoints(p.playerNo),
          coins: scoreManager.getRoundCoins(p),
          wallet: scoreManager.getWallet(p),
          roundPoints: scoreManager.getRoundPoints(p.playerNo),
          kills: score?.kills ?? 0,
          deaths: score?.deaths ?? 0,
          rainbowCoins: scoreManager.getRainbowCoins?.(p) ?? score?.specialCoins ?? 0,
          finished: Boolean(score?.finished),
        };
      });
    }

    const obstaclesData = includeObstacles
      ? (placedObstacles || [])
        .map((obs) => serializeObstacleForNetwork(this.ctx, obs))
        .filter((obs) => obs.type)
      : undefined;

    const coinsData = coins.map(coin => {
      this.markCollectedCoin(coin, players);
      return {
        x: coin.x,
        y: coin.y,
        collected: coin.collected,
        isRainbow: coin.isRainbow,
        collectedAt: coin._networkCollectedAt || null,
        collectedAge: coin._networkCollectedAt ? Date.now() - coin._networkCollectedAt : null,
        collectedById: coin._networkCollectedById || null,
        collectedByName: coin._networkCollectedByName || null,
        radius: coin.radius || 12,
      };
    });

    this.networkManager.send('GAME_STATE', {
      players: playersData,
      scores: scoresData,
      obstacles: obstaclesData,
      coins: coinsData,
      timeLeft: this.runState?.timeManager?.timeLeft || 0,
      snapshotSentAt,
      round: this.ctx.scoreManager?.currentRound || 1,
      mapKey: this.ctx.mapKey,
      bgIndex: this.ctx.networkBgIndex ?? this.ctx.mapManager?._lastBgIndex ?? 0,
      paused: this.networkPaused,
      pausedById: this.pausedById,
      pausedByName: this.pausedByName,
    });
  }

  // ===== Render =====

  render(mx, my) {
    if (this.isHost && this.runState) {
      this.renderHost(mx, my);
    } else {
      this.renderClient(mx, my);
    }
  }

  renderHost(mx, my) {
    const { p, gameWidth, gameHeight, placedObstacles, tiledMap, players } = this.ctx;
    const worldView = this._worldView();

    p.background(25);
    p.push();
    p.translate(worldView.x, worldView.y);
    p.scale(worldView.scale);

    this.renderWorld();

    for (const obs of placedObstacles || []) {
      try {
        obs.draw();
      } catch (_e) {
        this.renderObstacleFallback(obs);
      }
    }

    for (const coin of this.runState.coins || []) {
      coin.draw();
    }

    for (const player of players || []) {
      DrawPlayer(player);
    }

    p.pop();

    if (!tiledMap) {
      p.fill(255);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(8);
      p.text('等待地图同步...', gameWidth / 2, gameHeight / 2);
    }

    this.renderNetworkHUD({
      timeLeft: this.runState?.timeManager?.timeLeft || 0,
      round: this.ctx.scoreManager?.currentRound || 1,
    });

    this.renderRainbowAnnouncements();
    this.renderScoreboardOverlayIfHeld();
  }

  renderClient(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    // Show waiting screen until first GAME_STATE arrives
    if (!this.serverState) {
      this.renderWaiting(gameWidth, gameHeight);
      return;
    }

    const worldView = this._worldView();

    p.background(25);

    p.push();
    p.translate(worldView.x, worldView.y);
    p.scale(worldView.scale);

    this.renderWorld();
    this.renderObstacles();
    this.renderCoins();
    this.renderPlayers();

    p.pop();

    this.renderNetworkHUD();
    this.renderRainbowAnnouncements();
    this.renderScoreboardOverlayIfHeld();
  }

  _worldView() {
    const viewportW = this.ctx.gameWidth;
    const viewportH = this.ctx.gameHeight;
    const worldW = this.ctx.mapPixelWidth || viewportW;
    const worldH = this.ctx.mapPixelHeight || viewportH;
    const scale = Math.min(viewportW / worldW, viewportH / worldH);
    return {
      scale,
      x: (viewportW - worldW * scale) / 2,
      y: (viewportH - worldH * scale) / 2,
    };
  }

  renderWaiting(gameWidth, gameHeight) {
    const { p } = this.ctx;

    p.background(25);
    p.fill(255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(8);
    p.text('等待游戏状态同步...', gameWidth / 2, gameHeight / 2 - 20);

    p.fill(150);
    p.textSize(5);
    p.text('请确保主机玩家已开始游戏', gameWidth / 2, gameHeight / 2 + 20);
  }

  renderWorld() {
    const { p, gameWidth, gameHeight, tiledMap, backgroundImage, mapPixelWidth, mapPixelHeight } = this.ctx;

    if (backgroundImage) {
      p.image(backgroundImage, 0, 0, mapPixelWidth || gameWidth, mapPixelHeight || gameHeight);
      p.noStroke();
      p.fill(8, 14, 24, 110);
      p.rect(0, 0, mapPixelWidth || gameWidth, mapPixelHeight || gameHeight);
    }

    if (tiledMap) {
      tiledMap.render();
      tiledMap.renderEndpoint(this.ctx.endpointFlag);
    }
  }

  renderObstacles() {
    const { p, shopIcons } = this.ctx;
    const obstacles = this.serverState?.obstacles || this.ctx.placedObstacles || [];

    if (!obstacles || obstacles.length === 0) return;

    if (this.renderObstacleInstances.length > 0) {
      for (const obs of this.renderObstacleInstances) {
        try {
          obs.draw();
        } catch (_e) {
          this.renderObstacleFallback(obs);
        }
      }
      return;
    }

    for (const obs of obstacles) {
      const unit = obs.unit || 'tile';
      const x = unit === 'pixel' ? obs.x : obs.x * GameConfig.TILE;
      const y = unit === 'pixel' ? obs.y : obs.y * GameConfig.TILE;
      const w = obs.w || GameConfig.TILE;
      const h = obs.h || GameConfig.TILE;

      // Try to render with sprite icon
      const img = shopIcons?.[obs.type];
      if (img) {
        p.image(img, x, y, w, h);
      } else {
        const color = this.getObstacleColor(obs.type);
        p.fill(...color);
        p.noStroke();
        p.rect(x, y, w, h, 4);
      }
    }
  }

  syncRenderObstacles(obstacles = []) {
    const nextCache = new Map();
    const nextInstances = [];

    obstacles.forEach((data, index) => {
      const key = networkObstacleKey(data, index);
      let obstacle = this._renderObstacleCache.get(key);

      if (!obstacle || obstacle.type !== data.type) {
        obstacle = createObstacleFromNetwork(this.ctx, data);
      } else {
        const unit = data.unit || 'tile';
        obstacle.x = networkCoordToWorld(data.x, unit);
        obstacle.y = networkCoordToWorld(data.y, unit);
        if (data.w !== undefined) obstacle.w = data.w;
        if (data.h !== undefined) obstacle.h = data.h;
        obstacle._networkPlacedBy = data.placedBy ?? data._placedBy ?? null;
        obstacle._networkPairId = data.pairId ?? data._networkPairId ?? null;
      }

      if (!obstacle) return;
      this.applyObstacleVisualState(obstacle, data.visualState);
      nextCache.set(key, obstacle);
      nextInstances.push(obstacle);
    });

    linkNetworkTeleporters(nextInstances);
    this._renderObstacleCache = nextCache;
    this.renderObstacleInstances = nextInstances;
    this.ctx.placedObstacles = nextInstances;
  }

  syncRenderCoins(coins = []) {
    const nextCoins = [];
    for (let index = 0; index < coins.length; index++) {
      const data = coins[index];
      let coin = this._renderCoinInstances[index];
      if (!coin || coin.isRainbow !== Boolean(data.isRainbow)) {
        coin = new Coin(
          this.ctx.p,
          data.x,
          data.y,
          data.isRainbow ? GameConfig.RAINBOW_COIN_VALUE : GameConfig.COIN_VALUE,
          this.ctx.tiledMap?.coinSprite || this.ctx.mapManager?._coinSprite || null,
          this.getCoinVisualOffset(data.x, data.y),
          Boolean(data.isRainbow),
        );
      }

      coin.x = data.x;
      coin.y = data.y;
      coin._baseY = data.y;
      coin.visualOffsetX = this.getCoinVisualOffset(data.x, data.y);
      coin.collected = Boolean(data.collected);
      coin.isRainbow = Boolean(data.isRainbow);
      coin.value = data.isRainbow ? GameConfig.RAINBOW_COIN_VALUE : GameConfig.COIN_VALUE;
      coin._networkCollectedAt = data.collectedAt || null;
      coin._networkCollectedById = data.collectedById || null;
      coin._networkCollectedByName = data.collectedByName || null;
      nextCoins.push(coin);
    }

    this._renderCoinInstances = nextCoins;
  }

  applyObstacleVisualState(obstacle, visualState = {}) {
    if (!obstacle || !visualState) return;
    if (visualState.angle !== undefined) obstacle._angle = visualState.angle;
    if (visualState.age !== undefined) obstacle._age = visualState.age;
    if (visualState.swingAngle !== undefined) obstacle._swingAngle = visualState.swingAngle;
    if (visualState.timer !== undefined) obstacle._timer = visualState.timer;
    if (visualState.active !== undefined) obstacle._active = visualState.active;
    if (visualState.fireTimer !== undefined) obstacle._fireTimer = visualState.fireTimer;
    if (visualState.frameIndex !== undefined) obstacle.frameIndex = visualState.frameIndex;
  }

  renderObstacleFallback(obs) {
    const { p } = this.ctx;
    const color = this.getObstacleColor(obs.type);
    p.fill(...color);
    p.noStroke();
    p.rect(obs.x, obs.y, obs.w || GameConfig.TILE, obs.h || GameConfig.TILE, 4);
  }

  renderCoins() {
    const coins = this.serverState?.coins || [];

    if (!coins || coins.length === 0) return;

    this.syncRenderCoins(coins);
    const time = Date.now();

    for (let index = 0; index < coins.length; index++) {
      const data = coins[index];
      const coin = this._renderCoinInstances[index];
      if (!coin) continue;

      if (data.collected) {
        this.renderRainbowPickupEffect(data, time);
        continue;
      }

      coin._age += 0.05;
      coin.draw();
    }
  }

  renderRainbowPickupEffect(coin, time) {
    const collectedAt = this.getCoinCollectedAt(coin, time);
    if (!coin.isRainbow || !collectedAt) return;
    const { p } = this.ctx;
    const age = time - collectedAt;
    if (age > 1200) return;

    const progress = age / 1200;
    const alpha = (1 - progress) * 210;
    const radius = 12 + progress * 42;
    const colors = [
      [255, 0, 0], [255, 127, 0], [255, 255, 0],
      [0, 255, 0], [0, 0, 255], [75, 0, 130], [148, 0, 211],
    ];

    p.noStroke();
    colors.forEach((color, index) => {
      const angle = (index / colors.length) * Math.PI * 2 + progress * 2;
      p.fill(...color, alpha);
      p.circle(
        coin.x + Math.cos(angle) * radius,
        coin.y + Math.sin(angle) * radius,
        8 * (1 - progress),
      );
    });
  }

  renderRainbowAnnouncements() {
    const { p, gameWidth } = this.ctx;
    const coins = this.isHost ? (this.runState?.coins || []) : (this.serverState?.coins || []);
    const now = Date.now();
    const recent = coins
      .map((coin) => {
        const collectedAt = this.getCoinCollectedAt(coin, now);
        const collectedByName = this.getCoinCollectedByName(coin);
        return { ...coin, collectedAt, collectedByName, age: collectedAt ? now - collectedAt : Infinity };
      })
      .filter((coin) => coin.isRainbow && coin.collectedByName && coin.collectedAt)
      .filter((coin) => coin.age < 2600)
      .sort((a, b) => a.collectedAt - b.collectedAt)
      .slice(-2);

    recent.forEach((coin, index) => {
      const alpha = Math.max(0, 230 - coin.age * 0.06);
      const y = 56 + index * 26;
      p.noStroke();
      p.fill(12, 18, 30, Math.min(220, alpha));
      p.rect(gameWidth / 2 - 160, y, 320, 22, 6);
      p.fill(255, 235, 130, alpha);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5.2);
      p.text(`${coin.collectedByName} 吃到了彩色金币！`, gameWidth / 2, y + 11);
    });
  }

  getCoinCollectedAt(coin, now = Date.now()) {
    if (!coin) return null;
    if (Number.isFinite(coin.collectedAge)) {
      return now - Math.max(0, coin.collectedAge);
    }
    return coin.collectedAt || coin._networkCollectedAt || null;
  }

  getCoinCollectedByName(coin) {
    return coin?.collectedByName || coin?._networkCollectedByName || null;
  }

  renderPlayers() {
    if (!this.serverState || !this.serverState.players) return;

    const { p } = this.ctx;
    const now = Date.now();

    for (const serverPlayer of this.serverState.players) {
      const playerInstance = this.playerInstances.get(serverPlayer.id);
      if (!playerInstance) continue;

      // Interpolate remote player positions for smooth rendering
      const isLocal = serverPlayer.id === this.localPlayerId;
      if (isLocal) {
        playerInstance.x = serverPlayer.x ?? playerInstance.x;
        playerInstance.y = serverPlayer.y ?? playerInstance.y;
      } else {
        const prev = this._prevPlayerPositions.get(serverPlayer.id);
        if (prev && this._lastGameStateTime > 0) {
          const elapsed = now - this._lastGameStateTime;
          const t = Math.min(elapsed / this._gameStateInterval, 1);
          playerInstance.x = prev.x + ((serverPlayer.x ?? prev.x) - prev.x) * t;
          playerInstance.y = prev.y + ((serverPlayer.y ?? prev.y) - prev.y) * t;
        } else {
          playerInstance.x = serverPlayer.x ?? playerInstance.x;
          playerInstance.y = serverPlayer.y ?? playerInstance.y;
        }
      }

      playerInstance.lifeState = serverPlayer.lifeState || 'ALIVE';
      playerInstance.facingRight = serverPlayer.facingRight !== false;
      playerInstance.character = serverPlayer.character || playerInstance.character;
      playerInstance.vx = serverPlayer.vx ?? playerInstance.vx;
      playerInstance.vy = serverPlayer.vy ?? playerInstance.vy;
      playerInstance.movementState = this.getMovementStateForRender(serverPlayer);
      if (isLocal) {
        playerInstance.onGround = Boolean(serverPlayer.onGround ?? playerInstance.onGround);
        playerInstance.jumpsLeft = serverPlayer.jumpsLeft ?? playerInstance.jumpsLeft;
        playerInstance.maxJumps = serverPlayer.maxJumps ?? playerInstance.maxJumps;
        this.applyPredictedLocalFacing(playerInstance);
      }

      if (playerInstance.lifeState === PlayerState.DEAD) continue;

      try {
        DrawPlayer(playerInstance);
      } catch (e) {
        p.fill(this.getPlayerColor(serverPlayer.id));
        p.rect(playerInstance.x, playerInstance.y, playerInstance.w, playerInstance.h);
      }

      p.fill(255);
      p.noStroke();
      p.textAlign(p.CENTER, p.BOTTOM);
      p.textSize(4);
      p.text(
        serverPlayer.name || '玩家',
        playerInstance.x + playerInstance.w / 2,
        playerInstance.y - 6
      );
    }
  }

  renderHUD() {
    const { p, gameWidth, gameHeight } = this.ctx;
    const state = this.serverState || {};

    p.noStroke();
    p.fill(0, 0, 0, 150);
    p.rect(0, 0, gameWidth, 50);
    p.rect(0, gameHeight - 40, gameWidth, 40);

    p.fill(255);
    p.textSize(8);
    p.textAlign(p.CENTER, p.TOP);
    const timeLeft = Math.ceil(state.timeLeft || 0);
    const timeColor = timeLeft < 30 ? p.color(255, 100, 100) : p.color(255);
    p.fill(timeColor);
    p.text(`⏱ ${timeLeft}秒`, gameWidth / 2, 8);

    p.fill(180, 190, 210);
    p.textSize(4);
    p.text(`第 ${state.round || 1} 轮`, gameWidth / 2, 28);

    if (state.scores && state.players) {
      p.textSize(4.5);
      let yOffset = 8;

      for (const player of state.players) {
        const score = state.scores[player.id];
        if (!score) continue;

        const isLocal = player.id === this.localPlayerId;

        p.fill(isLocal ? p.color(40, 80, 120, 200) : p.color(30, 30, 40, 200));
        p.rect(8, yOffset - 2, 180, 20, 4);

        p.fill(isLocal ? p.color(100, 200, 255) : p.color(200, 200, 200));
        p.textAlign(p.LEFT, p.TOP);

        const characterEmoji = this.getCharacterEmoji(player.character);
        const status = player.lifeState === PlayerState.DEAD ? ' 💀' : '';
        p.text(
          `${characterEmoji} ${player.name}: ${score.points}分 ${score.coins}币${status}`,
          14,
          yOffset + 2
        );
        yOffset += 24;
      }
    }

    p.fill(150, 150, 170);
    p.textSize(3.5);
    p.textAlign(p.CENTER, p.CENTER);
    p.text('WASD 移动 | 空格跳跃 | ESC暂停', gameWidth / 2, gameHeight - 20);

    const isConnected = this.networkManager.isConnected();
    p.fill(isConnected ? p.color(0, 200, 0) : p.color(200, 0, 0));
    p.textSize(3.5);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(isConnected ? '🟢 已连接' : '🔴 断开', gameWidth - 10, 8);

    const localName = state.players?.find(pl => pl.id === this.localPlayerId)?.name || '玩家';
    p.fill(100, 200, 255);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(`你: ${localName}`, gameWidth - 10, 22);
  }

  getCharacterEmoji(character) {
    const emojis = {
      chicken: '🐔',
      bunny: '🐰',
      duck: '🦆',
      polar: '🐻‍❄️',
    };
    return emojis[character] || '🎮';
  }

  renderNetworkHUD(sourceState = null) {
    const { p, gameWidth, gameHeight } = this.ctx;
    const state = sourceState || this.serverState || {};
    const timeLeft = Math.ceil(this.getDisplayedTimeLeft(state));
    const round = state.round || this.ctx.scoreManager?.currentRound || 1;

    p.noStroke();
    p.fill(0, 0, 0, 115);
    p.rect(gameWidth / 2 - 92, 8, 184, 34, 7);

    p.fill(timeLeft < 30 ? p.color(255, 105, 105) : p.color(240, 244, 255));
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(8);
    p.text(`${timeLeft}s`, gameWidth / 2, 12);

    p.fill(175, 188, 215);
    p.textSize(4.5);
    p.text(`第 ${round} 回合`, gameWidth / 2, 29);

    const isConnected = this.networkManager.isConnected();
    p.fill(isConnected ? p.color(22, 120, 64, 210) : p.color(125, 36, 36, 210));
    p.rect(gameWidth - 88, 10, 78, 18, 5);
    p.fill(230, 238, 246);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(4);
    p.text(isConnected ? '已连接' : '已断开', gameWidth - 49, 19);

    p.fill(0, 0, 0, 95);
    p.rect(gameWidth / 2 - 135, gameHeight - 28, 270, 18, 5);
    p.fill(165, 174, 196);
    p.textSize(3.8);
    p.text('按住 Tab 查看战绩  |  Esc 暂停', gameWidth / 2, gameHeight - 19);

    this.renderPauseOverlay();
  }

  renderPauseOverlay() {
    if (!this.networkPaused) return;
    const { p, gameWidth, gameHeight } = this.ctx;
    const name = this.pausedByName || '玩家';

    p.noStroke();
    p.fill(0, 0, 0, 165);
    p.rect(0, 0, gameWidth, gameHeight);
    p.fill(18, 24, 40, 245);
    p.rect(gameWidth / 2 - 180, gameHeight / 2 - 108, 360, 216, 10);
    p.stroke(90, 170, 255);
    p.strokeWeight(2);
    p.noFill();
    p.rect(gameWidth / 2 - 180, gameHeight / 2 - 108, 360, 216, 10);
    p.noStroke();

    p.fill(240, 246, 255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    p.text('游戏已暂停', gameWidth / 2, gameHeight / 2 - 58);
    p.fill(170, 190, 225);
    p.textSize(5.2);
    p.text(`${name} 暂停了游戏`, gameWidth / 2, gameHeight / 2 - 24);
    p.fill(120, 140, 175);
    p.textSize(4.2);
    p.text('按 ESC 继续', gameWidth / 2, gameHeight / 2 + 4);

    const sliders = this.pauseAudioSliderRects();
    this.drawPauseAudioSlider(sliders.sfx, 'SFX', this.ctx.audioManager?.sfxVolume ?? 0.85);
    this.drawPauseAudioSlider(sliders.music, 'Music', this.ctx.audioManager?.musicVolume ?? 0.25);
  }

  pauseAudioSliderRects() {
    const { gameWidth, gameHeight } = this.ctx;
    const y = gameHeight / 2 + 42;
    return {
      sfx: { x: gameWidth / 2 - 92, y, w: 184, h: 10 },
      music: { x: gameWidth / 2 - 92, y: y + 52, w: 184, h: 10 },
    };
  }

  drawPauseAudioSlider(rect, label, value) {
    const { p } = this.ctx;
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    const fillW = rect.w * clamped;
    const thumbX = rect.x + fillW;
    const percent = Math.round(clamped * 100);

    p.fill(205, 214, 235);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.textSize(5);
    p.text(label, rect.x, rect.y - 8);

    p.fill(140, 150, 175);
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.text(`${percent}%`, rect.x + rect.w, rect.y - 8);

    p.noStroke();
    p.fill(34, 40, 60);
    p.rect(rect.x, rect.y, rect.w, rect.h, 999);
    p.fill(76, 148, 230);
    p.rect(rect.x, rect.y, fillW, rect.h, 999);
    p.fill(236, 242, 255);
    p.circle(thumbX, rect.y + rect.h / 2, 14);
    p.fill(76, 148, 230);
    p.circle(thumbX, rect.y + rect.h / 2, 6);
  }

  hitRect(mx, my, rect) {
    return mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
  }

  hitSlider(mx, my, rect) {
    return (
      mx >= rect.x - 8 &&
      mx <= rect.x + rect.w + 8 &&
      my >= rect.y - 12 &&
      my <= rect.y + rect.h + 12
    );
  }

  renderScoreboardOverlayIfHeld() {
    const { p, gameWidth, gameHeight } = this.ctx;
    if (!p.keyIsDown?.(9)) return;

    const rows = this.getScoreboardRows();
    if (!rows.length) return;

    const panelW = Math.min(560, gameWidth - 48);
    const rowH = 34;
    const panelH = Math.min(gameHeight - 58, 86 + rows.length * rowH);
    const panelX = gameWidth / 2 - panelW / 2;
    const panelY = Math.max(26, gameHeight / 2 - panelH / 2);
    const goal = this.ctx.scoreManager?.pointsToAdvance || 100;

    p.noStroke();
    p.fill(0, 0, 0, 135);
    p.rect(0, 0, gameWidth, gameHeight);

    p.fill(12, 17, 28, 235);
    p.rect(panelX, panelY, panelW, panelH, 7);
    p.stroke(76, 96, 135);
    p.strokeWeight(1);
    p.noFill();
    p.rect(panelX, panelY, panelW, panelH, 7);
    p.noStroke();

    p.fill(225, 232, 246);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(8);
    p.text('战绩面板', panelX + 18, panelY + 14);

    p.fill(130, 143, 170);
    p.textAlign(p.RIGHT, p.TOP);
    p.textSize(4.2);
    p.text(`换图目标 ${goal} 分`, panelX + panelW - 18, panelY + 17);

    const headerY = panelY + 48;
    p.fill(47, 56, 78);
    p.rect(panelX + 12, headerY, panelW - 24, 22, 4);
    p.fill(162, 174, 202);
    p.textSize(4.1);
    p.textAlign(p.LEFT, p.CENTER);
    p.text('玩家', panelX + 24, headerY + 11);
    p.text('分数', panelX + 164, headerY + 11);
    p.text('进度', panelX + 220, headerY + 11);
    p.text('金币', panelX + 354, headerY + 11);
    p.text('彩币', panelX + 406, headerY + 11);
    p.text('钱包', panelX + 458, headerY + 11);
    p.text('死亡', panelX + 512, headerY + 11);

    const firstRowY = headerY + 26;
    rows.forEach((row, index) => {
      const y = firstRowY + index * rowH;
      if (y + rowH > panelY + panelH - 10) return;

      const color = this._scoreRowColor(index);
      p.fill(row.isLocal ? p.color(35, 63, 96, 235) : p.color(22, 27, 40, 220));
      p.rect(panelX + 12, y, panelW - 24, rowH - 4, 5);

      p.fill(...color);
      p.circle(panelX + 28, y + 15, 9);

      const name = String(row.name || `P${index + 1}`);
      const shortName = name.length > 15 ? `${name.slice(0, 14)}...` : name;
      p.fill(row.isLocal ? p.color(235, 246, 255) : p.color(210, 218, 235));
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(5.3);
      p.text(`${shortName}${row.isLocal ? '  自己' : ''}`, panelX + 42, y + 15);

      p.fill(235, 239, 248);
      p.textSize(5);
      p.text(`${row.points}`, panelX + 164, y + 15);

      const barX = panelX + 220;
      const barY = y + 10;
      const barW = 106;
      const barH = 10;
      p.fill(42, 47, 64);
      p.rect(barX, barY, barW, barH, 4);
      p.fill(...color);
      p.rect(barX, barY, barW * this._scoreboardProgress(row), barH, 4);
      p.fill(210, 216, 232);
      p.textSize(3.7);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(`${row.points}/${goal}`, barX + barW / 2, barY + barH / 2);

      p.fill(220, 226, 240);
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(4.8);
      p.text(`${row.coins}`, panelX + 354, y + 15);
      p.text(`${row.rainbowCoins}`, panelX + 406, y + 15);
      p.text(`${row.wallet}`, panelX + 458, y + 15);
      p.text(`${row.deaths}`, panelX + 512, y + 15);
    });
  }

  getScoreboardRows() {
    if (this.isHost && this.ctx.players?.length) {
      const scoreManager = this.ctx.scoreManager;
      return this.ctx.players.map((player, index) => {
        const id = player.networkId || player.playerNo;
        const score = scoreManager?.getScore(player) || {};
        const rainbowCoins = scoreManager?.getRainbowCoins?.(player) ?? score.specialCoins ?? 0;
        return {
          id,
          name: player.nickname || `P${index + 1}`,
          points: scoreManager?.getPoints(player.playerNo) ?? 0,
          coins: scoreManager?.getRoundCoins(player) ?? 0,
          rainbowCoins,
          wallet: scoreManager?.getWallet(player) ?? 0,
          roundPoints: scoreManager?.getRoundPoints(player.playerNo) ?? 0,
          deaths: score.deaths ?? 0,
          finished: Boolean(score.finished),
          isLocal: id === this.localPlayerId,
        };
      });
    }

    const state = this.serverState || {};
    const players = state.players || this.ctx.networkPlayers || [];
    const scores = state.scores || this.ctx.lastScores || {};
    return players.map((player, index) => {
      const score = scores[player.id] || {};
      return {
        id: player.id,
        name: player.name || `P${index + 1}`,
        points: score.points ?? 0,
        coins: score.coins ?? 0,
        rainbowCoins: score.rainbowCoins ?? 0,
        wallet: score.wallet ?? 0,
        roundPoints: score.roundPoints ?? 0,
        deaths: score.deaths ?? 0,
        finished: Boolean(score.finished),
        isLocal: player.id === this.localPlayerId,
      };
    });
  }

  _scoreboardProgress(row) {
    const goal = this.ctx.scoreManager?.pointsToAdvance || 100;
    return Math.max(0, Math.min((row.points || 0) / goal, 1));
  }

  _scoreRowColor(index) {
    const colors = [
      [90, 170, 255],
      [255, 200, 80],
      [80, 220, 120],
      [255, 140, 200],
    ];
    return colors[index] || [200, 205, 218];
  }

  // ===== Input =====

  getLocalInput() {
    const { p } = this.ctx;
    return {
      left: p.keyIsDown(65) || p.keyIsDown(p.LEFT_ARROW),
      right: p.keyIsDown(68) || p.keyIsDown(p.RIGHT_ARROW),
      jump:
        p.keyIsDown(87) ||
        p.keyIsDown(p.UP_ARROW) ||
        p.keyIsDown(32),
    };
  }

  keyPressed() {
    const { p } = this.ctx;
    if (p.keyCode === p.ESCAPE) {
      this.networkManager.setPause?.(!this.networkPaused);
    }
  }

  mousePressed(mx, my) {
    if (!this.networkPaused) return;
    const sliders = this.pauseAudioSliderRects();
    if (this.hitSlider(mx, my, sliders.sfx)) {
      this._activePauseSlider = 'sfx';
      this.setPauseSliderFromMouse(sliders.sfx, 'sfx', mx);
    } else if (this.hitSlider(mx, my, sliders.music)) {
      this._activePauseSlider = 'music';
      this.setPauseSliderFromMouse(sliders.music, 'music', mx);
    }
  }

  mouseDragged(mx, _my) {
    if (!this.networkPaused || !this._activePauseSlider) return;
    const sliders = this.pauseAudioSliderRects();
    const rect = this._activePauseSlider === 'sfx' ? sliders.sfx : sliders.music;
    this.setPauseSliderFromMouse(rect, this._activePauseSlider, mx);
  }

  mouseReleased() {
    this._activePauseSlider = null;
  }

  // ===== Helpers =====

  renderWaiting(gameWidth, gameHeight) {
    const { p } = this.ctx;

    p.background(25);
    p.fill(255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(8);
    p.text('等待游戏状态同步...', gameWidth / 2, gameHeight / 2 - 20);

    p.fill(150);
    p.textSize(5);
    p.text('请确保主机玩家已经开始游戏', gameWidth / 2, gameHeight / 2 + 20);
  }

  setPauseSliderFromMouse(rect, type, mx) {
    const ratio = (mx - rect.x) / rect.w;
    this.ctx.audioManager?.setVolume?.(type, ratio);
  }

  getDisplayedTimeLeft(state = {}) {
    const raw = Number(state?.timeLeft);
    if (!Number.isFinite(raw)) return 0;
    if (this.isHost) {
      this._displayTimeLeft = Math.max(0, raw);
      return this._displayTimeLeft;
    }

    const now = Date.now();
    const receivedAt = state?._receivedAt ?? now;
    const elapsedMs = now - receivedAt;
    const computed = Math.max(0, raw - elapsedMs / 1000);
    if (this._displayTimeLeft == null) {
      this._displayTimeLeft = computed;
    } else {
      this._displayTimeLeft = Math.min(this._displayTimeLeft, computed);
    }
    return this._displayTimeLeft;
  }

  getMovementStateForRender(serverPlayer = {}) {
    if (serverPlayer.movementState) return serverPlayer.movementState;
    if ((serverPlayer.vy ?? 0) < -1) return PlayerMovementState.JUMP;
    if ((serverPlayer.vy ?? 0) > 1) return PlayerMovementState.FALL;
    if (Math.abs(serverPlayer.vx ?? 0) > 0.5) return PlayerMovementState.RUN;
    return PlayerMovementState.IDLE;
  }

  applyPredictedLocalFacing(player) {
    if (!player || !this._lastLocalInput) return;
    if (Date.now() - this._lastLocalInputAt > 120) return;

    const input = this._lastLocalInput;
    if (input.left && !input.right) player.facingRight = false;
    if (input.right && !input.left) player.facingRight = true;
  }

  getCoinVisualOffset(x, y) {
    const T = GameConfig.TILE;
    const tx = Math.floor((x + T * 0.25) / T);
    const ty = Math.floor((y + T * 0.25) / T);
    return this.ctx.tiledMap?._coinHorizontalOffset?.(tx, ty) ?? 0;
  }

  syncLocalAudioTransitions(players = []) {
    for (const player of players || []) {
      const id = player?.id ?? player?.networkId ?? player?.playerNo;
      if (id == null) continue;
      const nextLifeState = player.lifeState || PlayerState.ALIVE;
      const previousLifeState = this._playerLifeStates.get(id);
      if (
        id === this.localPlayerId &&
        previousLifeState &&
        previousLifeState !== PlayerState.DEAD &&
        nextLifeState === PlayerState.DEAD
      ) {
        this.ctx.audioManager?.playSound('death');
      }
      this._playerLifeStates.set(id, nextLifeState);
    }
  }

  getPlayerColor(playerId) {
    if (playerId === this.localPlayerId) {
      return [90, 170, 255];
    }
    return [255, 200, 80];
  }

  getObstacleColor(type) {
    const colors = {
      PLATFORM: [120, 90, 60],
      MOVING_PLATFORM: [80, 110, 160],
      FALLING_PLATFORM: [90, 65, 40],
      ICE_PLATFORM: [160, 220, 245],
      BOUNCE_PAD: [80, 200, 100],
      SPIKE: [220, 60, 60],
      CANNON: [100, 100, 115],
      ARROW: [139, 90, 43],
      SAW: [200, 60, 60],
      FLAME: [240, 100, 20],
      SPIKED_BALL: [170, 80, 40],
      WIND_ZONE: [60, 185, 185],
      TELEPORTER: [160, 80, 240],
      BOMB: [220, 80, 40],
      SHADOW: [140, 90, 220],
      SLIME: [40, 180, 60],
      BLACK_HOLE: [100, 40, 200],
      MUSHROOM_TELEPORTER: [220, 50, 50],
      LASER: [255, 50, 50],
      ERASER: [255, 220, 80],
    };
    return colors[type] || [150, 150, 150];
  }
}
