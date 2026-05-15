/**
 * NetworkShopState
 *
 * Uses the single-player ShopState UI and item presentation, while replacing
 * purchase/finish actions with Worker-confirmed multiplayer messages.
 */

import {
  ShopState,
  setShopItemsForCurrentRound,
} from './ShopState.js';
import { GameStage } from '../config/GameStage.js';
import { ObstacleType } from '../config/ObstacleType.js';

function networkPlayerIndex(ctx, playerId) {
  return (ctx.networkPlayers || []).findIndex((player) => player.id === playerId);
}

function syncWallet(ctx, playerId, wallet) {
  const index = networkPlayerIndex(ctx, playerId);
  if (index < 0 || wallet === undefined) return;
  ctx.scoreManager?.wallet?.set(index, wallet);
}

function syncScoreSnapshot(ctx, scores = {}) {
  for (const [playerId, score] of Object.entries(scores)) {
    const index = networkPlayerIndex(ctx, playerId);
    if (index < 0) continue;
    if (score.wallet !== undefined) ctx.scoreManager?.wallet?.set(index, score.wallet);
    if (score.points !== undefined) {
      ctx.scoreManager?.points?.set(index, score.points);
      ctx.scoreManager?.totalPoints?.set(index, score.points);
    }
  }
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

function applyNetworkMapSelection(ctx, data) {
  if (!data?.mapKey) return;

  const bgIndex = data.bgIndex ?? ctx.networkBgIndex;
  const needsMap = ctx.mapKey !== data.mapKey;
  const needsBg = bgIndex !== undefined && ctx.networkBgIndex !== bgIndex;
  const hasMapData = Boolean(data.mapData);

  ctx.networkMapKey = data.mapKey;
  ctx.networkBgIndex = bgIndex;
  if (hasMapData) ctx.networkMapData = data.mapData;

  if (Array.isArray(data.obstacles)) {
    ctx.networkObstacleData = data.obstacles;
    if (data.obstacles.length === 0) {
      ctx.placedObstacles = [];
    }
  }

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

export class NetworkShopState extends ShopState {
  constructor(ctx, goTo, networkManager) {
    super(ctx, goTo);
    this.networkManager = networkManager;
    this.localPlayerId = null;
    this.localPlayerIndex = 0;
    this.shopItems = [];
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = 0;
    this.isStuck = false;
  }

  enter() {
    this.ctx.shopHasRun = true;
    this.localPlayerId = this.networkManager.getPlayerId();
    this.localPlayerIndex = Math.max(0, networkPlayerIndex(this.ctx, this.localPlayerId));
    this._currentTurn = this.localPlayerIndex;
    this._message = '';
    this._msgTimer = 0;
    this._hoveredItem = null;
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = this.ctx.networkPlayers?.length || this.ctx.players?.length || 2;

    const scores = this.ctx.lastScores;
    if (scores) {
      syncScoreSnapshot(this.ctx, scores);
    }
    if (this.ctx.networkInventories?.[this.localPlayerId]) {
      syncInventory(this.ctx, this.localPlayerId, this.ctx.networkInventories[this.localPlayerId]);
    }

    this._onShopPhaseStart = this.onShopPhaseStart.bind(this);
    this._onShopSync = this.onShopSync.bind(this);
    this._onBuildPhaseStart = this.onBuildPhaseStart.bind(this);
    this._onStageChange = this.onStageChange.bind(this);

    this.networkManager.on('SHOP_PHASE_START', this._onShopPhaseStart);
    this.networkManager.on('SHOP_SYNC', this._onShopSync);
    this.networkManager.on('BUILD_PHASE_START', this._onBuildPhaseStart);
    this.networkManager.on('STAGE_CHANGE', this._onStageChange);

    const pendingShop = this.ctx.pendingShopPhase || this.networkManager.consumeLast?.('SHOP_PHASE_START');
    if (pendingShop && this.isRelevantRound(pendingShop)) {
      this.ctx.pendingShopPhase = null;
      this.onShopPhaseStart(pendingShop);
    }

    const pendingBuild = this.ctx.pendingBuildPhase;
    if (pendingBuild && this.isRelevantRound(pendingBuild)) {
      this.ctx.pendingBuildPhase = null;
      this.onBuildPhaseStart(pendingBuild);
      return;
    }

    console.log('[NetworkShop] Entered shop phase with single-player UI');
  }

  exit() {
    this.networkManager.off('SHOP_PHASE_START', this._onShopPhaseStart);
    this.networkManager.off('SHOP_SYNC', this._onShopSync);
    this.networkManager.off('BUILD_PHASE_START', this._onBuildPhaseStart);
    this.networkManager.off('STAGE_CHANGE', this._onStageChange);
  }

  onShopPhaseStart(data) {
    applyNetworkMapSelection(this.ctx, data);
    for (const [playerId, inventory] of Object.entries(this.ctx.networkInventories || {})) {
      syncInventory(this.ctx, playerId, inventory);
    }
    this.shopItems = data.shopItems || [];
    this.isStuck = Boolean(data.isStuck);
    this.ctx.networkRound = data.round ?? this.ctx.networkRound;
    setShopItemsForCurrentRound(this.shopItems, this.isStuck);

    if (data.scores) {
      this.ctx.lastScores = data.scores;
      syncScoreSnapshot(this.ctx, data.scores);
    }
    console.log('[NetworkShop] Shop items:', this.shopItems.length);
  }

  onShopSync(data) {
    if (data.done) {
      this.doneCount = data.doneCount || 0;
      this.totalPlayers = data.totalPlayers || this.totalPlayers;
    }
    if (!data.playerId) return;

    if (data.wallet !== undefined) {
      this.ctx.lastScores = this.ctx.lastScores || {};
      this.ctx.lastScores[data.playerId] = {
        ...(this.ctx.lastScores[data.playerId] || {}),
        wallet: data.wallet,
      };
      syncWallet(this.ctx, data.playerId, data.wallet);
    }

    if (data.inventory) {
      syncInventory(this.ctx, data.playerId, data.inventory);
    }
  }

  onBuildPhaseStart(data) {
    console.log('[NetworkShop] Build phase starting, transitioning...');
    this.ctx.pendingBuildPhase = data;
    this.ctx.networkRound = data.round ?? this.ctx.networkRound;

    if (data.inventories) {
      this.ctx.networkInventories = data.inventories;
      for (const [playerId, inventory] of Object.entries(data.inventories)) {
        syncInventory(this.ctx, playerId, inventory);
      }
    }

    this.goTo(GameStage.NETWORK_BUILD);
  }

  onStageChange(data) {
    if (data.stage === GameStage.NETWORK_BUILD) {
      this.goTo(GameStage.NETWORK_BUILD);
    }
  }

  _buyItem(item, player, scoreManager) {
    if (this.isDone) return;

    if (item.type === ObstacleType.ERASER) {
      const owned = player.inventory.get(item.type) ?? 0;
      if (owned >= 1) {
        this._showMessage('每人限购一个消除者');
        return;
      }
    }

    const ok = scoreManager.spendWallet(player, item.price);
    if (!ok) {
      this._showMessage(`金币不足，需要 ${item.price}`);
      return;
    }

    const current = player.inventory.get(item.type) ?? 0;
    player.inventory.set(item.type, current + 1);
    this.networkManager.shopPurchase(item.type);
    this.ctx.audioManager?.playSound('coin');
    this._showMessage(`已购买 ${this._labelFor(item.type)}`);
  }

  _doneTurn() {
    if (this.isDone) return;
    this.isDone = true;
    this.networkManager.shopDone();
    this._showMessage('已完成购物，等待其他玩家');
  }

  finishShopping() {
    this._doneTurn();
  }

  update(deltaTime) {
    super.update(deltaTime);
    this._currentTurn = this.localPlayerIndex;
  }

  render(mx, my) {
    this._currentTurn = this.localPlayerIndex;
    super.render(mx, my);

    if (this.isDone) {
      const { p, gameWidth, gameHeight } = this.ctx;
      p.noStroke();
      p.fill(0, 0, 0, 130);
      p.rect(0, gameHeight - 86, gameWidth, 38);
      p.fill(100, 255, 140);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5.5);
      p.text(
        `已完成购物，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`,
        gameWidth / 2,
        gameHeight - 67,
      );
    }
  }

  isRelevantRound(data) {
    const currentRound = this.ctx.networkRound ?? this.ctx.pendingRoundResults?.round;
    if (data?.round === undefined || currentRound === undefined) return true;
    return data.round >= currentRound;
  }
}
