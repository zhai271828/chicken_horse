import { Obstacle } from '../Obstacle.js';
import { GameConfig } from '../../config/GameConfig.js';
import { TileType } from '../../config/TileType.js';
import { CannonDir } from './Cannon.js';
import { aabbIntersects } from '../../systems/PhysicsSystem.js';

class ArrowProjectile {
    constructor(p, x, y, vx, vy) {
        this.p = p;
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.expired = false;
        this._age = 0;
    }

    update(gameWidth, gameHeight, MAP) {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += GameConfig.ARROW_GRAVITY;
        this._age++;

        if (this.x < -20 || this.x > gameWidth + 20 || this.y > gameHeight + 20 || this.y < -100) {
            this.expired = true;
            return;
        }

        // Check block collision
        if (MAP) {
            const T = GameConfig.TILE;
            const tx = Math.floor(this.x / T);
            const ty = Math.floor(this.y / T);
            if (ty >= 0 && ty < MAP.length && tx >= 0 && tx < (MAP[ty]?.length ?? 0)) {
                const tile = MAP[ty][tx];
                const isSolid = tile === TileType.SOLID || tile === 'solid' || tile === 'SOLID' || tile === 2 || tile === 12;
                if (isSolid) {
                    this.expired = true;
                    return;
                }
            }
        }
    }

    hits(player) {
        return aabbIntersects(
            player.x, player.y, player.w, player.h,
            this.x - 4, this.y - 2, 8, 4
        );
    }

    draw() {
        const p = this.p;
        const angle = Math.atan2(this.vy, this.vx);
        p.push();
        p.translate(this.x, this.y);
        p.rotate(angle);
        p.stroke(139, 90, 43);
        p.strokeWeight(2);
        p.line(-10, 0, 6, 0);
        p.noStroke();
        p.fill(180, 180, 190);
        p.triangle(8, 0, 3, -3, 3, 3);
        p.fill(200, 60, 60);
        p.triangle(-10, 0, -7, -3, -7, 0);
        p.triangle(-10, 0, -7, 3, -7, 0);
        p.pop();
    }
}

export class Arrow extends Obstacle {
    constructor(p, x, y, direction = CannonDir.RIGHT) {
        super(p, x, y);
        this.direction = direction;
        this.projectiles = [];
        this._fireTimer = GameConfig.ARROW_FIRE_INTERVAL;
        this._angle = this._directionAngle(direction);
    }

    get isSolid() { return true; }
    get isHazard() { return false; }

    update(deltaTime, gameWidth, gameHeight, MAP) {
        this._fireTimer += deltaTime;
        if (this._fireTimer >= GameConfig.ARROW_FIRE_INTERVAL) {
            this._fireTimer = 0;
            this._spawnArrow();
        }
        for (const proj of this.projectiles) {
            proj.update(gameWidth, gameHeight, MAP);
        }
        this.projectiles = this.projectiles.filter(proj => !proj.expired);
    }

    _spawnArrow() {
        const T = GameConfig.TILE;
        const baseSpeed = GameConfig.ARROW_SPEED;
        const randomMultiplier = 0.5 + Math.random() * 0.5;
        const speed = baseSpeed * randomMultiplier;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;

        // Velocity based on direction
        const vx = this.direction === CannonDir.RIGHT ? speed :
                   this.direction === CannonDir.LEFT ? -speed : 0;
        const vy = this.direction === CannonDir.DOWN ? speed :
                   this.direction === CannonDir.UP ? -speed * 1.3 : 0;

        // Add slight random angle variation
        const angleVar = (Math.random() - 0.5) * 0.3;
        const finalVx = vx !== 0 ? vx : Math.cos(angleVar) * speed * 0.3;
        const finalVy = vy !== 0 ? vy : Math.sin(angleVar) * speed * 0.3;

        // For horizontal directions, add slight upward bias
        if (this.direction === CannonDir.RIGHT || this.direction === CannonDir.LEFT) {
            this.projectiles.push(new ArrowProjectile(this.p, cx, cy, finalVx, finalVy - 1));
        } else {
            this.projectiles.push(new ArrowProjectile(this.p, cx, cy, finalVx, finalVy));
        }
    }

    _directionAngle(dir) {
        switch (dir) {
            case CannonDir.RIGHT: return 0;
            case CannonDir.DOWN: return Math.PI / 2;
            case CannonDir.LEFT: return Math.PI;
            case CannonDir.UP: return -Math.PI / 2;
            default: return 0;
        }
    }

    checkProjectileHit(player) {
        for (const proj of this.projectiles) {
            if (proj.hits(player)) {
                proj.expired = true;
                return true;
            }
        }
        return false;
    }

    draw() {
        const p = this.p;
        const T = GameConfig.TILE;
        const cx = this.x + T / 2;
        const cy = this.y + T / 2;

        p.push();
        p.translate(cx, cy);
        p.rotate(this._angle);

        // Bow arc
        p.noFill();
        p.stroke(139, 90, 43);
        p.strokeWeight(3);
        p.arc(0, 0, T * 0.7, T * 0.7, -Math.PI * 0.4, Math.PI * 0.4);

        // Bowstring
        p.stroke(200, 200, 180);
        p.strokeWeight(1);
        const bowR = T * 0.35;
        p.line(bowR * Math.cos(-Math.PI * 0.4), bowR * Math.sin(-Math.PI * 0.4),
               bowR * Math.cos(Math.PI * 0.4), bowR * Math.sin(Math.PI * 0.4));
        p.pop();

        for (const proj of this.projectiles) {
            proj.draw();
        }
    }

    static drawGhost(p, x, y, direction = CannonDir.RIGHT) {
        const T = GameConfig.TILE;
        const cx = x + T / 2;
        const cy = y + T / 2;
        const angle = direction === CannonDir.RIGHT ? 0 :
                      direction === CannonDir.DOWN ? Math.PI / 2 :
                      direction === CannonDir.LEFT ? Math.PI : -Math.PI / 2;
        p.push();
        p.translate(cx, cy);
        p.rotate(angle);
        p.noFill();
        p.stroke(139, 90, 43, 150);
        p.strokeWeight(3);
        p.arc(0, 0, T * 0.7, T * 0.7, -Math.PI * 0.4, Math.PI * 0.4);
        p.pop();
    }
}
