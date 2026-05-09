import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';

const FRAME_W = 40;
const FRAME_H = 40;
const FRAME_COUNT = 5;
const FRAME_MS = 120;
const ICON_FRAME = 1;

/**
 * SpikeObstacle — a placeable hazard spike tile.
 * Kills any player who touches it, same as map 'S' spikes.
 */
export class SpikeObstacle extends Obstacle {
    constructor(p, x, y, sprite = null) {
        super(p, x, y, sprite);
        this._age = 0;
        this._timer = 0;
        this._retracted = false;
    }

    get isHazard() {
        return !this._retracted;
    }

    update(deltaTime) {
        this._age += deltaTime;
        this._timer += deltaTime;
        if (this._retracted) {
            if (this._timer >= 800) {
                this._retracted = false;
                this._timer = 0;
            }
        } else {
            if (this._timer >= 1000) {
                this._retracted = true;
                this._timer = 0;
            }
        }
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;

        // Scale vertically when retracted
        const scaleY = this._retracted ? 0.3 : 1.0;

        if (this.obstacleSheet) {
            const frame = Math.floor(this._age / FRAME_MS) % FRAME_COUNT;
            p.push();
            p.noSmooth();
            if (this._retracted) {
                // Draw retracted: scale down from bottom
                p.translate(this.x, this.y + T);
                p.scale(1, scaleY);
                p.image(
                    this.obstacleSheet,
                    0,
                    -T,
                    T,
                    T,
                    frame * FRAME_W,
                    0,
                    FRAME_W,
                    FRAME_H,
                );
            } else {
                p.image(
                    this.obstacleSheet,
                    this.x,
                    this.y,
                    T,
                    T,
                    frame * FRAME_W,
                    0,
                    FRAME_W,
                    FRAME_H,
                );
            }
            p.pop();
            return;
        }

        p.noStroke();
        p.fill(220, 60, 60);
        const tipY = this.y + T * (1 - scaleY);
        p.triangle(
            this.x,
            this.y + T,
            this.x + T / 2,
            tipY + 4,
            this.x + T,
            this.y + T,
        );
    }

    /**
     * Draw a semi-transparent ghost for placement preview.
     * @param {p5}    p
     * @param {number} x
     * @param {number} y
     */
    static drawGhost(p, x, y, sprite = null) {
        const T = GameConfig.TILE;
        if (sprite) {
            p.push();
            p.noSmooth();
            p.tint(255, 170);
            p.image(
                sprite,
                x,
                y,
                T,
                T,
                ICON_FRAME * FRAME_W,
                0,
                FRAME_W,
                FRAME_H,
            );
            p.pop();
            return;
        }

        p.noStroke();
        p.fill(220, 60, 60, 130);
        p.triangle(x, y + T, x + T / 2, y + 4, x + T, y + T);
    }
}
