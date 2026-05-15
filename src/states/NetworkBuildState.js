/**
 * NetworkBuildState
 *
 * Reuses the single-player BuildState UI, icons, ghost preview and placement
 * validation. Only the side effects are networked: placement, undo and done
 * wait for the Worker so all clients keep the same obstacle list.
 */

import { BuildState } from './BuildState.js';
import { GameStage } from '../config/GameStage.js';
import { GameConfig } from '../config/GameConfig.js';
import { ObstacleType } from '../config/ObstacleType.js';
import { CannonDir } from '../entities/obstacles/Cannon.js';
import { WindDir } from '../entities/obstacles/WindZone.js';
import {
  createObstacleFromNetwork,
  hydrateNetworkObstacles,
  linkNetworkTeleporters,
} from '../network/NetworkObstacleFactory.js';

function networkPlayerIndex(ctx, playerId) {
  return (ctx.networkPlayers || []).findIndex((player) => player.id === playerId);
}

function syncInventory(ctx, playerId, inventory) {
  if (!inventory) return;
  ctx.networkInventories = ctx.networkInventories || {};
  ctx.networkInventories[playerId] = { ...inventory };

  const index = networkPlayerIndex(ctx, playerId);
  const player = index >= 0 ? ctx.players?.[index] : null;
  if (player) {
    player.inventory = new Map(
      Object.entries(inventory).filter(([, count]) => count > 0),
    );
  }
}

function cloneNetworkObstacle(data) {
  return {
    type: data.type,
    x: Number(data.x) || 0,
    y: Number(data.y) || 0,
    unit: data.unit || 'tile',
    direction: data.direction,
    pairId: data.pairId || null,
    placedBy: data.placedBy ?? data._placedBy,
    id: data.id || data._id,
  };
}

