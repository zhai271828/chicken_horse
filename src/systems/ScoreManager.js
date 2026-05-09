import { GameConfig } from '../config/GameConfig.js';
import { PlayerScore } from '../models/PlayerScore.js';

/**
 * ScoreManager — manages scoring, points, and map progression.
 *
 * New scoring rules:
 *   - 2 coins = 1 point
 *   - Rainbow coin = 10 coins = 5 points
 *   - Trap kill = +2 points (to trap owner)
 *   - Kill all other players = +3 points
 *   - Only finisher = +5 points
 *   - Finish without death = +3 points
 *
 * Map progression: 100 points to advance to next map
 */
export class ScoreManager {
    constructor(players) {
        this.currentRound = 0;
        this.maxRounds = 999; // No limit, progress by points
        this.wallet = new Map(players.map((p) => [p.playerNo, 0]));
        this.roundCoins = new Map(players.map((p) => [p.playerNo, 0]));
        this.points = new Map(players.map((p) => [p.playerNo, 0]));
        this.totalPoints = new Map(players.map((p) => [p.playerNo, 0]));

        this.scores = new Map(
            players.map((p) => [p.playerNo, new PlayerScore(p.playerNo)]),
        );

        // Track trap ownership for kill attribution
        this.trapOwners = new Map(); // obstacleId -> playerNo

        // Map progression
        this.pointsToAdvance = 100;
        this.currentMapIndex = 0;
        this.mapAdvances = 0;

        // Title tracking
        this.titleHistory = new Map(); // playerNo -> Set of titles
    }

    // ─── Points ─────────────────────────────────────────────────────────────

    addPoints(playerNo, amount) {
        const current = this.points.get(playerNo) ?? 0;
        this.points.set(playerNo, current + amount);
        const total = this.totalPoints.get(playerNo) ?? 0;
        this.totalPoints.set(playerNo, total + amount);
    }

    getPoints(playerNo) {
        return this.points.get(playerNo) ?? 0;
    }

    getTotalPoints(playerNo) {
        return this.totalPoints.get(playerNo) ?? 0;
    }

    // ─── Trap ownership ─────────────────────────────────────────────────────

    registerTrap(obstacle, playerNo) {
        if (obstacle._obstacleId) {
            this.trapOwners.set(obstacle._obstacleId, playerNo);
        }
    }

    getTrapOwner(obstacle) {
        return this.trapOwners.get(obstacle._obstacleId);
    }

    // ─── Coin collection ────────────────────────────────────────────────────

    collectCoin(player, coin) {
        const current = this.roundCoins.get(player.playerNo) ?? 0;
        const coinValue = coin.value || 1;
        this.roundCoins.set(player.playerNo, current + coinValue);

        // Add points: 2 coins = 1 point
        const points = Math.floor(coinValue / 2);
        if (points > 0) {
            this.addPoints(player.playerNo, points);
        }

        // Track special coins
        if (coin.isRainbow) {
            const score = this.scores.get(player.playerNo);
            if (score) score.specialCoins++;
            // Rainbow coin gives 5 points directly
            this.addPoints(player.playerNo, 5);
        }
    }

    // ─── Death tracking ─────────────────────────────────────────────────────

    recordDeath(player, killerPlayerNo = null) {
        const score = this.scores.get(player.playerNo);
        if (!score) return;

        score.deaths++;

        // Track consecutive deaths
        const now = Date.now();
        if (now - score.lastDeathTime < 10000) {
            score.consecutiveDeaths++;
        } else {
            score.consecutiveDeaths = 1;
        }
        score.lastDeathTime = now;

        // Track who killed this player
        if (killerPlayerNo !== null && killerPlayerNo !== player.playerNo) {
            const count = score.killedBy.get(killerPlayerNo) ?? 0;
            score.killedBy.set(killerPlayerNo, count + 1);

            // Give points to killer
            this.addPoints(killerPlayerNo, 2);
            const killerScore = this.scores.get(killerPlayerNo);
            if (killerScore) killerScore.kills++;
        }
    }

    // ─── Finish ─────────────────────────────────────────────────────────────

    onPlayerFinish(player, rank, elapsedSecs, allPlayers, finishers) {
        const reward = GameConfig.FINISH_REWARDS[rank - 1] ?? 0;
        const coins = this.roundCoins.get(player.playerNo) ?? 0;
        const prev = this.wallet.get(player.playerNo) ?? 0;
        const newWallet = prev + reward + coins;

        this.wallet.set(player.playerNo, newWallet);
        this.roundCoins.set(player.playerNo, 0);

        const score = this.scores.get(player.playerNo);
        score.finished = true;
        score.finishTime = elapsedSecs;
        score.coins = coins;
        score.wallet = newWallet;

        // Points for finishing
        if (rank === 1 && finishers === 1) {
            // Only finisher
            this.addPoints(player.playerNo, 5);
            score.onlyFinisher = true;
        }

        if (score.deaths === 0) {
            // Finish without death
            this.addPoints(player.playerNo, 3);
            score.finishWithoutDeath = true;
        }

        // Reset consecutive failures
        score.consecutiveFailures = 0;
    }

