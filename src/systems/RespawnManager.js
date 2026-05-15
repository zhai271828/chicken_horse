import { GameConfig } from '../config/GameConfig.js';
import { PlayerState } from '../config/PlayerState.js';

export class RespawnManager {
    constructor(scoreManager = null) {
        this.queue = [];
        this.scoreManager = scoreManager;
    }

    /**
     * Kills a player and queues them for respawn.
     * @param {Player} player
     * @param {string} reason - DeathReason value
     * @param {number|null} killerPlayerNo - who caused this death (for scoring)
     * @param {string|null} trapType - obstacle type for title statistics
     */
    triggerDeath(player, reason, killerPlayerNo = null, trapType = null) {
        if (player.lifeState !== PlayerState.ALIVE) return;
        if (player.invincibleUntil && Date.now() < player.invincibleUntil) return;

        player.die(reason);
        this.scoreManager?.recordDeath(player, killerPlayerNo, trapType);

        this.queue.push({
            player: player,
            timer: GameConfig.RESPAWN_TIME,
            phase: 'dead',
        });
    }

    update(deltaTime) {
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const record = this.queue[i];

            record.timer -= deltaTime;

            if (record.timer <= 0) {
                if (record.phase === 'dead') {
                    record.player.prepareRespawn();
                    record.phase = 'respawning';
                    record.timer = GameConfig.RESPAWN_TIME / 2;
                } else if (record.phase === 'respawning') {
                    record.player.finishRespawn();
                    this.queue.splice(i, 1);
                }
            } else {
                let totalRemainingMs = record.timer;
                if (record.phase === 'dead')
                    totalRemainingMs += GameConfig.RESPAWN_TIME / 2;
                record.player.respawnCountdown = totalRemainingMs / 1000;
            }
        }
    }

    clear() {
        this.queue = [];
    }
}
