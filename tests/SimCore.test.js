import { describe, expect, it } from 'vitest';
import { advanceCountdown } from '../src/sim/core/countdown.js';
import {
    isPlayerNearEndpoint,
    playerTouchesEndpointTile,
} from '../src/sim/core/endpoint.js';
import { GameConfig } from '../src/config/GameConfig.js';
import { TileType } from '../src/config/TileType.js';

describe('sim core helpers', () => {
    it('advances countdown in fixed seconds and reports expiry', () => {
        const running = advanceCountdown(10, 1500);
        const expired = advanceCountdown(1, 1500);

        expect(running.timeLeft).toBeCloseTo(8.5);
        expect(running.expired).toBe(false);
        expect(expired.timeLeft).toBe(0);
        expect(expired.expired).toBe(true);
    });

    it('detects endpoint tile contact from player center', () => {
        const tiledMap = {
            MAP: [[0, 0], [0, TileType.ENDPOINT]],
        };
        const p = { floor: Math.floor };
        const player = {
            x: GameConfig.TILE,
            y: GameConfig.TILE,
            w: 28,
            h: 34,
        };

        expect(playerTouchesEndpointTile(player, tiledMap, p)).toBe(true);
    });

    it('uses circular endpoint radius for near-finish checks', () => {
        const tiledMap = {
            endX: 320,
            endY: 160,
            endW: GameConfig.TILE,
            endH: GameConfig.TILE,
        };
        const endpointCenterX = 320 + GameConfig.TILE / 2;
        const endpointCenterY = 160 + GameConfig.TILE / 2;

        const inside = {
            x: endpointCenterX + GameConfig.TILE * 9.5 - 14,
            y: endpointCenterY - 17,
            w: 28,
            h: 34,
        };
        const outside = {
            x: endpointCenterX + GameConfig.TILE * 10.5 - 14,
            y: endpointCenterY - 17,
            w: 28,
            h: 34,
        };

        expect(isPlayerNearEndpoint(inside, tiledMap)).toBe(true);
        expect(isPlayerNearEndpoint(outside, tiledMap)).toBe(false);
    });
});