    onPlayerFail(player) {
        const lost = this.roundCoins.get(player.playerNo) ?? 0;
        const wallet = this.wallet.get(player.playerNo) ?? 0;

        this.roundCoins.set(player.playerNo, 0);

        const score = this.scores.get(player.playerNo);
        score.finished = false;
        score.coins = lost;
        score.wallet = wallet;
        score.consecutiveFailures++;
    }

    // ─── Map progression ────────────────────────────────────────────────────

    shouldAdvanceMap() {
        // Check if any player reached 100 points
        for (const [playerNo, points] of this.points) {
            if (points >= this.pointsToAdvance) {
                return true;
            }
        }
        return false;
    }

    advanceMap() {
        this.mapAdvances++;
        this.currentMapIndex = (this.currentMapIndex + 1) % 2; // Toggle between 2 maps
        // Reset points for next map
        for (const [playerNo] of this.points) {
            this.points.set(playerNo, 0);
        }
    }

    // ─── Titles ─────────────────────────────────────────────────────────────

    calculateTitles(players) {
        const titles = new Map();
        const allScores = [...this.scores.values()];

        // MVP - highest total points
        let mvpPlayer = null;
        let mvpPoints = -1;
        for (const [playerNo, total] of this.totalPoints) {
            if (total > mvpPoints) {
                mvpPoints = total;
                mvpPlayer = playerNo;
            }
        }
        if (mvpPlayer !== null) titles.set(mvpPlayer, 'MVP');

        // 速通之神 - shortest average finish time
        // 金币大盗 - most coins collected
        // 宝藏猎人 - most rainbow coins
        // 生存大师 - fewest deaths
        // 极限跑者 - most last-second finishes
        // 逃课王 - fewest jumps to finish
        // 不死鸟 - consecutive revive then finish
        // 地图污染者 - most traps placed

        // 天选倒霉蛋 - most deaths
        let maxDeaths = 0;
        let unluckyPlayer = null;
        for (const score of allScores) {
            if (score.deaths > maxDeaths) {
                maxDeaths = score.deaths;
                unluckyPlayer = score.playerNo;
            }
        }
        if (unluckyPlayer !== null && maxDeaths >= 3) {
            titles.set(unluckyPlayer, '天选倒霉蛋');
        }

        // 一步之遥 - most deaths near finish
        // 陷阱测试员 - killed by most unique trap types
        // 今日受害者 - killed by same player most
        let maxSameKiller = 0;
        let victimPlayer = null;
        for (const score of allScores) {
            for (const [killer, count] of score.killedBy) {
                if (count > maxSameKiller) {
                    maxSameKiller = count;
                    victimPlayer = score.playerNo;
                }
            }
        }
        if (victimPlayer !== null && maxSameKiller >= 3) {
            titles.set(victimPlayer, '今日受害者');
        }

        // 反复去世 - 3+ deaths in 10 seconds
        for (const score of allScores) {
            if (score.consecutiveDeaths >= 3) {
                titles.set(score.playerNo, '反复去世');
            }
        }

        // 我不玩了 - most consecutive failures
        let maxFailures = 0;
        let quitterPlayer = null;
        for (const score of allScores) {
            if (score.consecutiveFailures > maxFailures) {
                maxFailures = score.consecutiveFailures;
                quitterPlayer = score.playerNo;
            }
        }
        if (quitterPlayer !== null && maxFailures >= 3) {
            titles.set(quitterPlayer, '我不玩了');
        }

        // 真不怕死 - 5 deaths in 1 minute
        // 人类奇迹 - only you finished
        for (const score of allScores) {
            if (score.onlyFinisher) {
                titles.set(score.playerNo, '人类奇迹');
            }
        }

        // 全靠运气 - rainbow coin 2+ rounds in a row
        // 就差一点 - consecutive deaths near finish

        return titles;
    }

    // ─── Ranking ────────────────────────────────────────────────────────────

    getRankedScores() {
        const all = [...this.scores.values()];
        const finished = all
            .filter((s) => s.finished)
            .sort((a, b) => a.finishTime - b.finishTime);
        const failed = all
            .filter((s) => !s.finished)
            .sort((a, b) => b.coins - a.coins);
        const ranked = [...finished, ...failed];
        ranked.forEach((s, i) => {
            s.rank = i + 1;
        });
        return ranked;
    }

    // ─── Accessors ──────────────────────────────────────────────────────────

    getWallet(player) {
        return this.wallet.get(player.playerNo) ?? 0;
    }

    spendWallet(player, amount) {
        const current = this.wallet.get(player.playerNo) ?? 0;
        if (current < amount) return false;
        this.wallet.set(player.playerNo, current - amount);
        return true;
    }

    getRoundCoins(player) {
        return this.roundCoins.get(player.playerNo) ?? 0;
    }

    getScore(player) {
        return this.scores.get(player.playerNo);
    }

    // ─── Reset ──────────────────────────────────────────────────────────────

    resetRound({ advanceRound = true } = {}) {
        if (advanceRound) {
            this.currentRound++;
        }
        for (const [playerNo] of this.roundCoins) {
            this.roundCoins.set(playerNo, 0);
            this.scores.set(playerNo, new PlayerScore(playerNo));
        }
        this.trapOwners.clear();
    }
}
