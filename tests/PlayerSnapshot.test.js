import { describe, expect, it } from 'vitest';
import {
    applyPlayerSnapshot,
    createPlayerSnapshot,
} from '../src/sim/state/playerSnapshot.js';
import { PlayerGameState } from '../src/config/PlayerGameState.js';
import { PlayerMovementState } from '../src/config/PlayerMovementState.js';
import { PlayerState } from '../src/config/PlayerState.js';

describe('player snapshot helpers', () => {
    it('creates a serializable player snapshot', () => {
        const player = {
            playerNo: 1,
            networkId: 'player-2',
            nickname: 'Guest',
            character: 'duck',
            x: 10,
            y: 20,
            vx: 3,
            vy: -4,
            w: 28,
            h: 34,
            spawnX: 5,
            spawnY: 6,
            onGround: true,
            jumpsLeft: 1,
            maxJumps: 2,
            secondJump: false,
            facingRight: true,
            lifeState: PlayerState.ALIVE,
            movementState: PlayerMovementState.RUN,
            gameState: PlayerGameState.PLAYING,
            respawnCountdown: 0,
            lastDeathReason: null,
        };

        expect(createPlayerSnapshot(player)).toEqual({
            id: 'player-2',
            name: 'Guest',
            character: 'duck',
            x: 10,
            y: 20,
            vx: 3,
            vy: -4,
            w: 28,
            h: 34,
            spawnX: 5,
            spawnY: 6,
            onGround: true,
            jumpsLeft: 1,
            maxJumps: 2,
            secondJump: false,
            facingRight: true,
            lifeState: PlayerState.ALIVE,
            movementState: PlayerMovementState.RUN,
            gameState: PlayerGameState.PLAYING,
            respawnCountdown: 0,
            lastDeathReason: null,
        });
    });

    it('applies a snapshot back onto a player-like object', () => {
        const target = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            w: 28,
            h: 34,
            spawnX: 0,
            spawnY: 0,
            onGround: false,
            jumpsLeft: 2,
            maxJumps: 2,
            secondJump: false,
            facingRight: false,
            lifeState: PlayerState.DEAD,
            movementState: PlayerMovementState.IDLE,
            gameState: PlayerGameState.FAILED,
            respawnCountdown: 3,
            lastDeathReason: 'FALL',
            nickname: 'Old',
            character: 'chicken',
        };

        applyPlayerSnapshot(target, {
            x: 100,
            y: 120,
            vx: 5,
            vy: 6,
            onGround: true,
            jumpsLeft: 1,
            maxJumps: 3,
            secondJump: true,
            facingRight: true,
            lifeState: PlayerState.ALIVE,
            movementState: PlayerMovementState.JUMP,
            gameState: PlayerGameState.PLAYING,
            respawnCountdown: 0,
            lastDeathReason: null,
            name: 'New',
            character: 'bunny',
        });

        expect(target.x).toBe(100);
        expect(target.y).toBe(120);
        expect(target.vx).toBe(5);
        expect(target.vy).toBe(6);
        expect(target.onGround).toBe(true);
        expect(target.jumpsLeft).toBe(1);
        expect(target.maxJumps).toBe(3);
        expect(target.secondJump).toBe(true);
        expect(target.facingRight).toBe(true);
        expect(target.lifeState).toBe(PlayerState.ALIVE);
        expect(target.movementState).toBe(PlayerMovementState.JUMP);
        expect(target.gameState).toBe(PlayerGameState.PLAYING);
        expect(target.nickname).toBe('New');
        expect(target.character).toBe('bunny');
    });
});
