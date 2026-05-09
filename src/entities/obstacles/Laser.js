import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { TileType } from '../../config/TileType.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

export class Laser extends Obstacle {
    constructor(p, x, y, ctx) {
        super(p, x, y);
        this._ctx = ctx;
        this._age = 0;
        this._state = 'idle'; // idle, aiming, firing, cooldown
        this._stateTimer = 0;
        this._targetX = 0;
        this._targetY = 0;
        this._beamEndX = 0;
        this._beamEndY = 0;
        this._targetPlayer = null;
    }

    get isSolid() { return true; }
    get isHazard() { return this._state === 'firing'; }

    _isSolidTile(tile) {
        return tile === TileType.SOLID || tile === 'solid' || tile === 'SOLID' || tile === 2 || tile === 12;
    }

    update(deltaTime, gameWidth, gameHeight, MAP, obstacles, players) {
        this._age += deltaTime;
        this._stateTimer += deltaTime;

        const T = GameConfig.TILE;
        const detectRange = GameConfig.LASER_RANGE * T; // 3 tiles detection
        const maxDist = GameConfig.LASER_MAX_DISTANCE * T; // 5 tiles max attack

        switch (this._state) {
            case 'idle':
                if (players) {
                    for (const player of players) {
                        if (player.lifeState !== 'ALIVE') continue;
                        const dx = (player.x + player.w / 2) - (this.x + T / 2);
                        const dy = (player.y + player.h / 2) - (this.y + T / 2);
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < detectRange) {
                            this._targetPlayer = player;
                            this._targetX = player.x + player.w / 2;
                            this._targetY = player.y + player.h / 2;
                            this._state = 'aiming';
                            this._stateTimer = 0;
                            break;
                        }
                    }
                }
                break;

            case 'aiming':
                if (this._targetPlayer && this._targetPlayer.lifeState === 'ALIVE') {
                    // Check if target still in detection range
                    const dx = (this._targetPlayer.x + this._targetPlayer.w / 2) - (this.x + T / 2);
                    const dy = (this._targetPlayer.y + this._targetPlayer.h / 2) - (this.y + T / 2);
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > detectRange * 1.2) {
                        // Target escaped, cancel aim
                        this._state = 'cooldown';
                        this._stateTimer = 0;
                        this._targetPlayer = null;
                        break;
                    }
                    this._targetX = this._targetPlayer.x + this._targetPlayer.w / 2;
                    this._targetY = this._targetPlayer.y + this._targetPlayer.h / 2;
                }
                if (this._stateTimer >= 2000) {
                    this._state = 'firing';
                    this._stateTimer = 0;
                    // Calculate beam end - limit to max distance
                    const sx = this.x + T / 2;
                    const sy = this.y + T / 2;
                    const dx = this._targetX - sx;
                    const dy = this._targetY - sy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > maxDist) {
                        // Limit to max distance
                        const ratio = maxDist / dist;
                        this._beamEndX = sx + dx * ratio;
                        this._beamEndY = sy + dy * ratio;
                    } else {
                        this._beamEndX = this._targetX;
                        this._beamEndY = this._targetY;
                    }
                }
                break;

            case 'firing':
                if (this._stateTimer >= GameConfig.LASER_FIRE_MS) {
                    this._state = 'cooldown';
                    this._stateTimer = 0;
                    this._targetPlayer = null;
                }
                break;

            case 'cooldown':
                if (this._stateTimer >= GameConfig.LASER_COOLDOWN_MS) {
                    this._state = 'idle';
                    this._stateTimer = 0;
                }
                break;
        }
    }

    applyEffect(player, _allPlayers, respawnManager) {
        if (this._state !== 'firing') return;

        const T = GameConfig.TILE;
        const sx = this.x + T / 2;
        const sy = this.y + T / 2;
        const ex = this._beamEndX;
        const ey = this._beamEndY;

        // Check along beam path, stop at solid obstacles
        const steps = 20;
        let hitObstacle = false;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const bx = sx + (ex - sx) * t;
            const by = sy + (ey - sy) * t;

            // Check if this point is blocked by a solid tile
            if (this._ctx?.tiledMap?.MAP) {
                const MAP = this._ctx.tiledMap.MAP;
                const tx = Math.floor(bx / T);
                const ty = Math.floor(by / T);
                if (ty >= 0 && ty < MAP.length && tx >= 0 && tx < (MAP[ty]?.length ?? 0)) {
                    if (this._isSolidTile(MAP[ty][tx])) {
                        // Beam blocked - update visual endpoint
                        this._beamEndX = bx;
                        this._beamEndY = by;
                        hitObstacle = true;
                        break;
                    }
                }
            }

            // Check if beam hits player
            if (aabbIntersects(player.x, player.y, player.w, player.h, bx - 4, by - 4, 8, 8)) {
                respawnManager.triggerDeath(player, 'TRAP');
                return;
            }
        }
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;

        p.push();
        p.noStroke();

        // Turret base
        p.fill(70, 70, 80);
        p.rect(this.x + 2, this.y + T * 0.6, T - 4, T * 0.4, 2);
        p.fill(90, 90, 100);
        p.rect(this.x + 4, this.y + T * 0.4, T - 8, T * 0.3, 2);

        // Lens/eye
        const lensColor = this._state === 'aiming' ? [255, 50, 50] :
                          this._state === 'firing' ? [255, 0, 0] :
                          this._state === 'idle' ? [100, 150, 255] : [80, 80, 100];
        p.fill(...lensColor);
        p.circle(cx, this.y + T * 0.45, 10);
        p.fill(255, 255, 255, 180);
        p.circle(cx - 1, this.y + T * 0.43, 4);

        if (this._state === 'aiming') {
            // Dotted aiming line
            p.stroke(255, 50, 50, 100 + Math.sin(this._age * 0.01) * 50);
            p.strokeWeight(1);
            const dx = this._targetX - cx;
            const dy = this._targetY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dashLen = 6;
            for (let d = 0; d < dist; d += dashLen * 2) {
                const t1 = d / dist;
                const t2 = Math.min((d + dashLen) / dist, 1);
                p.line(cx + dx * t1, cy + dy * t1, cx + dx * t2, cy + dy * t2);
            }
        } else if (this._state === 'firing') {
            // Solid laser beam
            p.stroke(255, 0, 0, 200);
            p.strokeWeight(4);
            p.line(cx, cy, this._beamEndX, this._beamEndY);
            p.stroke(255, 200, 200, 150);
            p.strokeWeight(8);
            p.line(cx, cy, this._beamEndX, this._beamEndY);
            p.stroke(255, 50, 50, 50);
            p.strokeWeight(16);
            p.line(cx, cy, this._beamEndX, this._beamEndY);
        }

        p.pop();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        p.noStroke();
        p.fill(70, 70, 80, 130);
        p.rect(x + 2, y + T * 0.6, T - 4, T * 0.4, 2);
        p.fill(90, 90, 100, 130);
        p.rect(x + 4, y + T * 0.4, T - 8, T * 0.3, 2);
        p.fill(100, 150, 255, 130);
        p.circle(x + T / 2, y + T * 0.45, 10);
        p.noStroke();
    }
}
