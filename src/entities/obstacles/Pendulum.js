import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

export class Pendulum extends Obstacle {
    constructor(p, x, y) {
        super(p, x, y);
        this._age = 0;
        this._ballX = x;
        this._ballY = y;
    }

    get isSolid() { return false; }
    get isHazard() { return true; }

    update(deltaTime) {
        this._age += deltaTime;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y;
        const length = GameConfig.PENDULUM_LENGTH * T;
        const angle = Math.sin(this._age * Math.PI * 2 / GameConfig.PENDULUM_PERIOD_MS) * (Math.PI / 3);

        this._ballX = cx + Math.sin(angle) * length - T * 0.4;
        this._ballY = cy + Math.cos(angle) * length - T * 0.4;
        this.x = this._ballX;
        this.y = this._ballY;
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const anchorY = this.y - GameConfig.PENDULUM_LENGTH * T;
        const ballR = T * 0.4;
        const angle = Math.sin(this._age * Math.PI * 2 / GameConfig.PENDULUM_PERIOD_MS) * (Math.PI / 3);

        p.push();
        // Anchor point
        p.noStroke();
        p.fill(100, 100, 110);
        p.circle(cx, anchorY, 8);

        // Chain/rope
        p.stroke(160, 160, 170);
        p.strokeWeight(2);
        const ropeLen = GameConfig.PENDULUM_LENGTH * T;
        p.line(cx, anchorY, this._ballX + ballR, this._ballY + ballR);

        // Ball
        p.noStroke();
        p.fill(80, 80, 90);
        p.circle(this._ballX + ballR, this._ballY + ballR, ballR * 2);
        // Highlight
        p.fill(120, 120, 130, 180);
        p.circle(this._ballX + ballR - 3, this._ballY + ballR - 3, ballR * 0.8);

        // Spikes on ball
        p.fill(200, 60, 60);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + this._age * 0.001;
            const sx = this._ballX + ballR + Math.cos(a) * (ballR + 4);
            const sy = this._ballY + ballR + Math.sin(a) * (ballR + 4);
            p.circle(sx, sy, 5);
        }
        p.pop();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const cy = y + T / 2;
        p.noStroke();
        p.fill(80, 80, 90, 100);
        p.circle(cx, cy, T * 0.8);
        p.stroke(160, 160, 170, 100);
        p.strokeWeight(1);
        p.line(cx, y, cx, cy);
        p.noStroke();
    }
}
