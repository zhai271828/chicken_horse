import { PlayerGameState } from '../../config/PlayerGameState.js';
import { PlayerMovementState } from '../../config/PlayerMovementState.js';
import { PlayerState } from '../../config/PlayerState.js';

export function createPlayerSnapshot(player, overrides = {}) {
    return {
        id: overrides.id ?? player.networkId ?? player.playerNo,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        w: player.w,
        h: player.h,
        spawnX: player.spawnX,
        spawnY: player.spawnY,
        onGround: Boolean(player.onGround),
        jumpsLeft: player.jumpsLeft,
        maxJumps: player.maxJumps,
        secondJump: Boolean(player.secondJump),
        facingRight: player.facingRight !== false,
        lifeState: player.lifeState || PlayerState.ALIVE,
        movementState:
            player.movementState || PlayerMovementState.IDLE,
        gameState: player.gameState || PlayerGameState.PLAYING,
        respawnCountdown: player.respawnCountdown ?? 0,
        lastDeathReason: player.lastDeathReason ?? null,
        name: overrides.name ?? player.nickname,
        character: overrides.character ?? player.character,
    };
}

export function applyPlayerSnapshot(player, snapshot = {}) {
    player.x = snapshot.x ?? player.x;
    player.y = snapshot.y ?? player.y;
    player.vx = snapshot.vx ?? player.vx;
    player.vy = snapshot.vy ?? player.vy;
    player.w = snapshot.w ?? player.w;
    player.h = snapshot.h ?? player.h;
    player.spawnX = snapshot.spawnX ?? player.spawnX;
    player.spawnY = snapshot.spawnY ?? player.spawnY;
    player.onGround = snapshot.onGround ?? player.onGround;
    player.jumpsLeft = snapshot.jumpsLeft ?? player.jumpsLeft;
    player.maxJumps = snapshot.maxJumps ?? player.maxJumps;
    player.secondJump = snapshot.secondJump ?? player.secondJump;
    player.facingRight =
        snapshot.facingRight ?? player.facingRight;
    player.lifeState = snapshot.lifeState || player.lifeState;
    player.movementState =
        snapshot.movementState || player.movementState;
    player.gameState = snapshot.gameState || player.gameState;
    player.respawnCountdown =
        snapshot.respawnCountdown ?? player.respawnCountdown;
    player.lastDeathReason =
        snapshot.lastDeathReason ?? player.lastDeathReason;
    player.nickname = snapshot.name ?? player.nickname;
    player.character = snapshot.character ?? player.character;
    return player;
}
