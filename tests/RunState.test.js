import { describe, it, expect } from 'vitest';
import { RunState } from '../src/states/RunState.js';
import { PlayerGameState } from '../src/config/PlayerGameState.js';
import { PlayerState } from '../src/config/PlayerState.js';
import { GameConfig } from '../src/config/GameConfig.js';

describe('RunState near-finish detection', () => {
    const makeState = () =>
        new RunState(
            {
                tiledMap: {
                    endX: 320,
                    endY: 160,
                    endW: GameConfig.TILE,
                    endH: GameConfig.TILE,
                },
            },
            () => {},
        );

    it('uses a circular 10-tile endpoint radius', () => {
        const state = makeState();
        const endpointCenterX = 320 + GameConfig.TILE / 2;
        const endpointCenterY = 160 + GameConfig.TILE / 2;
        const insideRadius = GameConfig.TILE * 9.5;
        const outsideRadius = GameConfig.TILE * 10.5;

        const insidePlayer = {
            x: endpointCenterX + insideRadius - 14,
            y: endpointCenterY - 17,
            w: 28,
            h: 34,
        };
        const outsidePlayer = {
            x: endpointCenterX + outsideRadius - 14,
            y: endpointCenterY - 17,
            w: 28,
            h: 34,
        };

        expect(state._isNearEndpoint(insidePlayer)).toBe(true);
        expect(state._isNearEndpoint(outsidePlayer)).toBe(false);
    });

    it('ignores successful finish transitions when counting near-finish deaths', () => {
        const state = makeState();
        const player = {
            x: 320,
            y: 160,
            w: 28,
            h: 34,
            lifeState: PlayerState.DEAD,
            gameState: PlayerGameState.PLAYING,
        };

        expect(state._shouldRecordNearFinishDeath(PlayerState.ALIVE, player)).toBe(true);

        player.gameState = PlayerGameState.SUCCESS;
        expect(state._shouldRecordNearFinishDeath(PlayerState.ALIVE, player)).toBe(false);
    });
});
