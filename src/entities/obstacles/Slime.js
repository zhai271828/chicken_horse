import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

export class Slime extends Obstacle {
    constructor(p, x, y) {
        super(p, x, y);
        this._affectedPlayers = new Map(); // playerNo -> remaining ms
    }
    get isSolid() { return false; }
    get isHazard() { return false; }

    update(deltaTime) {
        for (const [key, remaining] of this._affectedPlayers) {
            const next = remaining - deltaTime;
            if (next <= 0) {
                this._affectedPlayers.delete(key);
            } else {
                this._affectedPlayers.set(key, next);
            }
        }
    }

    preEffect(player) {
        const T = GameConfig.TILE;
        const inSlime = aabbIntersects(player.x, player.y, player.w, player.h, this.x, this.y, T, T);

        if (inSlime) {
            // Apply poison effect: slow + reduce jump
            player.speedMultiplier = GameConfig.SLIME_SPEED_MULT;
            player.slideMode = true;
            player.jumpMultiplier = GameConfig.SLIME_JUMP_MULT;
            // Reset timer each time player touches slime (no stacking)
            this._affectedPlayers.set(player.playerNo, GameConfig.SLIME_DURATION_MS);
        } else if ((this._affectedPlayers.get(player.playerNo) ?? 0) > 0) {
            // Still affected by poison (duration not expired)
            player.speedMultiplier = GameConfig.SLIME_SPEED_MULT;
            player.slideMode = true;
            player.jumpMultiplier = GameConfig.SLIME_JUMP_MULT;
        }
        // When duration expires, jumpMultiplier is reset to 1.0 in Player.jumpUp() on landing
    }

    applyEffect(player) {}

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;
        const pulse = 0.9 + 0.1 * Math.sin(p.frameCount * 0.05);

        p.noStroke();
        p.fill(40, 180, 60, 160);
        p.ellipse(cx, cy + T * 0.15, T * 0.9 * pulse, T * 0.5 * pulse);
        p.fill(60, 220, 80, 120);
        const bubbleOff1 = Math.sin(p.frameCount * 0.08) * 3;
        const bubbleOff2 = Math.cos(p.frameCount * 0.06) * 3;
        p.circle(cx - 4 + bubbleOff1, cy + 2, 5);
        p.circle(cx + 5 + bubbleOff2, cy - 1, 4);
        p.circle(cx + bubbleOff1, cy + 4, 3);
        p.stroke(30, 140, 50);
        p.strokeWeight(1);
        p.noFill();
        p.ellipse(cx, cy + T * 0.15, T * 0.9 * pulse, T * 0.5 * pulse);
        p.noStroke();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        p.noStroke();
        p.fill(40, 180, 60, 80);
        p.ellipse(x + T / 2, y + T * 0.65, T * 0.9, T * 0.5);
        p.stroke(30, 140, 50, 100);
        p.strokeWeight(1);
        p.noFill();
        p.ellipse(x + T / 2, y + T * 0.65, T * 0.9, T * 0.5);
        p.noStroke();
    }
}
