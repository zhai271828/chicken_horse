import { ObstacleType } from '../config/ObstacleType.js';
import { GameConfig } from '../config/GameConfig.js';
import { Platform } from '../entities/obstacles/Platform.js';
import { MovingPlatform } from '../entities/obstacles/MovingPlatform.js';
import { FallingPlatform } from '../entities/obstacles/FallingPlatform.js';
import { IcePlatform } from '../entities/obstacles/IcePlatform.js';
import { BouncePad } from '../entities/obstacles/BouncePad.js';
import { SpikeObstacle } from '../entities/obstacles/SpikeObstacle.js';
import { Cannon, CannonDir } from '../entities/obstacles/Cannon.js';
import { Saw } from '../entities/obstacles/Saw.js';
import { Flame } from '../entities/obstacles/Flame.js';
import { SpikedBall } from '../entities/obstacles/SpikedBall.js';
import { WindZone, WindDir } from '../entities/obstacles/WindZone.js';
import { Teleporter } from '../entities/obstacles/Teleporter.js';
import { Bomb } from '../entities/obstacles/Bomb.js';
import { Shadow } from '../entities/obstacles/Shadow.js';
import { Slime } from '../entities/obstacles/Slime.js';
import { BlackHole } from '../entities/obstacles/BlackHole.js';
import { MushroomTeleporter } from '../entities/obstacles/MushroomTeleporter.js';
import { Arrow } from '../entities/obstacles/Arrow.js';
import { Laser } from '../entities/obstacles/Laser.js';
import { Eraser } from '../entities/obstacles/Eraser.js';

function isRuntimeObstacle(obstacle) {
    return (
        obstacle &&
        typeof obstacle.update === 'function' &&
        typeof obstacle.draw === 'function'
    );
}

function normalizeDirection(direction) {
    const value = String(direction || 'RIGHT').toUpperCase();
    if (value === 'LEFT') return CannonDir.LEFT;
    if (value === 'UP') return CannonDir.UP;
    if (value === 'DOWN') return CannonDir.DOWN;
    return CannonDir.RIGHT;
}

function toWorldCoord(value, unit) {
    const n = Number(value) || 0;
    return unit === 'pixel' ? n : n * GameConfig.TILE;
}

function networkOwnerToPlayerNo(ctx, placedBy) {
    if (typeof placedBy === 'number' && Number.isInteger(placedBy)) {
        return placedBy;
    }
    const players = ctx.networkPlayers || [];
    const index = players.findIndex((player) => player.id === placedBy);
    return index >= 0 ? index : null;
}

export function createObstacleFromNetwork(ctx, data) {
    if (!data || isRuntimeObstacle(data)) return data;

    const { p } = ctx;
    const sprites = ctx.shopIcons || {};
    const type = data.type;
    const unit = data.unit || 'tile';
    const x = toWorldCoord(data.x, unit);
    const y = toWorldCoord(data.y, unit);
    const direction = normalizeDirection(data.direction);

    let obstacle = null;
    switch (type) {
        case ObstacleType.PLATFORM:
            obstacle = new Platform(p, x, y, sprites.PLATFORM);
            break;
        case ObstacleType.MOVING_PLATFORM:
            obstacle = new MovingPlatform(p, x, y, sprites.MOVING_PLATFORM);
            break;
        case ObstacleType.FALLING_PLATFORM:
            obstacle = new FallingPlatform(p, x, y, sprites.FALLING_PLATFORM);
            break;
        case ObstacleType.ICE_PLATFORM:
            obstacle = new IcePlatform(p, x, y, sprites.ICE_PLATFORM);
            break;
        case ObstacleType.BOUNCE_PAD:
            obstacle = new BouncePad(p, x, y, sprites.BOUNCE_PAD);
            break;
        case ObstacleType.SPIKE:
            obstacle = new SpikeObstacle(p, x, y, sprites.SPIKE);
            break;
        case ObstacleType.CANNON:
            obstacle = new Cannon(p, x, y, direction, sprites.CANNON);
            break;
        case ObstacleType.ARROW:
            obstacle = new Arrow(p, x, y, direction);
            break;
        case ObstacleType.SAW:
            obstacle = new Saw(p, x, y, sprites.SAW);
            break;
        case ObstacleType.FLAME:
            obstacle = new Flame(p, x, y, sprites.FLAME);
            break;
        case ObstacleType.SPIKED_BALL:
            obstacle = new SpikedBall(p, x, y, sprites.SPIKED_BALL);
            break;
        case ObstacleType.WIND_ZONE:
            obstacle = new WindZone(p, x, y, WindDir[direction] || direction, sprites.WIND_ZONE);
            break;
        case ObstacleType.TELEPORTER:
            obstacle = new Teleporter(p, x, y, sprites.TELEPORTER);
            break;
        case ObstacleType.BOMB:
            obstacle = new Bomb(p, x, y, ctx);
            break;
        case ObstacleType.SHADOW:
            obstacle = new Shadow(p, x, y, ctx, sprites.SHADOW);
            break;
        case ObstacleType.SLIME:
            obstacle = new Slime(p, x, y);
            break;
        case ObstacleType.BLACK_HOLE:
            obstacle = new BlackHole(p, x, y);
            break;
        case ObstacleType.MUSHROOM_TELEPORTER:
            obstacle = new MushroomTeleporter(p, x, y, ctx);
            break;
        case ObstacleType.LASER:
            obstacle = new Laser(p, x, y, ctx);
            break;
        case ObstacleType.ERASER:
            obstacle = new Eraser(p, x, y, ctx);
            break;
        default:
            return null;
    }

    obstacle.type = type;
    obstacle._id = data.id || data._id || `${type}_${x}_${y}`;
    obstacle._obstacleId = obstacle._id;
    obstacle._networkPlacedBy = data.placedBy ?? data._placedBy ?? null;
    obstacle._networkPairId = data.pairId ?? data._networkPairId ?? null;

    const ownerNo = networkOwnerToPlayerNo(ctx, obstacle._networkPlacedBy);
    if (ownerNo !== null) {
        obstacle._placedBy = ownerNo;
        ctx.scoreManager?.registerTrap(obstacle, ownerNo);
    }

    return obstacle;
}

export function linkNetworkTeleporters(obstacles = []) {
    const byPair = new Map();
    for (const obstacle of obstacles) {
        if (obstacle?.type !== ObstacleType.TELEPORTER || !obstacle._networkPairId) {
            continue;
        }
        if (!byPair.has(obstacle._networkPairId)) {
            byPair.set(obstacle._networkPairId, []);
        }
        byPair.get(obstacle._networkPairId).push(obstacle);
    }

    for (const pair of byPair.values()) {
        if (pair.length < 2) continue;
        pair[0].partner = pair[1];
        pair[1].partner = pair[0];
    }
}

export function hydrateNetworkObstacles(ctx, obstacles = []) {
    const hydrated = obstacles
        .map((obstacle) => createObstacleFromNetwork(ctx, obstacle))
        .filter(Boolean);
    linkNetworkTeleporters(hydrated);
    return hydrated;
}
