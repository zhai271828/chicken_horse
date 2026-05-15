import { describe, expect, it } from 'vitest';
import {
    createCoinSnapshot,
    createRoundSnapshot,
    createScoreSnapshot,
    createScoresByPlayer,
} from '../src/sim/state/roundSnapshot.js';

describe('round snapshot helpers', () => {
    const players = [
        {
            playerNo: 0,
            networkId: 'p1',
            nickname: 'Host',
            character: 'chicken',
            x: 10,
            y: 20,
            vx: 1,
            vy: 2,
            w: 28,
            h: 34,
            spawnX: 5,
            spawnY: 6,
            onGround: true,
            jumpsLeft: 2,
            maxJumps: 2,
            secondJump: false,
            facingRight: true,
            lifeState: 'ALIVE',
            movementState: 'run',
            gameState: 'PLAYING',
            respawnCountdown: 0,
            lastDeathReason: null,
        },
    ];

    const scoreManager = {
        getScore: () => ({ kills: 1, deaths: 2, specialCoins: 3, finished: true }),
        getPoints: () => 9,
        getRoundCoins: () => 4,
        getWallet: () => 25,
        getRoundPoints: () => 7,
        getRainbowCoins: () => 3,
    };

    it('creates per-player score snapshots', () => {
        expect(createScoreSnapshot(scoreManager, players[0])).toEqual({
            points: 9,
            coins: 4,
            wallet: 25,
            roundPoints: 7,
            kills: 1,
            deaths: 2,
            rainbowCoins: 3,
            finished: true,
        });

        expect(createScoresByPlayer(players, scoreManager)).toEqual({
            p1: {
                points: 9,
                coins: 4,
                wallet: 25,
                roundPoints: 7,
                kills: 1,
                deaths: 2,
                rainbowCoins: 3,
                finished: true,
            },
        });
    });

    it('creates coin and round snapshots', () => {
        const coin = {
            x: 100,
            y: 120,
            collected: true,
            isRainbow: true,
            _networkCollectedAt: 1000,
            _networkCollectedById: 'p1',
            _networkCollectedByName: 'Host',
            radius: 14,
        };

        const coinSnapshot = createCoinSnapshot(coin, 1600);
        expect(coinSnapshot.collectedAge).toBe(600);

        const snapshot = createRoundSnapshot({
            players,
            scoreManager,
            obstacles: [{ type: 'SPIKE' }],
            coins: [coinSnapshot],
            timeLeft: 42,
            round: 3,
            mapKey: 'map2',
            bgIndex: 5,
            paused: true,
            pausedById: 'p1',
            pausedByName: 'Host',
            snapshotSentAt: 12345,
            phase: 'RUN',
        });

        expect(snapshot.players).toHaveLength(1);
        expect(snapshot.scores.p1.points).toBe(9);
        expect(snapshot.obstacles).toEqual([{ type: 'SPIKE' }]);
        expect(snapshot.coins[0].collectedByName).toBe('Host');
        expect(snapshot.timeLeft).toBe(42);
        expect(snapshot.round).toBe(3);
        expect(snapshot.mapKey).toBe('map2');
        expect(snapshot.bgIndex).toBe(5);
        expect(snapshot.paused).toBe(true);
        expect(snapshot.phase).toBe('RUN');
    });
});
