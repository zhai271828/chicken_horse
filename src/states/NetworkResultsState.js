/**
 * NetworkResultsState - End-of-round scoreboard for networked games
 *
 * Displays rankings, scores, titles, and map advancement info.
 * Waits for local Enter, then transitions once the server starts the shop.
 */

import { State } from './State.js';
import { GameStage } from '../config/GameStage.js';

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

function networkPlayerIndex(ctx, playerId) {
  return (ctx.networkPlayers || []).findIndex((player) => player.id === playerId);
}

function syncScoreSnapshot(ctx, scores = {}) {
  for (const [playerId, score] of Object.entries(scores)) {
    const index = networkPlayerIndex(ctx, playerId);
    if (index < 0) continue;
    if (score.points !== undefined) {
      ctx.scoreManager?.points?.set(index, score.points);
      ctx.scoreManager?.totalPoints?.set(index, score.points);
    }
    if (score.wallet !== undefined) {
      ctx.scoreManager?.wallet?.set(index, score.wallet);
    }
    if (score.coins !== undefined || score.roundCoins !== undefined) {
      ctx.scoreManager?.roundCoins?.set(index, score.roundCoins ?? score.coins ?? 0);
    }
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

  if (data.scores) {
    ctx.lastScores = data.scores;
  }

  if (!needsMap && !needsBg && !hasMapData) {
    if (data.scores) syncScoreSnapshot(ctx, data.scores);
    return;
  }

  const networkPlayers = ctx.networkPlayers;
  const networkInventories = ctx.networkInventories;
  const networkObstacleData = ctx.networkObstacleData;
  const pendingRoundResults = ctx.pendingRoundResults;
  const pendingShopPhase = ctx.pendingShopPhase;
  const lastScores = ctx.lastScores;
  if (hasMapData) {
    ctx.mapManager?.applyNetworkMapData?.(data.mapData, ctx, bgIndex);
  } else {
    ctx.mapManager?.selectMapWithBg?.(data.mapKey, ctx, bgIndex);
  }
  ctx.networkPlayers = networkPlayers;
  ctx.networkInventories = networkInventories;
  ctx.networkObstacleData = networkObstacleData;
  ctx.pendingRoundResults = pendingRoundResults;
  ctx.pendingShopPhase = pendingShopPhase;
  ctx.lastScores = lastScores;
  if (data.scores) syncScoreSnapshot(ctx, data.scores);
}

export class NetworkResultsState extends State {
  constructor(ctx, goTo, networkManager) {
    super(ctx, goTo);
    this.networkManager = networkManager;
    this.results = null;
    this.titles = {};
    this.rankedPlayers = [];
    this.shouldAdvance = false;
    this.showLeaderboard = false;
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = 0;
  }

  enter() {
    this.results = null;
    this.titles = {};
    this.rankedPlayers = [];
    this.shouldAdvance = false;
    this.showLeaderboard = false;
    this.isDone = false;
    this.doneCount = 0;
    this.totalPlayers = this.ctx.networkPlayers?.length || this.ctx.players?.length || 2;

    // Check if NetworkRunState already received ROUND_RESULTS and stored it
    if (this.ctx.pendingRoundResults) {
      console.log('[NetworkResults] Found pre-received results in ctx');
      this.onRoundResults(this.ctx.pendingRoundResults);
      this.ctx.pendingRoundResults = null;
    }

    this._onRoundResults = this.onRoundResults.bind(this);
    this._onShopPhaseStart = this.onShopPhaseStart.bind(this);
    this._onStageChange = this.onStageChange.bind(this);
    this._onResultsSync = this.onResultsSync.bind(this);
    this._onMapChanged = this.onMapChanged.bind(this);

    this.networkManager.on('ROUND_RESULTS', this._onRoundResults);
    this.networkManager.on('SHOP_PHASE_START', this._onShopPhaseStart);
    this.networkManager.on('STAGE_CHANGE', this._onStageChange);
    this.networkManager.on('RESULTS_SYNC', this._onResultsSync);
    this.networkManager.on('MAP_CHANGED', this._onMapChanged);

    const pendingMap = this.networkManager.consumeLast?.('MAP_CHANGED');
    if (pendingMap) {
      this.onMapChanged(pendingMap);
    }

    const pendingResultsSync = this.networkManager.consumeLast?.('RESULTS_SYNC');
    if (pendingResultsSync) {
      this.onResultsSync(pendingResultsSync);
    }

    const pendingShop = this.ctx.pendingShopPhase || this.networkManager.consumeLast?.('SHOP_PHASE_START');
    if (pendingShop && this.isRelevantRound(pendingShop)) {
      this.ctx.pendingShopPhase = pendingShop;
      if (this.isDone) {
        this.onShopPhaseStart(pendingShop);
        return;
      }
    }

    console.log('[NetworkResults] Entered results phase');
  }

  exit() {
    this.networkManager.off('ROUND_RESULTS', this._onRoundResults);
    this.networkManager.off('SHOP_PHASE_START', this._onShopPhaseStart);
    this.networkManager.off('STAGE_CHANGE', this._onStageChange);
    this.networkManager.off('RESULTS_SYNC', this._onResultsSync);
    this.networkManager.off('MAP_CHANGED', this._onMapChanged);
  }

  // ===== Network Handlers =====

  onRoundResults(data) {
    this.results = data;
    this.shouldAdvance = data.shouldAdvance || false;
    this.titles = this.shouldAdvance ? (data.titles || {}) : {};
    this.rankedPlayers = data.rankings || [];
    this.ctx.networkRound = data.round ?? this.ctx.networkRound;
    this.ctx.lastScores = scoresFromRankings(this.rankedPlayers);
    console.log('[NetworkResults] Got results:', this.rankedPlayers.length, 'players');
  }

  onShopPhaseStart(data) {
    console.log('[NetworkResults] Shop phase starting, transitioning...');
    applyNetworkMapSelection(this.ctx, data);
    this.ctx.pendingShopPhase = data;
    this.ctx.networkRound = data.round ?? this.ctx.networkRound;
    this.networkManager.consumeLast?.('SHOP_PHASE_START');
    this.goTo(GameStage.NETWORK_SHOP);
  }

  onStageChange(data) {
    if (data.stage === GameStage.NETWORK_SHOP) {
      this.goTo(GameStage.NETWORK_SHOP);
    } else if (data.stage === GameStage.RUN) {
      applyNetworkMapSelection(this.ctx, data);
      this.ctx.pendingShopPhase = null;
      this.ctx.networkRound = data.round ?? this.ctx.networkRound;
      this.goTo(GameStage.NETWORK_RUN);
    }
  }

  onResultsSync(data) {
    if (data.done) {
      this.doneCount = data.doneCount || 0;
      this.totalPlayers = data.totalPlayers || this.totalPlayers;
    }
  }

  onMapChanged(data) {
    applyNetworkMapSelection(this.ctx, data);
  }

  // ===== Update =====

  update(_deltaTime) {}

  // ===== Render =====

  render(mx, my) {
    const { p, gameWidth, gameHeight } = this.ctx;

    p.background(20, 25, 40);

    if (!this.rankedPlayers || this.rankedPlayers.length === 0) {
      p.fill(180);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(8);
      p.text('等待结算数据...', gameWidth / 2, gameHeight / 2);
      return;
    }

    this.renderTitle(p, gameWidth);
    this.renderScoreboard(p, gameWidth, gameHeight);
    if (this.shouldAdvance) {
      this.renderMapAdvance(p, gameWidth, gameHeight);
      this.renderTitles(p, gameWidth, gameHeight);
    }
    this.renderPointsSummary(p, gameWidth, gameHeight);

    this.renderContinueHint(p, gameWidth, gameHeight);
  }

  renderTitle(p, gameWidth) {
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(12);
    p.text('回合结算', gameWidth / 2, 15);
  }

  renderScoreboard(p, gameWidth, gameHeight) {
    const tableX = 80;
    const tableY = 50;
    const colW = [50, 130, 80, 80, 80, 80, 100, 100];
    const headers = ['名次', '玩家', '状态', '时间', '死亡', '金币', '积分', '总积分'];
    const rowH = 32;

    // Header background
    p.fill(30, 40, 65);
    p.noStroke();
    p.rect(tableX, tableY, colW.reduce((a, b) => a + b, 0), rowH, 4, 4, 0, 0);

    // Header text
    p.fill(180, 200, 255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(4.5);
    let cx = tableX;
    for (let i = 0; i < headers.length; i++) {
      p.text(headers[i], cx + colW[i] / 2, tableY + rowH / 2);
      cx += colW[i];
    }

    // Rows
    for (let row = 0; row < this.rankedPlayers.length; row++) {
      const player = this.rankedPlayers[row];
      const y = tableY + rowH * (row + 1);
      const isLocal = player.id === this.networkManager.getPlayerId();
      const isTop = row === 0;

      // Row background
      if (isTop) {
        p.fill(50, 45, 20);
      } else if (isLocal) {
        p.fill(30, 50, 80);
      } else {
        p.fill(row % 2 === 0 ? p.color(25, 30, 50) : p.color(30, 35, 55));
      }
      p.noStroke();
      p.rect(tableX, y, colW.reduce((a, b) => a + b, 0), rowH);

      // Highlight border for local player
      if (isLocal) {
        p.stroke(90, 170, 255);
        p.strokeWeight(1);
        p.noFill();
        p.rect(tableX, y, colW.reduce((a, b) => a + b, 0), rowH);
        p.noStroke();
      }

      // Rank
      const rankColors = [
        [255, 215, 0], [192, 192, 200], [205, 127, 50], [160, 165, 190]
      ];
      p.fill(...(rankColors[row] || [160, 165, 190]));
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5);
      cx = tableX;
      const rankText = row === 0 ? '第1' : row === 1 ? '第2' : row === 2 ? '第3' : `${row + 1}`;
      p.text(rankText, cx + colW[0] / 2, y + rowH / 2);
      cx += colW[0];

      // Player name
      p.fill(isLocal ? p.color(100, 200, 255) : p.color(200, 200, 220));
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(4.5);
      const name = player.name || 'Player';
      const titleTag = this.titles[player.id] ? ` [${this.titles[player.id]}]` : '';
      p.text(this.fitText(name + titleTag, 18), cx + 8, y + rowH / 2);
      cx += colW[1];

      // Status
      p.textAlign(p.CENTER, p.CENTER);
      if (player.finished) {
        p.fill(100, 255, 100);
        p.text('通关', cx + colW[2] / 2, y + rowH / 2);
      } else {
        p.fill(255, 100, 100);
        p.text('失败', cx + colW[2] / 2, y + rowH / 2);
      }
      cx += colW[2];

      // Time
      p.fill(180, 190, 210);
      const timeText = player.finished ? `${player.finishTime || 0}秒` : '--';
      p.text(timeText, cx + colW[3] / 2, y + rowH / 2);
      cx += colW[3];

      // Deaths
      p.fill(player.deaths > 3 ? p.color(255, 100, 100) : p.color(180, 190, 210));
      p.text(`${player.deaths || 0}`, cx + colW[4] / 2, y + rowH / 2);
      cx += colW[4];

      // Coins
      p.fill(255, 215, 0);
      p.text(`${player.coins || 0}`, cx + colW[5] / 2, y + rowH / 2);
      cx += colW[5];

      // Round points
      p.fill(100, 255, 200);
      p.text(`+${player.roundPoints || 0}`, cx + colW[6] / 2, y + rowH / 2);
      cx += colW[6];

      // Total points
      p.fill(255, 200, 100);
      p.textSize(5);
      p.text(`${player.totalPoints || 0}`, cx + colW[7] / 2, y + rowH / 2);
    }
  }

  renderTitles(p, gameWidth, gameHeight) {
    const titleEntries = Object.entries(this.titles);
    if (titleEntries.length === 0) return;

    const titleY = gameHeight - 160;
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(7);
    p.fill(255, 215, 0);
    p.text('— 本回合称号 —', gameWidth / 2, titleY);

    let offsetY = 0;
    for (const [playerId, title] of titleEntries) {
      const player = this.rankedPlayers.find(rp => rp.id === playerId);
      const playerName = player?.name || playerId;
      const isLocal = playerId === this.networkManager.getPlayerId();

      p.fill(isLocal ? p.color(100, 200, 255) : p.color(200, 200, 220));
      p.textSize(5);
      p.text(`${playerName}: ${title}`, gameWidth / 2, titleY + 16 + offsetY);
      offsetY += 14;
    }
  }

  renderPointsSummary(p, gameWidth, gameHeight) {
    const summaryY = gameHeight - 80;
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(5);
    p.fill(180, 190, 210);

    const pointsStr = this.rankedPlayers.map(player => {
      return `${player.name}: ${player.totalPoints || 0}分`;
    }).join('  |  ');
    p.text(pointsStr, gameWidth / 2, summaryY);

    p.textSize(5);
    const text = this.isDone
      ? `已确认，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`
      : '按 Enter 进入下一轮商店';
    p.fill(120, 130, 160);
    p.text('100分进入下一张地图', gameWidth / 2, summaryY + 12);
  }

  renderMapAdvance(p, gameWidth, gameHeight) {
    const panW = 300, panH = 80;
    const panX = gameWidth / 2 - panW / 2;
    const panY = gameHeight / 2 - panH / 2;

    p.fill(0, 0, 0, 150);
    p.noStroke();
    p.rect(0, 0, gameWidth, gameHeight);

    p.fill(20, 30, 50, 240);
    p.rect(panX, panY, panW, panH, 10);
    p.stroke(255, 215, 0);
    p.strokeWeight(2);
    p.noFill();
    p.rect(panX, panY, panW, panH, 10);
    p.noStroke();

    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    p.text('地图升级！', gameWidth / 2, panY + 25);

    p.fill(200, 200, 220);
    p.textSize(5);
    p.text('有人达到100分，进入下一张地图！', gameWidth / 2, panY + 55);
  }

  renderContinueHint(p, gameWidth, gameHeight) {
    p.fill(this.isDone ? p.color(100, 255, 140) : p.color(180, 190, 220));
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(5);
    const text = this.isDone
      ? `已确认，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`
      : '按 Enter 进入下一轮商店';
    p.text(text, gameWidth / 2, gameHeight - 15);
  }

  renderTitle(p, gameWidth) {
    p.fill(255, 215, 0);
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(12);
    p.text('回合结算', gameWidth / 2, 15);
  }

  renderScoreboard(p, gameWidth, gameHeight) {
    void gameHeight;
    const tableX = 80;
    const tableY = 50;
    const colW = [50, 130, 76, 76, 72, 76, 92, 92];
    const headers = ['名次', '玩家', '状态', '时间', '死亡', '金币', '本轮分', '总分'];
    const rowH = 30;
    const tableW = colW.reduce((a, b) => a + b, 0);

    p.noStroke();
    p.fill(30, 40, 65);
    p.rect(tableX, tableY, tableW, rowH, 4, 4, 0, 0);
    p.fill(180, 200, 255);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(4.5);
    let cx = tableX;
    headers.forEach((header, i) => {
      p.text(header, cx + colW[i] / 2, tableY + rowH / 2);
      cx += colW[i];
    });

    this.rankedPlayers.forEach((player, row) => {
      const y = tableY + rowH * (row + 1);
      const isLocal = player.id === this.networkManager.getPlayerId();
      p.fill(row === 0 ? p.color(50, 45, 20) : isLocal ? p.color(30, 50, 80) : p.color(25 + (row % 2) * 5, 30 + (row % 2) * 5, 50 + (row % 2) * 5));
      p.noStroke();
      p.rect(tableX, y, tableW, rowH);

      if (isLocal) {
        p.stroke(90, 170, 255);
        p.strokeWeight(1);
        p.noFill();
        p.rect(tableX, y, tableW, rowH);
        p.noStroke();
      }

      cx = tableX;
      p.fill(row === 0 ? p.color(255, 215, 0) : p.color(190, 196, 215));
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(5);
      p.text(`${row + 1}`, cx + colW[0] / 2, y + rowH / 2);
      cx += colW[0];

      p.fill(isLocal ? p.color(100, 200, 255) : p.color(210, 218, 235));
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(4.6);
      p.text(this.fitText(player.name || '玩家', 16), cx + 8, y + rowH / 2);
      cx += colW[1];

      p.textAlign(p.CENTER, p.CENTER);
      p.fill(player.finished ? p.color(100, 255, 120) : p.color(255, 120, 120));
      p.text(player.finished ? '通关' : '失败', cx + colW[2] / 2, y + rowH / 2);
      cx += colW[2];

      p.fill(180, 190, 210);
      p.text(player.finished ? `${player.finishTime || 0}s` : '--', cx + colW[3] / 2, y + rowH / 2);
      cx += colW[3];
      p.text(`${player.deaths || 0}`, cx + colW[4] / 2, y + rowH / 2);
      cx += colW[4];
      p.fill(255, 215, 0);
      p.text(`${player.coins || 0}`, cx + colW[5] / 2, y + rowH / 2);
      cx += colW[5];
      p.fill(100, 255, 200);
      p.text(`+${player.roundPoints || 0}`, cx + colW[6] / 2, y + rowH / 2);
      cx += colW[6];
      p.fill(255, 200, 100);
      p.text(`${player.totalPoints || 0}`, cx + colW[7] / 2, y + rowH / 2);
    });
  }

  renderMapAdvance(p, gameWidth, gameHeight) {
    const winners = this.rankedPlayers.filter((player) => (player.totalPoints || 0) >= 100);
    const names = winners.length ? winners.map((player) => player.name || '玩家').join('、') : '本局优胜者';
    const y = gameHeight - 230;

    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 225, 120);
    p.textSize(7);
    p.text('优胜者已经诞生', gameWidth / 2, y);
    p.fill(220, 232, 255);
    p.textSize(5.2);
    p.text(names, gameWidth / 2, y + 22);
  }

  renderTitles(p, gameWidth, gameHeight) {
    const entries = Object.entries(this.titles || {});
    if (!entries.length) return;

    const startY = gameHeight - 178;
    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 215, 0);
    p.textSize(6.4);
    p.text('地图称号', gameWidth / 2, startY);

    entries.forEach(([playerId, titles], index) => {
      const player = this.rankedPlayers.find((item) => item.id === playerId);
      const isLocal = playerId === this.networkManager.getPlayerId();
      const titleList = Array.isArray(titles) ? titles : [titles].filter(Boolean);
      p.fill(isLocal ? p.color(100, 200, 255) : p.color(210, 218, 235));
      p.textSize(4.8);
      p.text(`${player?.name || '玩家'}：${titleList.slice(0, 3).join(' / ')}`, gameWidth / 2, startY + 20 + index * 18);
    });
  }

  renderPointsSummary(p, gameWidth, gameHeight) {
    const summaryY = gameHeight - 64;
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(4.8);
    p.fill(180, 190, 210);
    const pointsStr = this.rankedPlayers
      .map((player) => `${player.name}: ${player.totalPoints || 0}分`)
      .join('  |  ');
    p.text(pointsStr, gameWidth / 2, summaryY);
    p.fill(120, 132, 160);
    p.text('100分进入下一张地图', gameWidth / 2, summaryY + 14);
  }

  renderContinueHint(p, gameWidth, gameHeight) {
    p.fill(this.isDone ? p.color(100, 255, 140) : p.color(180, 190, 220));
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(5);
    const next = this.shouldAdvance ? '下一张地图' : '下一轮商店';
    const text = this.isDone
      ? `已确认，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`
      : `按 Enter 进入${next}`;
    p.text(text, gameWidth / 2, gameHeight - 15);
  }

  renderMapAdvance(p, gameWidth, gameHeight) {
    const winners = this.rankedPlayers.filter((player) => (player.totalPoints || 0) >= 100);
    const names = winners.length
      ? winners.map((player) => player.name || '玩家').join('、')
      : '本局优胜者';
    const y = Math.max(176, Math.floor(gameHeight * 0.42));

    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 225, 120);
    p.textSize(7);
    p.text('优胜者已经诞生', gameWidth / 2, y);
    p.fill(220, 232, 255);
    p.textSize(5.2);
    p.text(names, gameWidth / 2, y + 22);
  }

  renderTitles(p, gameWidth, gameHeight) {
    const players = this.rankedPlayers || [];
    if (!players.length) return;

    const panelX = 72;
    const panelW = gameWidth - 144;
    const rowH = players.length > 2 ? 64 : 88;
    const panelY = gameHeight - (players.length * rowH + 30);

    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 215, 0);
    p.textSize(6.4);
    p.text('地图称号汇总', gameWidth / 2, panelY - 18);

    players.forEach((player, index) => {
      const y = panelY + index * rowH;
      const isLocal = player.id === this.networkManager.getPlayerId();
      const entries = Array.isArray(this.titles?.[player.id]) ? this.titles[player.id] : [];

      p.noStroke();
      p.fill(isLocal ? p.color(28, 48, 78, 230) : p.color(20, 28, 44, 220));
      p.rect(panelX, y, panelW, rowH - 8, 6);

      p.fill(isLocal ? p.color(100, 200, 255) : p.color(216, 222, 236));
      p.textAlign(p.LEFT, p.TOP);
      p.textSize(5.2);
      p.text(`${index + 1}. ${player.name || '玩家'}`, panelX + 14, y + 10);

      if (!entries.length) {
        p.fill(135, 145, 170);
        p.textSize(4.4);
        p.text('暂无称号记录', panelX + 14, y + 32);
        return;
      }

      entries.slice(0, 3).forEach((entry, entryIndex) => {
        const lineY = y + 28 + entryIndex * 16;
        p.fill(255, 230, 150);
        p.textSize(4.4);
        p.text(
          `${entryIndex + 1}. ${entry.name}：${entry.description} ${entry.valueText || ''}`,
          panelX + 14,
          lineY,
        );
      });
    });
  }

  renderContinueHint(p, gameWidth, gameHeight) {
    p.fill(this.isDone ? p.color(100, 255, 140) : p.color(180, 190, 220));
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(5);
    const next = this.shouldAdvance ? '下一张地图' : '下一轮商店';
    const text = this.isDone
      ? `已确认，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`
      : `按 Enter 进入${next}`;
    p.text(text, gameWidth / 2, gameHeight - 15);
  }

  renderMapAdvance(p, gameWidth, gameHeight) {
    const winners = this.rankedPlayers.filter((player) => (player.totalPoints || 0) >= 100);
    const names = winners.length
      ? winners.map((player) => player.name || '玩家').join('、')
      : '本局优胜者';
    const y = Math.max(176, Math.floor(gameHeight * 0.42));

    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 225, 120);
    p.textSize(7);
    p.text('优胜者已诞生', gameWidth / 2, y);
    p.fill(220, 232, 255);
    p.textSize(5.2);
    p.text(names, gameWidth / 2, y + 22);
  }

  renderTitles(p, gameWidth, gameHeight) {
    const players = this.rankedPlayers || [];
    if (!players.length) return;

    const panelX = 72;
    const panelW = gameWidth - 144;
    const rowH = players.length > 2 ? 64 : 88;
    const panelY = gameHeight - (players.length * rowH + 30);

    p.textAlign(p.CENTER, p.TOP);
    p.fill(255, 215, 0);
    p.textSize(6.4);
    p.text('地图称号汇总', gameWidth / 2, panelY - 18);

    players.forEach((player, index) => {
      const y = panelY + index * rowH;
      const isLocal = player.id === this.networkManager.getPlayerId();
      const entries = Array.isArray(this.titles?.[player.id]) ? this.titles[player.id] : [];

      p.noStroke();
      p.fill(isLocal ? p.color(28, 48, 78, 230) : p.color(20, 28, 44, 220));
      p.rect(panelX, y, panelW, rowH - 8, 6);

      p.fill(isLocal ? p.color(100, 200, 255) : p.color(216, 222, 236));
      p.textAlign(p.LEFT, p.TOP);
      p.textSize(5.2);
      p.text(`${index + 1}. ${player.name || '玩家'}`, panelX + 14, y + 10);

      if (!entries.length) {
        p.fill(135, 145, 170);
        p.textSize(4.4);
        p.text('暂无称号记录', panelX + 14, y + 32);
        return;
      }

      entries.slice(0, 3).forEach((entry, entryIndex) => {
        const lineY = y + 28 + entryIndex * 16;
        p.fill(255, 230, 150);
        p.textSize(4.4);
        p.text(
          `${entryIndex + 1}. ${entry.name}：${entry.description} ${entry.valueText || ''}`,
          panelX + 14,
          lineY,
        );
      });
    });
  }

  renderContinueHint(p, gameWidth, gameHeight) {
    p.fill(this.isDone ? p.color(100, 255, 140) : p.color(180, 190, 220));
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(5);
    const next = this.shouldAdvance ? '下一张地图' : '下一轮商店';
    const text = this.isDone
      ? `已确认，等待其他玩家... (${this.doneCount}/${this.totalPlayers})`
      : `按 Enter 进入${next}`;
    p.text(text, gameWidth / 2, gameHeight - 15);
  }

  // ===== Helpers =====

  fitText(text, maxChars) {
    const safe = String(text ?? '');
    return safe.length <= maxChars ? safe : `${safe.slice(0, maxChars - 1)}...`;
  }

  isRelevantRound(data) {
    const currentRound = this.ctx.networkRound ?? this.results?.round;
    if (data?.round === undefined || currentRound === undefined) return true;
    return data.round >= currentRound;
  }

  // ===== Input =====

  mousePressed(mx, my) {}

  keyPressed() {
    const { p } = this.ctx;
    if (p.keyCode === p.ESCAPE) {
      this.goTo(GameStage.MENU);
    } else if (p.keyCode === p.ENTER || p.keyCode === 13) {
      if (!this.isDone) {
        this.isDone = true;
        this.doneCount = Math.max(this.doneCount, 1);
        this.networkManager.resultsDone?.();
      }

      const pendingShop = this.ctx.pendingShopPhase;
      if (!this.shouldAdvance && pendingShop && this.isRelevantRound(pendingShop)) {
        this.onShopPhaseStart(pendingShop);
      }
    }
  }
}
