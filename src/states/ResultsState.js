import { State } from './State.js';
import { GameStage } from '../config/GameStage.js';
import { Scoreboard } from '../ui/Scoreboard.js';
import { GameOverScreen } from '../ui/GameOverScreen.js';
import { LeaderboardManager } from '../systems/LeaderboardManager.js';

/**
 * ResultsState — end-of-round scoreboard screen with titles and points.
 */
export class ResultsState extends State {
    enter() {
        const { p, gameWidth, gameHeight, players, scoreManager, mapKey } = this.ctx;
        this._isFinalRound = scoreManager.currentRound >= scoreManager.maxRounds;
        this.scoreboard = this._isFinalRound
            ? new GameOverScreen(p, gameWidth, gameHeight)
            : new Scoreboard(p, gameWidth, gameHeight);

        // Calculate titles for this round
        this._titles = scoreManager.calculateTitles(players);

        // Record this round to the leaderboard
        const key = mapKey ?? 'map1';
        LeaderboardManager.record(key, players, scoreManager);
        this._leaderboard = LeaderboardManager.get(key);
        this._mapKey = key;
        this._showLB = false;

        // Check if should advance map
        this._shouldAdvance = scoreManager.shouldAdvanceMap();
    }

    render(mx, my) {
        const { p, gameWidth, gameHeight, players, scoreManager } = this.ctx;

        // Render scoreboard
        this.scoreboard.render(scoreManager, players);

        // Show titles ONLY when advancing to next map (at 100 points)
        if (this._shouldAdvance) {
            this._renderTitles(p, gameWidth, gameHeight, players);
            this._renderMapAdvance(p, gameWidth, gameHeight);
        }

        // Show points summary
        this._renderPointsSummary(p, gameWidth, gameHeight, players, scoreManager);

        // Leaderboard toggle button
        if (this._isFinalRound) return;

        const btnW = 120, btnH = 28;
        const btnX = gameWidth - btnW - 10;
        const btnY = 10;
        const hov = mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH;
        p.noStroke();
        p.fill(hov ? [50, 80, 140] : [35, 55, 105]);
        p.rect(btnX, btnY, btnW, btnH, 5);
        p.fill(180, 200, 255);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(6.6);
        p.text(this._showLB ? '关闭排行' : '排行榜', btnX + btnW / 2, btnY + btnH / 2);

        if (!this._showLB) return;

        // Leaderboard panel
        const panW = 360, panH = 250;
        const panX = gameWidth / 2 - panW / 2;
        const panY = gameHeight / 2 - panH / 2;

        p.fill(14, 18, 32, 240);
        p.noStroke();
        p.rect(panX, panY, panW, panH, 10);
        p.stroke(60, 90, 160);
        p.strokeWeight(1.5);
        p.noFill();
        p.rect(panX, panY, panW, panH, 10);
        p.noStroke();

        p.fill(255, 215, 0);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(10);
        p.text(`${this._mapKey?.toUpperCase() ?? 'MAP'} 排行榜`, gameWidth / 2, panY + 14);

        p.stroke(45, 60, 110);
        p.strokeWeight(1);
        p.line(panX + 20, panY + 40, panX + panW - 20, panY + 40);
        p.noStroke();

        p.fill(120, 130, 170);
        p.textSize(5.8);
        p.textAlign(p.LEFT, p.TOP);
        p.text('排名', panX + 18, panY + 46);
        p.text('玩家', panX + 58, panY + 46);
        p.text('用时', panX + 198, panY + 46);
        p.text('日期', panX + 255, panY + 46);

        const entries = this._leaderboard;
        if (entries.length === 0) {
            p.fill(80, 85, 120);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(7.5);
            p.text('暂无记录', gameWidth / 2, panY + 140);
        } else {
            entries.forEach((entry, i) => {
                const ey = panY + 62 + i * 18;
                p.fill(i === 0 ? [255, 215, 0] : i === 1 ? [192, 192, 200] : i === 2 ? [205, 127, 50] : [160, 165, 190]);
                p.textSize(6.6);
                p.textAlign(p.LEFT, p.TOP);
                const medal = i === 0 ? '第1' : i === 1 ? '第2' : i === 2 ? '第3' : `${i + 1}.`;
                p.text(medal, panX + 14, ey);
                p.text(this._fitText(entry.name, 13), panX + 58, ey);
                p.fill(180, 230, 180);
                p.text(`${entry.time}s`, panX + 198, ey);
                p.fill(120, 130, 160);
                p.text(this._fitText(entry.date, 10), panX + 255, ey);
            });
        }
    }

    _renderTitles(p, gameWidth, gameHeight, players) {
        if (!this._titles || this._titles.size === 0) return;

        const titleY = gameHeight - 120;
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(7);
        p.fill(255, 215, 0);
        p.text('— 本回合称号 —', gameWidth / 2, titleY);

        let offsetY = 0;
        for (const [playerNo, title] of this._titles) {
            const playerName = `P${playerNo + 1}`;
            const col = playerNo === 0 ? p.color(90, 170, 255) : p.color(255, 200, 80);
            p.fill(col);
            p.textSize(6);
            p.text(`${playerName}: ${title}`, gameWidth / 2, titleY + 16 + offsetY);
            offsetY += 14;
        }
    }

    _renderPointsSummary(p, gameWidth, gameHeight, players, scoreManager) {
        const summaryY = gameHeight - 60;
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(6);
        p.fill(180, 190, 210);

        const pointsStr = players.map(pl => {
            const points = scoreManager.getPoints(pl.playerNo);
            const total = scoreManager.getTotalPoints(pl.playerNo);
            return `P${pl.playerNo + 1}: ${points}分 (总${total}分)`;
        }).join('  |  ');
        p.text(pointsStr, gameWidth / 2, summaryY);

        p.textSize(5);
        p.fill(120, 130, 160);
        p.text('100分进入下一张地图', gameWidth / 2, summaryY + 14);
    }

    _renderMapAdvance(p, gameWidth, gameHeight) {
        const panW = 300, panH = 100;
        const panX = gameWidth / 2 - panW / 2;
        const panY = gameHeight / 2 - panH / 2;

        p.fill(0, 0, 0, 180);
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
        p.textSize(12);
        p.text('地图升级！', gameWidth / 2, panY + 30);

        p.fill(200, 200, 220);
        p.textSize(7);
        p.text('有人达到100分，进入下一张地图！', gameWidth / 2, panY + 60);
    }

    mousePressed(mx, my) {
        if (this._isFinalRound) return;

        const { gameWidth } = this.ctx;
        const btnW = 120, btnH = 28;
        const btnX = gameWidth - btnW - 10;
        if (mx >= btnX && mx <= btnX + btnW && my >= 10 && my <= 10 + btnH) {
            this._showLB = !this._showLB;
        }
    }

    keyPressed() {
        const { p } = this.ctx;
        if (p.key === 'l' || p.key === 'L') {
            if (this._isFinalRound) return;
            this._showLB = !this._showLB;
        } else if (p.keyCode === p.ENTER || p.keyCode === 13) {
            if (this._shouldAdvance) {
                this.ctx.scoreManager.advanceMap(this.ctx);
                // Auto-generate a new random map
                this.ctx.mapManager?.generateRandomMap?.(this.ctx.mapKey, this.ctx);
                this.goTo(GameStage.SHOP);
            } else {
                this.goTo(GameStage.SHOP);
            }
        }
    }

    _fitText(text, maxChars) {
        const safe = String(text ?? '');
        return safe.length <= maxChars ? safe : `${safe.slice(0, maxChars - 1)}…`;
    }
}
