import { PlayerMovementState } from '../../config/PlayerMovementState.js';

export function resolveHorizontalVelocity({
    left = false,
    right = false,
    vx = 0,
    speed = 0,
    speedMultiplier = 1,
    slideMode = false,
}) {
    const noInput = !left && !right;
    if (noInput && slideMode) {
        return vx * 0.97;
    }

    let nextVx = 0;
    if (left) nextVx -= speed * speedMultiplier;
    if (right) nextVx += speed * speedMultiplier;
    return nextVx;
}

export function resolveJumpState({
    onGround = false,
    jumpsLeft = 0,
    maxJumps = 0,
    jumpPressed = false,
    jumpHeld = false,
    vy = 0,
    jumpVelocity = 0,
    jumpMultiplier = 1,
}) {
    let nextJumpsLeft = jumpsLeft;
    let nextVy = vy;
    let nextOnGround = onGround;
    let nextJumpMultiplier = jumpMultiplier;

    if (onGround) {
        nextJumpsLeft = maxJumps;
        nextJumpMultiplier = 1.0;
    }

    if (jumpPressed && !jumpHeld && nextJumpsLeft > 0) {
        nextVy = -jumpVelocity * nextJumpMultiplier;
        nextJumpsLeft -= 1;
        nextOnGround = false;
    }

    return {
        vy: nextVy,
        jumpsLeft: nextJumpsLeft,
        onGround: nextOnGround,
        jumpHeld: jumpPressed,
        jumpMultiplier: nextJumpMultiplier,
    };
}

export function applyGravityStep({
    vy = 0,
    gravity = 0,
    maxFall = 0,
}) {
    const nextVy = vy + gravity;
    return nextVy > maxFall ? maxFall : nextVy;
}

export function resolveMovementState({
    vx = 0,
    vy = 0,
    onGround = false,
    facingRight = true,
}) {
    let nextFacingRight = facingRight;
    if (vx > 0) nextFacingRight = true;
    if (vx < 0) nextFacingRight = false;

    let movementState;
    if (!onGround) {
        movementState =
            vy < 0
                ? PlayerMovementState.JUMP
                : PlayerMovementState.FALL;
    } else {
        movementState =
            vx === 0
                ? PlayerMovementState.IDLE
                : PlayerMovementState.RUN;
    }

    return {
        movementState,
        facingRight: nextFacingRight,
    };
}
