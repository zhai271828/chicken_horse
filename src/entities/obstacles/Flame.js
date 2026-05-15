import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

/**
 * Flame — a hazard that pulses active and inactive on a fixed timer.
 * When active, the flame shoots upward 2 tiles, penetrating through players.
 * When inactive it is harmless and visually shrinks to an ember.
 * The flame is never solid — players pass through it.
 */
export class Flame extends Obstacle {
    constructor(p, x, y, obstacleSheet) {
        super(p, x, y);
        this._timer = 0;
        this._active = true;
        this._age = 0;
        this.obstacleSheet = obstacleSheet;
        this.frameIndex = 0;
        this.sawWidth = 16;
        this.sawHeight = 32;
        this.splitAnimation(this.sawWidth, this.sawHeight);
    }

    get isSolid() {
        return false;
    }
    get isHazard() {
        return this._active;
    }

    update(deltaTime) {
        this._timer += deltaTime;
        this._age += deltaTime;

        const limit = this._active
            ? GameConfig.FLAME_ON_MS
            : GameConfig.FLAME_OFF_MS;
        if (this._timer >= limit) {
            this._active = !this._active;
            this._timer = 0;
        }
    }

    /**
     * 2-tile radius circular hit zone around the flame.
     * Penetrates through players (no solid blocking).
     */
    applyEffect(player, _allPlayers, respawnManager) {
        if (!this._active) return;
        const T = GameConfig.TILE;
        const range = GameConfig.FLAME_RANGE_TILES * T;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const px = player.x + player.w / 2;
        const py = player.y + player.h / 2;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= range) {
            respawnManager.triggerDeath(
                player,
                'TRAP',
                this._placedBy ?? null,
                this.type || 'FLAME',
            );
        }
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T;

        p.push();
        p.translate(cx, cy);

        if (this._active) {
            // Draw 2-tile tall flame effect
            const range = GameConfig.FLAME_RANGE_TILES;
            const flicker = Math.sin(this._age * 0.02) * 0.3;

            // Outer glow
            p.noStroke();
            p.fill(255, 80, 20, 60 + flicker * 40);
            p.ellipse(0, -T * range / 2, T * 1.2, T * range * 1.1);

            // Inner flame body
            p.fill(255, 160, 30, 180);
            p.beginShape();
            p.vertex(-T * 0.35, 0);
            p.vertex(-T * 0.4, -T * 0.5);
            p.vertex(-T * 0.25 + flicker * 6, -T * 1.0);
            p.vertex(-T * 0.15 + flicker * 4, -T * 1.5);
            p.vertex(flicker * 3, -T * range);
            p.vertex(T * 0.15 + flicker * 4, -T * 1.5);
            p.vertex(T * 0.25 + flicker * 6, -T * 1.0);
            p.vertex(T * 0.4, -T * 0.5);
            p.vertex(T * 0.35, 0);
            p.endShape(p.CLOSE);

            // Core
            p.fill(255, 240, 100, 200);
            p.beginShape();
            p.vertex(-T * 0.15, 0);
            p.vertex(-T * 0.2, -T * 0.4);
            p.vertex(-T * 0.1 + flicker * 3, -T * 0.8);
            p.vertex(flicker * 2, -T * 1.2);
            p.vertex(T * 0.1 + flicker * 3, -T * 0.8);
            p.vertex(T * 0.2, -T * 0.4);
            p.vertex(T * 0.15, 0);
            p.endShape(p.CLOSE);
        } else {
            // Ember state — small dim glow
            const emberPulse = 0.5 + 0.3 * Math.sin(this._age * 0.01);
            p.noStroke();
            p.fill(200, 80, 30, 80 * emberPulse);
            p.circle(0, -4, T * 0.3);
            p.fill(255, 140, 40, 120 * emberPulse);
            p.circle(0, -4, T * 0.15);
        }

        // Draw the sprite frame at base
        const frame = this.framesArr[this.frameIndex];
        if (frame) {
            p.image(frame, -frame.width / 2, -frame.height);
        }
        this.frameIndex = (this.frameIndex + 1) % this.framesArr.length;

        p.pop();
    }

    static drawGhost(p, x, y, sheet) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const cy = y + T;
        const frameW = 16;
        const frameH = 32;

        p.push();
        p.translate(cx, cy);
        p.tint(255, 150);
        // Draw 2-tile ghost range
        p.noStroke();
        p.fill(255, 100, 30, 50);
        p.rect(-T / 2, -T * 2, T, T * 2, 4);
        p.stroke(255, 120, 40, 120);
        p.strokeWeight(1);
        p.noFill();
        p.rect(-T / 2, -T * 2, T, T * 2, 4);
        p.image(sheet, -frameW / 2, -frameH, frameW, frameH, 0, 0, frameW, frameH);
        p.pop();
    }
}
