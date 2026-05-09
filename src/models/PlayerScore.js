/**
 * PlayerScore — data record for one player's round statistics.
 */
export class PlayerScore {
    constructor(playerNo) {
        this.playerNo = playerNo;
        this.finished = false;
        this.finishTime = null;
        this.deaths = 0;
        this.coins = 0;
        this.wallet = 0;
        this.rank = null;

        // New fields for scoring system
        this.kills = 0;           // kills by this player's traps
        this.totalKills = 0;      // total kills including all players
        this.specialCoins = 0;    // rainbow coins collected
        this.points = 0;          // total points this round
        this.jumpCount = 0;       // jumps used this round
        this.consecutiveDeaths = 0; // for "反复去世" title
        this.lastDeathTime = 0;
        this.deathBeforeFinish = 0; // deaths near finish line
        this.killedBy = new Map(); // who killed this player most
        this.trapTypesKilled = new Set(); // unique trap types that killed this player
        this.finishWithoutDeath = false;
        this.onlyFinisher = false;
        this.consecutiveFailures = 0;
        this.rainbowCoinStreak = 0;
    }

    get finishTimeFormatted() {
        if (this.finishTime === null) return '—';
        const mins = Math.floor(this.finishTime / 60);
        const secs = (this.finishTime % 60).toFixed(1).padStart(4, '0');
        return mins > 0 ? `${mins}:${secs}` : `${secs}s`;
    }

    get rankFormatted() {
        if (this.rank === null) return '—';
        const suffixes = ['st', 'nd', 'rd'];
        const suffix = suffixes[this.rank - 1] ?? 'th';
        return `${this.rank}${suffix}`;
    }
}
