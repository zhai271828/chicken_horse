import { GameConfig } from '../config/GameConfig.js';
import { PlayerScore } from '../models/PlayerScore.js';
import {
    TITLE_DEFINITION_MAP,
} from '../config/titles/TitleRegistry.js';

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
        this.rainbowCoins = new Map(players.map((p) => [p.playerNo, 0]));
        this.points = new Map(players.map((p) => [p.playerNo, 0])); // accumulated on current map
        this.totalPoints = new Map(players.map((p) => [p.playerNo, 0])); // all-time total
        this.roundPoints = new Map(players.map((p) => [p.playerNo, 0])); // this round only

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
        this.titleHistory = new Map(); // legacy field
        this.titleCounts = new Map(
            players.map((p) => [p.playerNo, new Map()]),
        );
        this.careerStats = new Map(
            players.map((p) => [p.playerNo, this._createCareerStats()]),
        );
        this.titleProgress = new Map(
            players.map((p) => [p.playerNo, this._createTitleProgress()]),
        );
        this.lastRoundTitleHits = new Map();

        // Stuck detection: consecutive rounds where nobody finishes
        this.consecutiveNoFinish = 0;
    }

    _createTitleProgress() {
        return {
            finishTimes: [],
            consecutiveFailures: 0,
            rainbowCoinStreak: 0,
            deathTimestamps: [],
        };
    }

    _createCareerStats() {
        return {
            totalDeaths: 0,
            totalCoins: 0,
            totalRainbowCoins: 0,
            totalKills: 0,
            totalTrapsPlaced: 0,
            onlyFinisherCount: 0,
            finishWithoutDeathCount: 0,
            reviveFinishCount: 0,
            nearFinishDeaths: 0,
            repeatDeathEvents: 0,
            clutchFinishes: 0,
            bestJumpFinish: Infinity,
            finishTimes: [],
            uniqueTrapDeaths: new Set(),
            maxKilledBySamePlayer: 0,
            maxConsecutiveFailures: 0,
            maxRainbowStreak: 0,
            maxDeathsInMinute: 0,
            closeCallEvents: 0,
        };
    }

    _getTitleProgress(playerNo) {
        if (!this.titleProgress.has(playerNo)) {
            this.titleProgress.set(playerNo, this._createTitleProgress());
        }
        return this.titleProgress.get(playerNo);
    }

    _getCareerStats(playerNo) {
        if (!this.careerStats.has(playerNo)) {
            this.careerStats.set(playerNo, this._createCareerStats());
        }
        return this.careerStats.get(playerNo);
    }

    _getTitleCountMap(playerNo) {
        if (!this.titleCounts.has(playerNo)) {
            this.titleCounts.set(playerNo, new Map());
        }
        return this.titleCounts.get(playerNo);
    }

    _addTitleHit(playerNo, titleKey) {
        const counts = this._getTitleCountMap(playerNo);
        counts.set(titleKey, (counts.get(titleKey) ?? 0) + 1);
    }

    // ─── Points ─────────────────────────────────────────────────────────────

    addPoints(playerNo, amount) {
        const current = this.points.get(playerNo) ?? 0;
        this.points.set(playerNo, current + amount);
        const total = this.totalPoints.get(playerNo) ?? 0;
        this.totalPoints.set(playerNo, total + amount);
        const round = this.roundPoints.get(playerNo) ?? 0;
        this.roundPoints.set(playerNo, round + amount);
    }

    getPoints(playerNo) {
        return this.points.get(playerNo) ?? 0;
    }

    getTotalPoints(playerNo) {
        return this.totalPoints.get(playerNo) ?? 0;
    }

    getRoundPoints(playerNo) {
        return this.roundPoints.get(playerNo) ?? 0;
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

    recordTrapPlacement(playerNo) {
        const score = this.scores.get(playerNo);
        if (score) {
            score.trapsPlaced++;
        }
        this._getCareerStats(playerNo).totalTrapsPlaced++;
    }

    // ─── Coin collection ────────────────────────────────────────────────────

    collectCoin(player, coin) {
        const prevCoins = this.roundCoins.get(player.playerNo) ?? 0;
        const coinValue = coin.value || 1;
        const newCoins = prevCoins + coinValue;
        this.roundCoins.set(player.playerNo, newCoins);
        this._getCareerStats(player.playerNo).totalCoins += coinValue;

        // Add points: every 2 coins = 1 point (cumulative)
        const prevPointsFromCoins = Math.floor(prevCoins / 2);
        const newPointsFromCoins = Math.floor(newCoins / 2);
        const deltaPoints = newPointsFromCoins - prevPointsFromCoins;
        if (deltaPoints > 0) {
            this.addPoints(player.playerNo, deltaPoints);
        }

        // Rainbow coin gives +5 points directly
        if (coin.isRainbow) {
            const score = this.scores.get(player.playerNo);
            if (score) score.specialCoins++;
            this.rainbowCoins.set(
                player.playerNo,
                (this.rainbowCoins.get(player.playerNo) ?? 0) + 1,
            );
            this._getCareerStats(player.playerNo).totalRainbowCoins++;
            this.addPoints(player.playerNo, 5);
        }
    }

    // ─── Death tracking ─────────────────────────────────────────────────────

    recordDeath(player, killerPlayerNo = null, trapType = null) {
        const score = this.scores.get(player.playerNo);
        if (!score) return;

        score.deaths++;
        const career = this._getCareerStats(player.playerNo);
        career.totalDeaths++;

        // Track consecutive deaths
        const now = Date.now();
        if (now - score.lastDeathTime < 10000) {
            score.consecutiveDeaths++;
        } else {
            score.consecutiveDeaths = 1;
        }
        if (score.consecutiveDeaths === 3) {
            career.repeatDeathEvents++;
        }
        score.lastDeathTime = now;
        this._getTitleProgress(player.playerNo).deathTimestamps = [
            ...this._getTitleProgress(player.playerNo).deathTimestamps,
            now,
        ].filter((t) => now - t < 60000);
        career.maxDeathsInMinute = Math.max(
            career.maxDeathsInMinute,
            this._getTitleProgress(player.playerNo).deathTimestamps.length,
        );

        // Track death timestamps for "真不怕死" (5 deaths in 1 minute)
        if (!score.deathTimestamps) score.deathTimestamps = [];
        score.deathTimestamps.push(now);
        // Keep only last 60 seconds
        score.deathTimestamps = score.deathTimestamps.filter(t => now - t < 60000);
        score.deathsInLastMinute = score.deathTimestamps.length;

        // Track who killed this player
        if (killerPlayerNo !== null && killerPlayerNo !== player.playerNo) {
            const count = score.killedBy.get(killerPlayerNo) ?? 0;
            score.killedBy.set(killerPlayerNo, count + 1);
            career.maxKilledBySamePlayer = Math.max(
                career.maxKilledBySamePlayer,
                count + 1,
            );

            // Give points to killer
            this.addPoints(killerPlayerNo, 2);
            const killerScore = this.scores.get(killerPlayerNo);
            if (killerScore) killerScore.kills++;
            this._getCareerStats(killerPlayerNo).totalKills++;
        }

        // Track trap types that killed this player (陷阱测试员)
        if (trapType) {
            score.trapTypesKilled.add(trapType);
            career.uniqueTrapDeaths.add(trapType);
        }
    }

    recordJump(player) {
        const score = this.scores.get(player.playerNo);
        if (score) {
            score.jumpCount++;
        }
    }

    recordNearFinishDeath(player) {
        const score = this.scores.get(player.playerNo);
        if (score) {
            score.deathBeforeFinish++;
        }
        const career = this._getCareerStats(player.playerNo);
        career.nearFinishDeaths++;
        if ((score?.deathBeforeFinish ?? 0) >= 2 && (score?.consecutiveDeaths ?? 0) >= 2) {
            career.closeCallEvents++;
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
        const career = this._getCareerStats(player.playerNo);

        // Points for finishing
        if (rank === 1 && finishers === 1) {
            // Only finisher
            this.addPoints(player.playerNo, 5);
            score.onlyFinisher = true;
            career.onlyFinisherCount++;
        }

        if (score.deaths === 0) {
            // Finish without death
            this.addPoints(player.playerNo, 3);
            score.finishWithoutDeath = true;
            career.finishWithoutDeathCount++;
        }

        if (score.deaths > 0) {
            score.reviveThenFinish = true;
            career.reviveFinishCount++;
        }

        career.finishTimes.push(elapsedSecs);
        if (GameConfig.TIME_LIMIT - elapsedSecs <= 10) {
            career.clutchFinishes++;
        }
        if (score.jumpCount > 0) {
            career.bestJumpFinish = Math.min(career.bestJumpFinish, score.jumpCount);
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
        this._getCareerStats(player.playerNo).maxConsecutiveFailures = Math.max(
            this._getCareerStats(player.playerNo).maxConsecutiveFailures,
            score.consecutiveFailures,
        );
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

    advanceMap(ctx) {
        this.mapAdvances++;
        this.currentMapIndex = (this.currentMapIndex + 1) % 2; // Toggle between 2 maps
        // Reset points for next map
        for (const [playerNo] of this.points) {
            this.points.set(playerNo, 0);
        }
        for (const [playerNo] of this.rainbowCoins) {
            this.rainbowCoins.set(playerNo, 0);
        }
        for (const [playerNo] of this.titleCounts) {
            this.titleCounts.set(playerNo, new Map());
        }
        for (const [playerNo] of this.careerStats) {
            this.careerStats.set(playerNo, this._createCareerStats());
        }
        for (const [playerNo] of this.titleProgress) {
            this.titleProgress.set(playerNo, this._createTitleProgress());
        }
        this.lastRoundTitleHits = new Map();
        // Clear all traps and ownership when map changes
        this.trapOwners.clear();
        if (ctx?.placedObstacles) {
            ctx.placedObstacles.length = 0;
        }
    }

    // ─── Titles ─────────────────────────────────────────────────────────────

    /**
     * Title weights: higher = higher priority when player qualifies for multiple.
     * Entertainment-focused: absurd/funny titles rank higher.
     */
    static TITLE_WEIGHTS = {
        '真不怕死': 100,   // 1min 5 deaths — most entertaining
        '反复去世': 95,    // 3 deaths in 10s
        '全靠运气': 90,    // rainbow coin streak
        '人类奇迹': 85,    // only finisher
        '我不玩了': 80,    // consecutive failures
        '天选倒霉蛋': 75,  // most deaths overall
        '就差一点': 70,    // consecutive deaths near finish
        '今日受害者': 65,  // killed by same player
        '一步之遥': 60,    // deaths near finish line
        '陷阱测试员': 55,  // killed by many trap types
        '不死鸟': 50,      // revive then finish
        '地图污染者': 45,  // most traps placed
        '逃课王': 40,      // fewest jumps to finish
        '极限跑者': 35,    // last-second finishes
        '速通之神': 30,    // shortest average time
        '宝藏猎人': 25,    // most rainbow coins
        '金币大盗': 20,    // most coins collected
        'MVP': 15,         // highest total points (least fun but important)
        '生存大师': 10,    // fewest deaths (least funny)
    };

    calculateTitles(players) {
        const titles = new Map(); // playerNo -> best title (highest weight)
        const allScores = [...this.scores.values()];

        // Helper: set title only if weight is higher than current
        const setBestTitle = (playerNo, title) => {
            const currentTitle = titles.get(playerNo);
            const currentWeight = currentTitle ? (ScoreManager.TITLE_WEIGHTS[currentTitle] ?? 0) : 0;
            const newWeight = ScoreManager.TITLE_WEIGHTS[title] ?? 0;
            if (newWeight > currentWeight) {
                titles.set(playerNo, title);
            }
        };

        // 1. MVP - highest total points
        let mvpPlayer = null;
        let mvpPoints = -1;
        for (const [playerNo, total] of this.points) {
            if (total > mvpPoints) {
                mvpPoints = total;
                mvpPlayer = playerNo;
            }
        }
        if (mvpPlayer !== null) setBestTitle(mvpPlayer, 'MVP');

        // 2. 速通之神 - shortest average finish time (requires persistent tracking)
        // Skip: needs cross-round average tracking

        // 3. 金币大盗 - most coins collected this round
        let maxCoins = 0;
        let coinThief = null;
        for (const score of allScores) {
            if (score.coins > maxCoins) {
                maxCoins = score.coins;
                coinThief = score.playerNo;
            }
        }
        if (coinThief !== null && maxCoins >= 5) {
            setBestTitle(coinThief, '金币大盗');
        }

        // 4. 宝藏猎人 - most rainbow coins
        let maxRainbow = 0;
        let treasureHunter = null;
        for (const score of allScores) {
            if (score.specialCoins > maxRainbow) {
                maxRainbow = score.specialCoins;
                treasureHunter = score.playerNo;
            }
        }
        if (treasureHunter !== null && maxRainbow >= 1) {
            setBestTitle(treasureHunter, '宝藏猎人');
        }

        // 5. 生存大师 - fewest deaths (among players who finished)
        let minDeaths = Infinity;
        let survivalMaster = null;
        for (const score of allScores) {
            if (score.finished && score.deaths < minDeaths) {
                minDeaths = score.deaths;
                survivalMaster = score.playerNo;
            }
        }
        if (survivalMaster !== null && minDeaths === 0) {
            setBestTitle(survivalMaster, '生存大师');
        }

        // 6. 极限跑者 - last-second finishes (within 10s of timeout)
        // Skip: needs timeout proximity tracking

        // 7. 逃课王 - fewest jumps to finish
        let minJumps = Infinity;
        let jumpMaster = null;
        for (const score of allScores) {
            if (score.finished && score.jumpCount > 0 && score.jumpCount < minJumps) {
                minJumps = score.jumpCount;
                jumpMaster = score.playerNo;
            }
        }
        if (jumpMaster !== null && minJumps <= 10) {
            setBestTitle(jumpMaster, '逃课王');
        }

        // 8. 不死鸟 - revived then finished
        for (const score of allScores) {
            if (score.reviveThenFinish) {
                setBestTitle(score.playerNo, '不死鸟');
            }
        }

        // 9. 地图污染者 - most traps placed
        let maxTraps = 0;
        let polluter = null;
        for (const score of allScores) {
            if (score.trapsPlaced > maxTraps) {
                maxTraps = score.trapsPlaced;
                polluter = score.playerNo;
            }
        }
        if (polluter !== null && maxTraps >= 5) {
            setBestTitle(polluter, '地图污染者');
        }

        // 10. 天选倒霉蛋 - most deaths
        let maxDeaths = 0;
        let unluckyPlayer = null;
        for (const score of allScores) {
            if (score.deaths > maxDeaths) {
                maxDeaths = score.deaths;
                unluckyPlayer = score.playerNo;
            }
        }
        if (unluckyPlayer !== null && maxDeaths >= 3) {
            setBestTitle(unluckyPlayer, '天选倒霉蛋');
        }

        // 11. 一步之遥 - deaths near finish line
        let maxFinishDeaths = 0;
        let almostPlayer = null;
        for (const score of allScores) {
            if (score.deathBeforeFinish > maxFinishDeaths) {
                maxFinishDeaths = score.deathBeforeFinish;
                almostPlayer = score.playerNo;
            }
        }
        if (almostPlayer !== null && maxFinishDeaths >= 2) {
            setBestTitle(almostPlayer, '一步之遥');
        }

        // 12. 陷阱测试员 - killed by most unique trap types
        let maxTrapTypes = 0;
        let trapTester = null;
        for (const score of allScores) {
            if (score.trapTypesKilled.size > maxTrapTypes) {
                maxTrapTypes = score.trapTypesKilled.size;
                trapTester = score.playerNo;
            }
        }
        if (trapTester !== null && maxTrapTypes >= 3) {
            setBestTitle(trapTester, '陷阱测试员');
        }

        // 13. 今日受害者 - killed by same player most
        let maxSameKiller = 0;
        let victimPlayer = null;
        for (const score of allScores) {
            for (const [, count] of score.killedBy) {
                if (count > maxSameKiller) {
                    maxSameKiller = count;
                    victimPlayer = score.playerNo;
                }
            }
        }
        if (victimPlayer !== null && maxSameKiller >= 3) {
            setBestTitle(victimPlayer, '今日受害者');
        }

        // 14. 反复去世 - 3+ deaths in 10 seconds
        for (const score of allScores) {
            if (score.consecutiveDeaths >= 3) {
                setBestTitle(score.playerNo, '反复去世');
            }
        }

        // 15. 我不玩了 - most consecutive failures
        let maxFailures = 0;
        let quitterPlayer = null;
        for (const score of allScores) {
            if (score.consecutiveFailures > maxFailures) {
                maxFailures = score.consecutiveFailures;
                quitterPlayer = score.playerNo;
            }
        }
        if (quitterPlayer !== null && maxFailures >= 3) {
            setBestTitle(quitterPlayer, '我不玩了');
        }

        // 16. 真不怕死 - 5 deaths in 1 minute
        const now = Date.now();
        for (const score of allScores) {
            const recentDeaths = (score.deathTimestamps || []).filter(t => now - t < 60000);
            if (recentDeaths.length >= 5) {
                setBestTitle(score.playerNo, '真不怕死');
            }
        }

        // 17. 人类奇迹 - only you finished
        for (const score of allScores) {
            if (score.onlyFinisher) {
                setBestTitle(score.playerNo, '人类奇迹');
            }
        }

        // 18. 全靠运气 - rainbow coin 2+ rounds in a row
        for (const score of allScores) {
            if (score.rainbowCoinStreak >= 2) {
                setBestTitle(score.playerNo, '全靠运气');
            }
        }

        // 19. 就差一点 - consecutive deaths near finish
        for (const score of allScores) {
            if (score.deathBeforeFinish >= 2 && score.consecutiveDeaths >= 2) {
                setBestTitle(score.playerNo, '就差一点');
            }
        }

        return titles;
    }

    recordRoundTitleProgress(_players = []) {
        const roundScores = [...this.scores.values()];
        const titleHits = new Map();
        const award = (playerNo, titleKey) => {
            if (!TITLE_DEFINITION_MAP[titleKey]) return;
            if (!titleHits.has(playerNo)) titleHits.set(playerNo, new Set());
            titleHits.get(playerNo).add(titleKey);
        };

        for (const score of roundScores) {
            const progress = this._getTitleProgress(score.playerNo);
            const career = this._getCareerStats(score.playerNo);
            if (score.finished && score.finishTime !== null) {
                progress.finishTimes.push(score.finishTime);
            }
            progress.consecutiveFailures = score.finished
                ? 0
                : progress.consecutiveFailures + 1;
            progress.rainbowCoinStreak = score.specialCoins > 0
                ? progress.rainbowCoinStreak + 1
                : 0;
            career.maxRainbowStreak = Math.max(
                career.maxRainbowStreak,
                progress.rainbowCoinStreak,
            );
            progress.deathTimestamps = (progress.deathTimestamps || []).filter(
                (t) => Date.now() - t < 60000,
            );
        }

        const maxBy = (selector, predicate = () => true) => {
            let best = -Infinity;
            const winners = [];
            for (const score of roundScores) {
                if (!predicate(score)) continue;
                const value = selector(score);
                if (value > best) {
                    best = value;
                    winners.length = 0;
                    winners.push(score);
                } else if (value === best) {
                    winners.push(score);
                }
            }
            return { best, winners };
        };

        const minBy = (selector, predicate = () => true) => {
            let best = Infinity;
            const winners = [];
            for (const score of roundScores) {
                if (!predicate(score)) continue;
                const value = selector(score);
                if (value < best) {
                    best = value;
                    winners.length = 0;
                    winners.push(score);
                } else if (value === best) {
                    winners.push(score);
                }
            }
            return { best, winners };
        };

        const totalPointLeaders = maxBy(
            (score) => this.getPoints(score.playerNo),
        );
        totalPointLeaders.winners.forEach((score) => award(score.playerNo, 'mvp'));

        const deathLeaders = maxBy((score) => score.deaths);
        if (deathLeaders.best >= 3) {
            deathLeaders.winners.forEach((score) => award(score.playerNo, 'unlucky'));
        }

        for (const score of roundScores) {
            const worstKilledBy = Math.max(0, ...score.killedBy.values());
            if (worstKilledBy >= 3) award(score.playerNo, 'victim');
            if (score.consecutiveDeaths >= 3) award(score.playerNo, 'repeat_death');
            if (this._getTitleProgress(score.playerNo).consecutiveFailures >= 3) {
                award(score.playerNo, 'quitter');
            }
            if (score.reviveThenFinish) award(score.playerNo, 'phoenix');
            if (score.deathBeforeFinish >= 1) award(score.playerNo, 'almost_finish');
            if (score.deathBeforeFinish >= 2 && score.consecutiveDeaths >= 2) {
                award(score.playerNo, 'close_call');
            }
            if ((this._getTitleProgress(score.playerNo).deathTimestamps || []).length >= 5) {
                award(score.playerNo, 'fearless');
            }
            if (this._getTitleProgress(score.playerNo).rainbowCoinStreak >= 2) {
                award(score.playerNo, 'lucky');
            }
            if (
                score.finished &&
                score.finishTime !== null &&
                GameConfig.TIME_LIMIT - score.finishTime <= 10
            ) {
                award(score.playerNo, 'clutch_runner');
            }
        }

        const finishers = roundScores.filter((score) => score.finished);
        if (finishers.length === 1) {
            award(finishers[0].playerNo, 'miracle');
        }

        const coinLeaders = maxBy((score) => score.coins);
        if (coinLeaders.best > 0) {
            coinLeaders.winners.forEach((score) => award(score.playerNo, 'coin_thief'));
        }

        const rainbowLeaders = maxBy((score) => score.specialCoins);
        if (rainbowLeaders.best > 0) {
            rainbowLeaders.winners.forEach((score) =>
                award(score.playerNo, 'treasure_hunter'),
            );
        }

        const trapLeaders = maxBy((score) => score.trapsPlaced);
        if (trapLeaders.best > 0) {
            trapLeaders.winners.forEach((score) => award(score.playerNo, 'polluter'));
        }

        const trapDeathLeaders = maxBy((score) => score.trapTypesKilled.size);
        if (trapDeathLeaders.best >= 3) {
            trapDeathLeaders.winners.forEach((score) =>
                award(score.playerNo, 'trap_tester'),
            );
        }

        const avgFinishLeaders = minBy(
            (score) => {
                const times = this._getTitleProgress(score.playerNo).finishTimes;
                return times.reduce((sum, value) => sum + value, 0) / times.length;
            },
            (score) => this._getTitleProgress(score.playerNo).finishTimes.length > 0,
        );
        if (avgFinishLeaders.best < Infinity) {
            avgFinishLeaders.winners.forEach((score) =>
                award(score.playerNo, 'speed_god'),
            );
        }

        const jumpLeaders = minBy(
            (score) => score.jumpCount,
            (score) => score.finished && score.jumpCount > 0,
        );
        if (jumpLeaders.best < Infinity) {
            jumpLeaders.winners.forEach((score) => award(score.playerNo, 'skip_class'));
        }

        const survivorLeaders = minBy(
            (score) => score.deaths,
            (score) => score.finished,
        );
        if (survivorLeaders.best < Infinity) {
            survivorLeaders.winners.forEach((score) => award(score.playerNo, 'survivor'));
        }

        for (const [playerNo, hits] of titleHits) {
            for (const titleKey of hits) {
                this._addTitleHit(playerNo, titleKey);
            }
        }

        this.lastRoundTitleHits = titleHits;
        return titleHits;
    }

    getMapAdvanceTitleSummary(players = []) {
        const summary = new Map();
        const playerNos = players.length
            ? players.map((player) => player.playerNo)
            : [...this.careerStats.keys()];
        const candidatesByPlayer = new Map(playerNos.map((playerNo) => [playerNo, []]));
        const totalPoints = (playerNo) => this.getPoints(playerNo);
        const careerOf = (playerNo) => this._getCareerStats(playerNo);
        const formatters = {
            points: (value) => `${value}分`,
            deaths: (value) => `${value}次`,
            count: (value) => `${value}次`,
            coins: (value) => `${value}枚`,
            traps: (value) => `${value}个`,
            jumps: (value) => `${value}跳`,
            streak: (value) => `${value}局`,
            time: (value) => `${value.toFixed(2)}秒`,
            kinds: (value) => `${value}种`,
        };

        const titleRules = [
            { key: 'mvp', mode: 'max', minValue: 1, metric: (playerNo) => totalPoints(playerNo), format: 'points' },
            { key: 'unlucky', mode: 'max', minValue: 3, metric: (playerNo) => careerOf(playerNo).totalDeaths, format: 'deaths' },
            { key: 'victim', mode: 'max', minValue: 3, metric: (playerNo) => careerOf(playerNo).maxKilledBySamePlayer, format: 'count' },
            { key: 'repeat_death', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).repeatDeathEvents, format: 'count' },
            { key: 'quitter', mode: 'max', minValue: 3, metric: (playerNo) => careerOf(playerNo).maxConsecutiveFailures, format: 'count' },
            { key: 'miracle', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).onlyFinisherCount, format: 'count' },
            {
                key: 'speed_god',
                mode: 'min',
                metric: (playerNo) => {
                    const times = careerOf(playerNo).finishTimes;
                    if (!times.length) return Infinity;
                    return times.reduce((sum, value) => sum + value, 0) / times.length;
                },
                valid: (value) => Number.isFinite(value),
                format: 'time',
            },
            { key: 'coin_thief', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).totalCoins, format: 'coins' },
            { key: 'treasure_hunter', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).totalRainbowCoins, format: 'count' },
            {
                key: 'survivor',
                mode: 'min',
                metric: (playerNo) => careerOf(playerNo).finishTimes.length ? careerOf(playerNo).totalDeaths : Infinity,
                valid: (value) => Number.isFinite(value),
                format: 'deaths',
            },
            { key: 'clutch_runner', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).clutchFinishes, format: 'count' },
            {
                key: 'skip_class',
                mode: 'min',
                metric: (playerNo) => careerOf(playerNo).bestJumpFinish,
                valid: (value) => Number.isFinite(value),
                format: 'jumps',
            },
            { key: 'phoenix', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).reviveFinishCount, format: 'count' },
            { key: 'polluter', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).totalTrapsPlaced, format: 'traps' },
            { key: 'almost_finish', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).nearFinishDeaths, format: 'count' },
            { key: 'trap_tester', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).uniqueTrapDeaths.size, format: 'kinds' },
            { key: 'fearless', mode: 'max', minValue: 5, metric: (playerNo) => careerOf(playerNo).maxDeathsInMinute, format: 'count' },
            { key: 'lucky', mode: 'max', minValue: 2, metric: (playerNo) => careerOf(playerNo).maxRainbowStreak, format: 'streak' },
            { key: 'close_call', mode: 'max', minValue: 1, metric: (playerNo) => careerOf(playerNo).closeCallEvents, format: 'count' },
        ];

        for (const rule of titleRules) {
            let bestValue = rule.mode === 'min' ? Infinity : -Infinity;
            let winners = [];
            for (const playerNo of playerNos) {
                const value = rule.metric(playerNo);
                const valid = rule.valid ? rule.valid(value) : true;
                if (!valid) continue;
                if (rule.minValue !== undefined && rule.mode === 'max' && value < rule.minValue) continue;
                if (rule.mode === 'min') {
                    if (value < bestValue) {
                        bestValue = value;
                        winners = [playerNo];
                    } else if (value === bestValue) {
                        winners.push(playerNo);
                    }
                } else if (value > bestValue) {
                    bestValue = value;
                    winners = [playerNo];
                } else if (value === bestValue) {
                    winners.push(playerNo);
                }
            }

            if (!winners.length) continue;
            for (const playerNo of winners) {
                const definition = TITLE_DEFINITION_MAP[rule.key];
                const value = rule.metric(playerNo);
                candidatesByPlayer.get(playerNo)?.push({
                    key: rule.key,
                    name: definition.name,
                    description: definition.description,
                    value,
                    valueText: formatters[rule.format]?.(value) ?? String(value),
                    weight: definition.weight ?? 0,
                });
            }
        }

        const playerOrder = [...playerNos].sort((a, b) => totalPoints(b) - totalPoints(a));
        const usedTitles = new Set();
        for (const playerNo of playerOrder) {
            candidatesByPlayer.set(
                playerNo,
                (candidatesByPlayer.get(playerNo) || []).sort((a, b) => {
                    if (b.weight !== a.weight) return b.weight - a.weight;
                    if (b.value !== a.value) return b.value - a.value;
                    return a.name.localeCompare(b.name, 'zh-CN');
                }),
            );
            summary.set(playerNo, []);
        }

        for (let slot = 0; slot < 3; slot++) {
            for (const playerNo of playerOrder) {
                const list = summary.get(playerNo);
                if ((list?.length ?? 0) >= 3) continue;
                const candidate = (candidatesByPlayer.get(playerNo) || []).find(
                    (entry) =>
                        !usedTitles.has(entry.key) &&
                        !(list || []).some((picked) => picked.key === entry.key),
                );
                if (!candidate) continue;
                list.push(candidate);
                usedTitles.add(candidate.key);
            }
        }

        return summary;
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

    getRainbowCoins(player) {
        return this.rainbowCoins.get(player.playerNo) ?? 0;
    }

    getScore(player) {
        return this.scores.get(player.playerNo);
    }

    // ─── Stuck detection ─────────────────────────────────────────────────

    /**
     * Call at end of round. Returns true if nobody finished for 2+ consecutive rounds.
     */
    checkStuck() {
        let anyoneFinished = false;
        for (const score of this.scores.values()) {
            if (score.finished) {
                anyoneFinished = true;
                break;
            }
        }
        if (anyoneFinished) {
            this.consecutiveNoFinish = 0;
            return false;
        }
        this.consecutiveNoFinish++;
        return this.consecutiveNoFinish >= 2;
    }

    // ─── Reset ──────────────────────────────────────────────────────────────

    resetRound({ advanceRound = true } = {}) {
        if (advanceRound) {
            this.currentRound++;
        }
        for (const [playerNo] of this.roundCoins) {
            this.roundCoins.set(playerNo, 0);
            this.roundPoints.set(playerNo, 0); // reset round points
            this.scores.set(playerNo, new PlayerScore(playerNo));
        }
        // Do NOT clear trapOwners — trap ownership persists across rounds
        // Traps persist until the map changes (advanceMap)
    }
}
