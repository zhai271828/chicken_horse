/**
 * AudioManager — Web Audio API based sound system.
 *
 * No external audio files required. All sounds are synthesised
 * procedurally using OscillatorNode / GainNode.
 *
 * Public API:
 *   playSound(name)          — play a one-shot SFX ('coin', 'death', 'finish', 'jump', 'bounce')
 *   playMusic()              — start the looping background melody
 *   stopMusic()              — stop background music immediately
 *   toggleAudio(type)        — type: 'sfx' | 'music' | 'all'
 *   get sfxEnabled           — bool
 *   get musicEnabled         — bool
 *
 * Wire into ctx in sketch.js and call from game states.
 */
export class AudioManager {
    constructor() {
        this._ctx = null;
        this._musicTrack = null;
        this._sfxVolume = 0.85;
        this._musicVolume = 0.25;
        this._lastNonZeroSfxVolume = this._sfxVolume;
        this._lastNonZeroMusicVolume = this._musicVolume;
        this._musicPlaying = false;
        this._musicWanted = false;
    }

    // ── Public getters ────────────────────────────────────────────────────

    get sfxEnabled() {
        return this._sfxVolume > 0.001;
    }
    get musicEnabled() {
        return this._musicVolume > 0.001;
    }
    get sfxVolume() {
        return this._sfxVolume;
    }
    get musicVolume() {
        return this._musicVolume;
    }

    // ── Initialise ────────────────────────────────────────────────────────

    /** Call once on first user interaction to unlock the AudioContext. */
    _ensureCtx() {
        if (this._ctx) return;
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();

        this._musicGain = this._ctx.createGain();
        this._musicGain.gain.value = 0.18;
        this._musicGain.connect(this._ctx.destination);
    }

    /**
     * Play a one-shot synthesised sound effect.
     * @param {'coin'|'death'|'finish'|'jump'|'bounce'} name
     */
    playSound(name) {
        if (!this.sfxEnabled) return;
        const now = performance.now();
        if (!this._lastSfxTime) this._lastSfxTime = {};
        if (this._lastSfxTime[name] && now - this._lastSfxTime[name] < 80)
            return;
        this._lastSfxTime[name] = now;

        try {
            this._ensureCtx();
            const ac = this._ctx;
            const t = ac.currentTime;

            switch (name) {
                case 'coin':
                    this._tone(
                        ac,
                        t,
                        1500,
                        0.05,
                        'sine',
                        0.7 * this._sfxVolume,
                        [
                            [0, 0.7],
                            [0.05, 0.0],
                        ],
                        2000,
                    );
                    break;
                case 'jump':
                    this._tone(
                        ac,
                        t,
                        800,
                        0.1,
                        'sawtooth',
                        0.6 * this._sfxVolume,
                        [
                            [0, 0.6],
                            [0.1, 0.0],
                        ],
                        1200,
                    );
                    break;
                case 'bounce':
                    this._tone(
                        ac,
                        t,
                        1200,
                        0.06,
                        'sine',
                        0.6 * this._sfxVolume,
                        [
                            [0, 0.6],
                            [0.06, 0.0],
                        ],
                        600,
                    );
                    break;
                case 'death':
                    this._tone(
                        ac,
                        t,
                        620,
                        0.18,
                        'triangle',
                        0.6 * this._sfxVolume,
                        [
                            [0, 0.9],
                            [0.18, 0.0],
                        ],
                        180,
                    );
                    this._tone(
                        ac,
                        t + 0.04,
                        240,
                        0.32,
                        'sawtooth',
                        0.38 * this._sfxVolume,
                        [
                            [0, 0.55],
                            [0.32, 0.0],
                        ],
                        90,
                    );
                    break;
                case 'finish':
                    this._chord(
                        ac,
                        t,
                        [880, 1108, 1318, 1760],
                        0.9 * this._sfxVolume,
                    );
                    break;
            }
        } catch (e) {}
    }

