import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { TileType } from '../../config/TileType.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

export class MushroomTeleporter extends Obstacle {
    constructor(p, x, y, ctx) {
        super(p, x, y);
        this._ctx = ctx;
        this._cooldowns = new Map();
        this._age = 0;
    }
    get isSolid() { return false; }
    get isHazard() { return false; }

    update(deltaTime) {
        this._age += deltaTime;
        for (const [key, remaining] of this._cooldowns) {
            const next = remaining - deltaTime;
            if (next <= 0) this._cooldowns.delete(key);
            else this._cooldowns.set(key, next);
        }
    }

    applyEffect(player) {
        if ((this._cooldowns.get(player.playerNo) ?? 0) > 0) return;
        if (!aabbIntersects(player.x, player.y, player.w, player.h, this.x, this.y, GameConfig.TILE, GameConfig.TILE)) return;

        const ctx = this._ctx;
        if (!ctx?.tiledMap?.MAP) return;
        const MAP = ctx.tiledMap.MAP;
        const T = GameConfig.TILE;

        // Find random empty tile (check multiple tile type representations)
        const emptyTiles = [];
        for (let ty = 0; ty < MAP.length; ty++) {
            for (let tx = 0; tx < MAP[ty].length; tx++) {
                const tile = MAP[ty][tx];
                const isEmpty = tile === 0 || tile === TileType.EMPTY || tile === 'empty' || tile === 'EMPTY';
                if (isEmpty) {
                    // Check tile below is solid
                    if (ty + 1 < MAP.length) {
                        const below = MAP[ty + 1][tx];
                        const isSolid = below === TileType.SOLID || below === 'solid' || below === 'SOLID' || below === 2 || below === 12;
                        if (isSolid) {
                            emptyTiles.push({ x: tx * T, y: ty * T });
                        }
                    }
                }
            }
        }

        if (emptyTiles.length === 0) {
            // Fallback: just teleport to a random position above the map
            const worldW = (MAP[0]?.length ?? 30) * T;
            const worldH = (MAP.length ?? 17) * T;
            player.x = Math.random() * (worldW - T * 2) + T;
            player.y = T * 2;
            player.vx = 0;
            player.vy = 0;
            this._cooldowns.set(player.playerNo, GameConfig.MUSHROOM_TELEPORT_COOLDOWN_MS);
            return;
        }

        const dest = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
        player.x = dest.x;
        player.y = dest.y;
        player.vx = 0;
        player.vy = 0;
        this._cooldowns.set(player.playerNo, GameConfig.MUSHROOM_TELEPORT_COOLDOWN_MS);
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const baseY = this.y + T;
        const wobble = Math.sin(this._age * 0.005) * 2;
        const onCooldown = this._cooldowns.size > 0;

        p.push();
        p.noStroke();

        // Stem
        p.fill(220, 200, 160);
        p.rect(cx - 3, baseY - 10, 6, 10, 1);

        // Cap
        const capColor = onCooldown ? [120, 100, 100] : [220, 50, 50];
        p.fill(...capColor);
        p.arc(cx, baseY - 10, T * 0.7, T * 0.5, p.PI, 0, p.CHORD);

        // White dots on cap
        if (!onCooldown) {
            p.fill(255, 255, 255, 200);
            p.circle(cx - 5, baseY - 14 + wobble, 4);
            p.circle(cx + 4, baseY - 12 + wobble, 3);
            p.circle(cx, baseY - 16 + wobble, 3);
        }

        // Glow when active
        if (!onCooldown) {
            p.fill(255, 100, 100, 30);
            p.circle(cx, baseY - 8, T * 0.9);
        }

        p.pop();
    }

    static drawGhost(p, x, y) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const baseY = y + T;
        p.noStroke();
        p.fill(220, 200, 160, 130);
        p.rect(cx - 3, baseY - 10, 6, 10, 1);
        p.fill(220, 50, 50, 100);
        p.arc(cx, baseY - 10, T * 0.7, T * 0.5, p.PI, 0, p.CHORD);
        p.noStroke();
    }
}
