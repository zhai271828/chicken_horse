import { GameConfig } from '../config/GameConfig.js';
import { aabbIntersects } from '../systems/PhysicsSystem.js';

/**
 * A collectible coin placed in the world.
 * Can be a normal coin or a special rainbow coin.
 */
export class Coin {
    constructor(p, x, y, value = GameConfig.COIN_VALUE, spriteImage = null, visualOffsetX = 0, isRainbow = false) {
        this.p = p;
        this.x = x;
        this.y = y;
        this.w = GameConfig.TILE * 0.5;
        this.h = GameConfig.TILE * 0.5;
        this.value = isRainbow ? GameConfig.RAINBOW_COIN_VALUE : value;
        this.isRainbow = isRainbow;
        this.collected = false;
        this.spriteImage = spriteImage;
        this.visualOffsetX = visualOffsetX;

        this._baseY = y;
        this._age = Math.random() * Math.PI * 2;
        this._collectEffect = 0; // for rainbow coin effect
    }

    update(players, scoreManager) {
        if (this.collected) return;

        this._age += 0.05;

        for (const player of players) {
            if (!aabbIntersects(player.x, player.y, player.w, player.h, this.x, this.y, this.w, this.h))
                continue;

            this.collected = true;
            this._collectEffect = 1;
            scoreManager.collectCoin(player, this);
            break;
        }
    }

    static FRAME_SIZE = 16;
    static ANIM_SPEED = 8;

    draw() {
        if (this.collected) {
            // Rainbow coin collection effect
            if (this.isRainbow && this._collectEffect > 0) {
                this._collectEffect -= 0.02;
                const p = this.p;
                const cx = this.x + this.w / 2 + this.visualOffsetX;
                const cy = this.y + this.h / 2;
                const r = (1 - this._collectEffect) * 40;

                p.noStroke();
                // Rainbow explosion
                const colors = [
                    [255, 0, 0], [255, 127, 0], [255, 255, 0],
                    [0, 255, 0], [0, 0, 255], [75, 0, 130], [148, 0, 211]
                ];
                for (let i = 0; i < 7; i++) {
                    const angle = (i / 7) * Math.PI * 2;
                    const dx = Math.cos(angle) * r;
                    const dy = Math.sin(angle) * r;
                    p.fill(...colors[i], this._collectEffect * 200);
                    p.circle(cx + dx, cy + dy, 8 * this._collectEffect);
                }
            }
            return;
        }

        const p = this.p;
        const bobY = this._baseY + Math.sin(this._age) * 3;
        const drawW = this.w * 2;
        const drawH = this.h * 2;
        const drawX = this.x + (this.w - drawW) / 2 + this.visualOffsetX;
        const liftY = this.h * 0.75;
        const drawY = bobY + (this.h - drawH) / 2 - liftY;

        if (this.isRainbow) {
            // Rainbow coin - special appearance
            const cx = drawX + drawW / 2;
            const cy = drawY + drawH / 2;
            const hue = (this._age * 50) % 360;

            p.noStroke();
            // Outer glow
            p.fill(hue, 80, 100, 50);
            p.circle(cx, cy, drawW * 1.5);
            // Main coin
            p.colorMode(p.HSB, 360, 100, 100, 100);
            p.fill(hue, 80, 100, 90);
            p.circle(cx, cy, drawW);
            // Inner shine
            p.fill(hue, 40, 100, 60);
            p.circle(cx - drawW * 0.12, cy - drawH * 0.12, drawW * 0.4);
            // Sparkle
            p.fill(0, 0, 100, Math.sin(this._age * 3) * 50 + 50);
            p.circle(cx + drawW * 0.2, cy - drawH * 0.2, 4);
            p.colorMode(p.RGB, 255);
            return;
        }

        // Normal coin
        if (this.spriteImage) {
            const frameSize = Coin.FRAME_SIZE;
            const totalFrames = Math.max(1, Math.floor(this.spriteImage.width / frameSize));
            const frameIndex = Math.floor(p.frameCount / Coin.ANIM_SPEED) % totalFrames;
            const sx = frameIndex * frameSize;
            p.image(this.spriteImage, drawX, drawY, drawW, drawH, sx, 0, frameSize, frameSize);
            return;
        }

        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        p.noStroke();
        p.fill(255, 200, 0);
        p.circle(cx, cy, drawW);
        p.fill(255, 240, 120, 200);
        p.circle(cx - drawW * 0.12, cy - drawH * 0.12, drawW * 0.4);
    }

    reset() {
        this.collected = false;
        this._collectEffect = 0;
        this._age = Math.random() * Math.PI * 2;
    }
}
