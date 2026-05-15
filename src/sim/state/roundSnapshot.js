import { createPlayerSnapshot } from './playerSnapshot.js';

export function createScoreSnapshot(scoreManager, player) {
    const score = scoreManager?.getScore?.(player) || {};
    return {
        points: scoreManager?.getPoints?.(player.playerNo) ?? 0,
        coins: scoreManager?.getRoundCoins?.(player) ?? 0,
        wallet: scoreManager?.getWallet?.(player) ?? 0,
        roundPoints: scoreManager?.getRoundPoints?.(player.playerNo) ?? 0,
        kills: score?.kills ?? 0,
        deaths: score?.deaths ?? 0,
        rainbowCoins:
            scoreManager?.getRainbowCoins?.(player) ??
            score?.specialCoins ??
            0,
        finished: Boolean(score?.finished),
    };
}

export function createScoresByPlayer(players = [], scoreManager) {
    return Object.fromEntries(
        players.map((player) => [
            player.networkId || player.playerNo,
            createScoreSnapshot(scoreManager, player),
        ]),
    );
}

export function createCoinSnapshot(coin, now = Date.now()) {
    return {
        x: coin.x,
        y: coin.y,
        collected: Boolean(coin.collected),
        isRainbow: Boolean(coin.isRainbow),
        collectedAt: coin._networkCollectedAt || null,
        collectedAge: coin._networkCollectedAt
            ? now - coin._networkCollectedAt
            : null,
        collectedById: coin._networkCollectedById || null,
        collectedByName: coin._networkCollectedByName || null,
        radius: coin.radius || 12,
    };
}

export function createRoundSnapshot({
    players = [],
    scoreManager = null,
    obstacles = [],
    coins = [],
    timeLeft = 0,
    round = 1,
    mapKey = 'map1',
    bgIndex = 0,
    paused = false,
    pausedById = null,
    pausedByName = null,
    snapshotSentAt = Date.now(),
    phase = 'RUN',
} = {}) {
    return {
        phase,
        players: players.map((player) => createPlayerSnapshot(player)),
        scores: createScoresByPlayer(players, scoreManager),
        obstacles,
        coins,
        timeLeft,
        snapshotSentAt,
        round,
        mapKey,
        bgIndex,
        paused,
        pausedById,
        pausedByName,
    };
}