    setMusicTrack(track) {
        this._musicTrack = track;
        this._applyMusicVolume();
    }

    /**
     * Start the background music loop (simple 8-bit style melody).
     * Safe to call multiple times — won't double-start.
     */
    playMusic() {
        this._musicWanted = true;
        try {
            if (!this._musicTrack || !this.musicEnabled) return;
            this._musicTrack.setLoop(true);
            this._musicTrack.setVolume(this._musicVolume);
            if (!this._musicTrack.isPlaying()) {
                this._musicTrack.play();
            }
            this._musicPlaying = this._musicTrack.isPlaying();
        } catch (e) {}
    }

    /** Stop background music. */
    stopMusic() {
        this._musicWanted = false;
        this._musicPlaying = false;
        try {
            if (this._musicTrack?.isPlaying()) {
                this._musicTrack.stop();
            }
        } catch (e) {}
    }

    /**
     * Toggle a specific audio type.
     * @param {'sfx'|'music'|'all'} type
     */
    toggleAudio(type) {
        if (type === 'sfx' || type === 'all') {
            this.setVolume(
                'sfx',
                this.sfxEnabled ? 0 : this._lastNonZeroSfxVolume || 0.85,
            );
        }
        if (type === 'music' || type === 'all') {
            this.setVolume(
                'music',
                this.musicEnabled ? 0 : this._lastNonZeroMusicVolume || 0.25,
            );
        }
    }

    setVolume(type, value) {
        const next = Math.max(0, Math.min(1, Number(value) || 0));
        if (type === 'sfx') {
            this._sfxVolume = next;
            if (next > 0) this._lastNonZeroSfxVolume = next;
            return;
        }
        if (type === 'music') {
            this._musicVolume = next;
            if (next > 0) this._lastNonZeroMusicVolume = next;
            this._applyMusicVolume();
        }
    }
    /**
     * Play a single synthesised tone.
     * @param {AudioContext} ac
     * @param {number} t         - AudioContext start time
     * @param {number} freq      - Start frequency (Hz)
     * @param {number} duration  - Duration (s)
     * @param {string} type      - OscillatorType
     * @param {number} volume    - Peak gain
     * @param {number[][]} env   - [[time, gain], ...] envelope points
     * @param {number} [endFreq] - Frequency at end (for pitch sweep)
     * @private
     */
    _tone(ac, t, freq, duration, type, volume, env, endFreq) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (endFreq !== undefined) {
            osc.frequency.linearRampToValueAtTime(endFreq, t + duration);
        }

        gain.gain.setValueAtTime(0, t);
        for (const [dt, v] of env) {
            gain.gain.linearRampToValueAtTime(v * volume, t + dt);
        }

        osc.connect(gain);
        gain.connect(this._ctx.destination);
        osc.start(t);
        osc.stop(t + duration);
    }

    /**
     * Play a short ascending chord (victory / finish sound).
     * @param ac
     * @param t
     * @param freqs
     * @param vol
     * @private
     */
    _chord(ac, t, freqs, vol) {
        freqs.forEach((freq, i) => {
            const delay = i * 0.08;
            const duration = 0.4;
            this._tone(ac, t + delay, freq, duration, 'sine', vol, [
                [0, 0.18],
                [duration * 0.8, 0.0],
            ]);
        });
    }

    _applyMusicVolume() {
        try {
            if (this._musicTrack) {
                this._musicTrack.setVolume(this._musicVolume);
            }
            if (!this.musicEnabled) {
                if (this._musicTrack?.isPlaying()) {
                    this._musicTrack.stop();
                }
                this._musicPlaying = false;
                return;
            }
            if (this._musicWanted && this._musicTrack && !this._musicTrack.isPlaying()) {
                this._musicTrack.setLoop(true);
                this._musicTrack.play();
                this._musicPlaying = true;
            }
        } catch (e) {}
    }
}
