import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { TileType } from '../../config/TileType.js';

/**
 * SpikedBall — a rolling ground hazard ball.
 * Moves horizontally continuously, bounces off walls and solid tiles.
 * Kills any player who touches it.
 */
export class SpikedBall extends Obstacle {
    constructor(p, x, y, obstacleSheet) {
        super(p, x, y);
        this.obstacleSheet = obstacleSheet;
        this.spikeW = 40;
        this.spikeH = 40;
        this._vx = 2;
        this._dir = 1; // 1 = right, -1 = left
        this._rotAngle = 0;
        this._distTraveled = 0;
        this._initialized = false;
    }

    get isHazard() {
        return true;
    }

    _isSolidTile(tile) {
        return tile === TileType.SOLID || tile === 'solid' || tile === 'SOLID' || tile === 2 || tile === 12;
    }

    _randomizeSpeed() {
        // Random speed between 0.5x and 2x base speed
        const baseSpeed = 2;
        this._vx = baseSpeed * (0.5 + Math.random() * 1.5);
    }

    update(deltaTime, gameWidth, gameHeight, MAP) {
        const dtFactor = deltaTime / 16.67;
        const T = GameConfig.TILE;

        // Ensure minimum movement even with zero deltaTime
        const effectiveDt = Math.max(dtFactor, 0.1);

        // Always move horizontally - never stop
        const moveX = this._vx * this._dir * effectiveDt;
        this.x += moveX;
        this._distTraveled += Math.abs(moveX);
        this._rotAngle = this._distTraveled / (this.spikeW / 2);

        // Get world width
        const worldW = (MAP && MAP[0]) ? MAP[0].length * T : (gameWidth ?? 800);

        // Bounce off map bounds with random speed
        if (this.x <= 0) {
            this.x = 0;
            this._dir = 1;
            this._randomizeSpeed();
        } else if (this.x + this.w >= worldW) {
            this.x = worldW - this.w;
            this._dir = -1;
            this._randomizeSpeed();
        }

        // Bounce off solid tiles ahead — check multiple points for robustness
        if (MAP) {
            const checkX = this._dir > 0 ? this.x + this.w + 2 : this.x - 2;
            const ty1 = Math.floor(this.y / T);
            const ty2 = Math.floor((this.y + this.h - 1) / T);
            const atx = Math.floor(checkX / T);
            let hitWall = false;

            for (const aty of [ty1, ty2]) {
                if (aty >= 0 && aty < MAP.length && atx >= 0 && atx < (MAP[aty]?.length ?? 0)) {
                    if (this._isSolidTile(MAP[aty][atx])) {
                        hitWall = true;
                        break;
                    }
                }
            }

            if (hitWall) {
                this._dir *= -1;
                this._randomizeSpeed();
                this.x += this._dir * 4; // push back to prevent sticking
            }
        }

        // Safety clamp: ensure ball stays within world bounds
        if (this.x < 0) this.x = 0;
        if (this.x + this.w > worldW) this.x = worldW - this.w;
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;

        p.push();
        p.translate(cx, cy);
        p.rotate(this._rotAngle);
        p.imageMode(p.CENTER);
        p.image(this.obstacleSheet, 0, 0, this.spikeW, this.spikeH);
        p.pop();
    }

    static drawGhost(p, x, y, sheet) {
        const T = GameConfig.TILE;
        const frameW = 40;
        const frameH = 40;
        const cx = x + T / 2;
        const cy = y + T / 2;

        p.push();
        p.translate(cx, cy);
        p.tint(255, 150);
        p.imageMode(p.CENTER);
        p.image(sheet, 0, 0, frameW, frameH);
        p.pop();
    }
}
