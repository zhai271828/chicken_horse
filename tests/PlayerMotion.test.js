import { describe, expect, it } from 'vitest';
import { PlayerMovementState } from '../src/config/PlayerMovementState.js';
import {
    applyGravityStep,
    resolveHorizontalVelocity,
    resolveJumpState,
    resolveMovementState,
} from '../src/sim/core/playerMotion.js';

describe('player motion sim helpers', () => {
    it('applies horizontal input and slide friction', () => {
        expect(
            resolveHorizontalVelocity({
                left: true,
                speed: 3.2,
                speedMultiplier: 1,
            }),
        ).toBe(-3.2);

        expect(
            resolveHorizontalVelocity({
                vx: 10,
                slideMode: true,
            }),
        ).toBeCloseTo(9.7);
    });

    it('resolves jump state with reset on ground and edge-triggered jump', () => {
        const first = resolveJumpState({
            onGround: true,
            jumpsLeft: 0,
            maxJumps: 2,
            jumpPressed: true,
            jumpHeld: false,
            vy: 0,
            jumpVelocity: 12,
            jumpMultiplier: 1,
        });

        expect(first.vy).toBe(-12);
        expect(first.jumpsLeft).toBe(1);
        expect(first.onGround).toBe(false);
        expect(first.jumpHeld).toBe(true);
    });

    it('caps gravity and resolves movement state/facing', () => {
        expect(
            applyGravityStep({
                vy: 17.8,
                gravity: 0.7,
                maxFall: 18,
            }),
        ).toBe(18);

        const airborne = resolveMovementState({
            vx: -1,
            vy: -3,
            onGround: false,
            facingRight: true,
        });
        expect(airborne.facingRight).toBe(false);
        expect(airborne.movementState).toBe(PlayerMovementState.JUMP);

        const grounded = resolveMovementState({
            vx: 2,
            vy: 0,
            onGround: true,
            facingRight: false,
        });
        expect(grounded.facingRight).toBe(true);
        expect(grounded.movementState).toBe(PlayerMovementState.RUN);
    });
});