function pixelToTile(value) {
  return Math.floor(value / GameConfig.TILE);
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

export class NetworkBuildState extends BuildState {
  constructor(
    ctx,
    goTo,
    networkManager,
    sawFrames,
    fireFrames,
    trampolineBouncing,
    spikedBallImg,
    cannonImg,
    fallingPlatformFrames,
  ) {
    super(
      ctx,
      goTo,
      sawFrames,
      fireFrames,
      trampolineBouncing,
      spikedBallImg,
      cannonImg,
      fallingPlatformFrames,
    );
    this.networkManager = networkManager;
    this.localPlayerId = null;
    this.localPlayerIndex = 0;
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = 0;
    this._pendingTeleporterPairId = null;
  }

  enter() {
    this.ctx.shopHasRun = true;

    this.localPlayerId = this.networkManager.getPlayerId();
    this.localPlayerIndex = Math.max(0, networkPlayerIndex(this.ctx, this.localPlayerId));
    this._currentTurn = this.localPlayerIndex;
    this._selectedType = null;
    this._cannonDir = CannonDir.RIGHT;
    this._windDir = WindDir.RIGHT;
    this._pendingTeleporter = null;
    this._pendingTeleporterPairId = null;
    this._turnObstacles = [];
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = this.ctx.networkPlayers?.length || this.ctx.players?.length || 2;

    this._buildBlockedPlacementMap();

    this._onBuildPhaseStart = this.onBuildPhaseStart.bind(this);
    this._onBuildSync = this.onBuildSync.bind(this);
    this._onObstaclePlaced = this.onObstaclePlaced.bind(this);
    this._onObstacleRemoved = this.onObstacleRemoved.bind(this);
    this._onObstaclesErased = this.onObstaclesErased.bind(this);
    this._onStageChange = this.onStageChange.bind(this);

    this.networkManager.on('BUILD_PHASE_START', this._onBuildPhaseStart);
    this.networkManager.on('BUILD_SYNC', this._onBuildSync);
    this.networkManager.on('OBSTACLE_PLACED', this._onObstaclePlaced);
    this.networkManager.on('OBSTACLE_REMOVED', this._onObstacleRemoved);
    this.networkManager.on('OBSTACLES_ERASED', this._onObstaclesErased);
    this.networkManager.on('STAGE_CHANGE', this._onStageChange);

    const pendingBuild = this.ctx.pendingBuildPhase || this.networkManager.consumeLast?.('BUILD_PHASE_START');
    if (pendingBuild && this.isRelevantRound(pendingBuild)) {
      this.ctx.pendingBuildPhase = null;
      this.onBuildPhaseStart(pendingBuild);
    } else {
      const inventory = this.ctx.networkInventories?.[this.localPlayerId];
      if (inventory) syncInventory(this.ctx, this.localPlayerId, inventory);
      this.ctx.placedObstacles = hydrateNetworkObstacles(
        this.ctx,
        this.ctx.networkObstacleData || this.ctx.placedObstacles || [],
      );
    }

    console.log('[NetworkBuild] Entered build phase with single-player UI');
  }

  exit() {
    this.networkManager.off('BUILD_PHASE_START', this._onBuildPhaseStart);
    this.networkManager.off('BUILD_SYNC', this._onBuildSync);
    this.networkManager.off('OBSTACLE_PLACED', this._onObstaclePlaced);
    this.networkManager.off('OBSTACLE_REMOVED', this._onObstacleRemoved);
    this.networkManager.off('OBSTACLES_ERASED', this._onObstaclesErased);
    this.networkManager.off('STAGE_CHANGE', this._onStageChange);
  }

  onBuildPhaseStart(data) {
    applyNetworkMapSelection(this.ctx, data);
    this._buildBlockedPlacementMap();
    this.ctx.networkRound = data.round ?? this.ctx.networkRound;

    if (data.inventories) {
      this.ctx.networkInventories = data.inventories;
      for (const [playerId, inventory] of Object.entries(data.inventories)) {
        syncInventory(this.ctx, playerId, inventory);
      }
    }

    if (data.obstacles) {
      this.ctx.networkObstacleData = data.obstacles.map((obs) => cloneNetworkObstacle(obs));
      this.ctx.placedObstacles = hydrateNetworkObstacles(this.ctx, this.ctx.networkObstacleData);
    }
  }

  onBuildSync(data) {
    if (data.done) {
      this.doneCount = data.doneCount || 0;
      this.totalPlayers = data.totalPlayers || this.totalPlayers;
    }
  }

  onObstaclePlaced(data) {
    const id = data.id || data._id;
    if (id && this.ctx.networkObstacleData?.some((obs) => (obs.id || obs._id) === id)) {
      return;
    }

    this.ctx.networkObstacleData = this.ctx.networkObstacleData || [];
    this.ctx.networkObstacleData.push(cloneNetworkObstacle(data));

    const obstacle = createObstacleFromNetwork(this.ctx, data);
    if (obstacle) {
      this.ctx.placedObstacles.push(obstacle);
      linkNetworkTeleporters(this.ctx.placedObstacles);
      const placedIndex = networkPlayerIndex(this.ctx, data.placedBy);
      if (placedIndex >= 0) {
        this.ctx.scoreManager?.recordTrapPlacement?.(placedIndex);
      }
      if (data.placedBy === this.localPlayerId) {
        this._turnObstacles.push(obstacle);
        this._updateLocalTeleporterPending(obstacle);
      }
    }

    if (data.inventory) {
      syncInventory(this.ctx, data.placedBy, data.inventory);
      if (
        data.placedBy === this.localPlayerId &&
        this._selectedType !== ObstacleType.TELEPORTER &&
        this._tokenCount(this._selectedType) <= 0
      ) {
        this._selectedType = null;
      }
    }
  }

  onObstacleRemoved(data) {
    const id = data.id || data._id;
    this.ctx.networkObstacleData = (this.ctx.networkObstacleData || []).filter(
      (obs) => (obs.id || obs._id) !== id,
    );
    this.ctx.placedObstacles = (this.ctx.placedObstacles || []).filter(
      (obs) => (obs._id || obs.id) !== id,
    );
    this._turnObstacles = this._turnObstacles.filter(
      (obs) => (obs._id || obs.id) !== id,
    );
    linkNetworkTeleporters(this.ctx.placedObstacles);

    if (data.inventory) {
      syncInventory(this.ctx, data.placedBy, data.inventory);
    }

    if (data.placedBy === this.localPlayerId) {
      if (data.pendingPairId) {
        this._pendingTeleporterPairId = data.pendingPairId;
        this._pendingTeleporter =
          this.ctx.placedObstacles.find(
            (obs) =>
              obs.type === ObstacleType.TELEPORTER &&
              obs._networkPairId === data.pendingPairId &&
              obs._networkPlacedBy === this.localPlayerId,
          ) || null;
      } else if (this._pendingTeleporterPairId === data.pairId) {
        this._pendingTeleporterPairId = null;
        this._pendingTeleporter = null;
      }
    }
  }

  onObstaclesErased(data) {
    const radius = 3 * GameConfig.TILE;
    const centerX = data.x * GameConfig.TILE + GameConfig.TILE / 2;
    const centerY = data.y * GameConfig.TILE + GameConfig.TILE / 2;

    this.ctx.networkObstacleData = (this.ctx.networkObstacleData || []).filter((obs) => {
      const obsX = obs.x * GameConfig.TILE + GameConfig.TILE / 2;
      const obsY = obs.y * GameConfig.TILE + GameConfig.TILE / 2;
      return Math.sqrt((obsX - centerX) ** 2 + (obsY - centerY) ** 2) > radius;
    });
    this.ctx.placedObstacles = hydrateNetworkObstacles(this.ctx, this.ctx.networkObstacleData);
  }

  onStageChange(data) {
    if (data.stage === GameStage.RUN) {
      applyNetworkMapSelection(this.ctx, data);
      this.ctx.networkRound = data.round ?? this.ctx.networkRound;
      this.ctx.networkPlayers = data.players || this.ctx.networkPlayers;
      this.ctx.networkObstacleData = data.obstacles || this.ctx.networkObstacleData || [];
      this.ctx.placedObstacles = this.ctx.networkObstacleData;
      this.goTo(GameStage.NETWORK_RUN);
    }
  }

  mousePressed(mx, my) {
    if (this.isDone) return;

    const { p, gameHeight } = this.ctx;
    const paletteY = gameHeight - this._paletteH();
    if (my >= paletteY) {
      this._handlePaletteClick(mx, my);
      return;
    }

    const T = GameConfig.TILE;
    const worldView = this._worldView();
    const worldMx = (mx - worldView.x) / worldView.scale;
    const worldMy = (my - worldView.y) / worldView.scale;
    const snapX = Math.floor(worldMx / T) * T;
    const snapY = Math.floor(worldMy / T) * T;

    if (p.mouseButton === p.RIGHT) {
      const obs = this._turnObstacles.find((item) => item.x === snapX && item.y === snapY);
      if (obs) {
        this.networkManager.undoObstacle(obs._id || obs.id);
      }
      return;
    }

    if (!this._selectedType) return;
    if (!this._canPlaceSelectedAt(snapX, snapY)) return;

    const isTeleporterSecond =
      this._selectedType === ObstacleType.TELEPORTER &&
      this._pendingTeleporter !== null;
    if (!isTeleporterSecond && this._tokenCount(this._selectedType) <= 0) return;

    const extra = {};
    if (this._selectedType === ObstacleType.TELEPORTER) {
      if (!this._pendingTeleporterPairId) {
        this._pendingTeleporterPairId =
          `tp_${this.localPlayerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      extra.pairId = this._pendingTeleporterPairId;
    }

    this.networkManager.placeObstacle(
      this._selectedType,
      pixelToTile(snapX),
      pixelToTile(snapY),
      this._networkDirectionForSelected(),
      extra,
    );
    this.ctx.audioManager?.playSound('place');
  }

  keyPressed() {
    const { p } = this.ctx;
    if (p.keyCode === p.ENTER || p.keyCode === 13) {
      this._advanceTurn();
    } else if (p.key === 'r' || p.key === 'R') {
      this._rotateDirection();
    } else if (p.key === 'd' || p.key === 'D') {
      this.ctx.devMode = !this.ctx.devMode;
    }
  }

  _advanceTurn() {
    if (this.isDone) return;
    this.isDone = true;
    this._selectedType = null;
    this.networkManager.buildDone();
  }

  _undoLast() {
    const last = this._turnObstacles[this._turnObstacles.length - 1];
    if (!last) return;
    this.networkManager.undoObstacle(last._id || last.id);
  }

  _networkDirectionForSelected() {
    if (this._selectedType === ObstacleType.CANNON || this._selectedType === ObstacleType.ARROW) {
      return this._cannonDir;
    }
    if (this._selectedType === ObstacleType.WIND_ZONE) {
      return this._windDir;
    }
    return undefined;
  }

  _updateLocalTeleporterPending(obstacle) {
    if (obstacle.type !== ObstacleType.TELEPORTER) return;

    if (this._pendingTeleporter && this._pendingTeleporterPairId === obstacle._networkPairId) {
      this._pendingTeleporter = null;
      this._pendingTeleporterPairId = null;
      if (this._tokenCount(ObstacleType.TELEPORTER) <= 0) {
        this._selectedType = null;
      }
    } else {
      this._pendingTeleporter = obstacle;
      this._pendingTeleporterPairId = obstacle._networkPairId;
    }
  }

  render(mx, my) {
    this._currentTurn = this.localPlayerIndex;
    super.render(mx, my);

    if (this.isDone) {
      const { p, gameWidth, gameHeight } = this.ctx;
      p.noStroke();
      p.fill(0, 0, 0, 130);
      p.rect(0, gameHeight - 42, gameWidth, 34);
      p.fill(100, 255, 140);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5.2);
      p.text(
        `已完成布置，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`,
        gameWidth / 2,
        gameHeight - 25,
      );
    }
  }

  isRelevantRound(data) {
    const currentRound = this.ctx.networkRound;
    if (data?.round === undefined || currentRound === undefined) return true;
    return data.round >= currentRound;
  }
}
