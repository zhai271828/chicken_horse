import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';

export class BlackHole extends Obstacle {
    constructor(p, x, y) {
        super(p, x, y);
        this._age = 0;
    }
    get isSolid() { return false; }
    get isHazard() { return false; }

    update(deltaTime) { this._age += deltaTime; }

    preEffect(player) {
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const px = player.x + player.w / 2;
        const py = player.y + player.h / 2;
        const dx = cx - px;
        const dy = cy - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const range = GameConfig.BLACK_HOLE_RANGE * T;

        if (dist < range && dist > 1) {
            const force = GameConfig.BLACK_HOLE_FORCE * (1 - dist / range);
            player.vx += (dx / dist) * force;
            player.vy += (dy / dist) * force;
            player.slideMode = true;
        }
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const range = GameConfig.BLACK_HOLE_RANGE * T;
        const pulse = 0.8 + 0.2 * Math.sin(this._age * 0.004);

        p.push();
        // Outer suction indicator rings
        p.noFill();
        for (let i = 3; i >= 1; i--) {
            const r = range * (i / 3) * pulse;
            const alpha = 30 * (4 - i);
            p.stroke(100, 40, 200, alpha);
            p.strokeWeight(2);
            p.circle(cx, cy, r * 2);
        }

        // Inner vortex
        p.noStroke();
        p.fill(20, 10, 40, 200);
        p.circle(cx, cy, T * 0.9);
        p.fill(60, 20, 120, 180);
        p.circle(cx, cy, T * 0.6);
        p.fill(120, 50, 200, 150);
        p.circle(cx, cy, T * 0.3);

        // Spinning lines
        const rot = this._age * 0.003;
        p.stroke(180, 100, 255, 100);
        p.strokeWeight(1.5);
        for (let i = 0; i < 4; i++) {
            const a = rot + (i * Math.PI / 2);
            const r1 = T * 0.2;
            const r2 = T * 0.4;
            p.line(
                cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
                cx + Math.cos(a + 0.5) * r2, cy + Math.sin(a + 0.5) * r2
            );
        }
        p.pop();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const cy = y + T / 2;
        p.noStroke();
        p.fill(60, 20, 120, 90);
        p.circle(cx, cy, T * 0.9);
        p.stroke(180, 100, 255, 120);
        p.strokeWeight(2);
        p.noFill();
        p.circle(cx, cy, T * 0.9);
        p.noStroke();
    }
}
