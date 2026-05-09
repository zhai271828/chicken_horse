import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';

/**
 * Eraser — a special trap that removes obstacles.
 * Cannot be purchased, only given when players are stuck.
 */
export class Eraser extends Obstacle {
    constructor(p, x, y, ctx) {
        super(p, x, y);
        this._ctx = ctx;
        this._used = false;
        this._age = 0;
    }

    get isSolid() { return false; }
    get isHazard() { return false; }

    update(deltaTime) {
        this._age += deltaTime;
    }

    applyEffect(player, _allPlayers, _respawnManager, obstacles) {
        if (this._used) return;

        const T = GameConfig.TILE;
        const px = player.x + player.w / 2;
        const py = player.y + player.h / 2;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);

        if (dist < T * 1.5) {
            // Remove all obstacles in a 3-tile radius
            const radius = T * 3;
            const toRemove = [];
            for (const obs of obstacles) {
                if (obs === this) continue;
                const ox = obs.x + obs.w / 2;
                const oy = obs.y + obs.h / 2;
                const d = Math.sqrt((ox - cx) ** 2 + (oy - cy) ** 2);
                if (d < radius) {
                    toRemove.push(obs);
                }
            }
            for (const obs of toRemove) {
                const idx = obstacles.indexOf(obs);
                if (idx !== -1) obstacles.splice(idx, 1);
            }
            this._used = true;
        }
    }

    draw() {
        if (this._used) return;

        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const pulse = 0.9 + 0.1 * Math.sin(this._age * 0.005);

        p.push();
        p.noStroke();

        // Outer glow
        p.fill(255, 200, 50, 40);
        p.circle(cx, cy, T * 1.2 * pulse);

        // Main circle
        p.fill(255, 220, 80, 180);
        p.circle(cx, cy, T * 0.8);

        // Eraser icon
        p.fill(255, 255, 255, 220);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(18);
        p.text('✕', cx, cy);

        p.pop();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const cy = y + T / 2;
        p.noStroke();
        p.fill(255, 220, 80, 100);
        p.circle(cx, cy, T * 0.8);
        p.fill(255, 255, 255, 150);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(18);
        p.text('✕', cx, cy);
        p.noStroke();
    }
}
