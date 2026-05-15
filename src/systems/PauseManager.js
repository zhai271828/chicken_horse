/**
 * PauseManager — manages the pause state during an active game round.
 *
 * Buttons: ▶ Resume  ↺ Restart Round  ? How to Play  ✕ Quit to Menu
 *
 * Usage (inside RunState):
 *   this.pauseManager = new PauseManager(p, gameWidth, gameHeight);
 *
 *   if (this.pauseManager.isPaused) {
 *       this.pauseManager.mousePressed(mx, my,
 *           () => this.pauseManager.resume(),
 *           () => { this._resetRound(); this.pauseManager.resume(); },
 *           () => this.goTo(GameStage.TUTORIAL_PAUSE),   // or handle inline
 *           () => this.goTo(GameStage.MENU)
 *       );
 *   }
 */
export class PauseManager {
    constructor(p, gameWidth, gameHeight, audioManager = null) {
        this.p = p;
        this.gameWidth = gameWidth;
        this.gameHeight = gameHeight;
        this._paused = false;
        this.audioManager = audioManager;
        this._activeSlider = null;

        // Five action buttons + audio settings row
        const bW = 200;
        const bH = 44;
        const gap = 10;
        const cx = gameWidth / 2;

        const stackH = bH * 5 + gap * 4;
        const topY = gameHeight / 2 - stackH / 2 - 8;

        this._btnResume = { x: cx - bW / 2, y: topY, w: bW, h: bH };
        this._btnRestart = {
            x: cx - bW / 2,
            y: topY + (bH + gap),
            w: bW,
            h: bH,
        };
        this._btnTutorial = {
            x: cx - bW / 2,
            y: topY + (bH + gap) * 2,
            w: bW,
            h: bH,
        };
        this._btnQuit = {
            x: cx - bW / 2,
            y: topY + (bH + gap) * 3,
            w: bW,
            h: bH,
        };
        this._btnDevMode = {
            x: cx - bW / 2,
            y: topY + (bH + gap) * 4,
            w: bW,
            h: bH,
        };

        const sliderW = 178;
        const sliderH = 10;
        const sliderY = topY + stackH + 54;
        this._sliderSFX = { x: cx - sliderW / 2, y: sliderY, w: sliderW, h: sliderH };
        this._sliderMusic = {
            x: cx - sliderW / 2,
            y: sliderY + 54,
            w: sliderW,
            h: sliderH,
        };
    }

    // ── Public API ────────────────────────────────────────────────────────

    get isPaused() {
        return this._paused;
    }

    pause() {
        this._paused = true;
    }
    resume() {
        this._paused = false;
    }
    toggle() {
        this._paused = !this._paused;
    }

    /**
     * Draw the pause overlay. Call at the end of RunState.render().
     * @param mx
     * @param my
     */
    render(mx, my) {
        if (!this._paused) return;

        const p = this.p;
        const gW = this.gameWidth;
        const gH = this.gameHeight;

        // Dim overlay
        p.noStroke();
        p.fill(0, 0, 0, 160);
        p.rect(0, 0, gW, gH);

        // Panel — fits 5 buttons + audio settings row
        const panW = 300;
        const panH = 500;
        const panX = gW / 2 - panW / 2;
        const panY = gH / 2 - panH / 2;

        p.fill(16, 20, 36);
        p.rect(panX, panY, panW, panH, 12);
        p.stroke(60, 90, 160);
        p.strokeWeight(1.5);
        p.noFill();
        p.rect(panX, panY, panW, panH, 12);
        p.noStroke();

        // Title
        p.fill(200, 215, 255);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(10);
        p.text('游戏暂停', gW / 2, panY + 18);

        // Separator
        p.stroke(45, 60, 110);
        p.strokeWeight(1);
        p.line(panX + 24, panY + 52, panX + panW - 24, panY + 52);
        p.noStroke();

        // ESC hint
        p.fill(70, 85, 130);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(5.5);
        p.text('按 ESC 继续游戏', gW / 2, panY + 58);

        // Buttons
        this._drawButton(
            p,
            mx,
            my,
            this._btnResume,
            '▶  继续游戏',
            [50, 130, 60],
            [70, 160, 80],
            [210, 245, 215],
        );

        this._drawButton(
            p,
            mx,
            my,
            this._btnRestart,
            '↺  重新开始本轮',
            [40, 90, 150],
            [55, 115, 185],
            [190, 220, 255],
        );

        this._drawButton(
            p,
            mx,
            my,
            this._btnTutorial,
            '?  操作指南',
            [80, 65, 130],
            [105, 85, 165],
            [215, 200, 255],
        );

        this._drawButton(
            p,
            mx,
            my,
            this._btnQuit,
            '✕  退出到主菜单',
            [110, 32, 32],
            [145, 45, 45],
            [250, 180, 180],
        );

        this._drawButton(
            p,
            mx,
            my,
            this._btnDevMode,
            '🛠  开发者模式',
            [80, 80, 40],
            [110, 110, 60],
            [220, 220, 140],
        );

        // Divider
        p.stroke(45, 60, 110);
        p.strokeWeight(1);
        const divY = this._sliderSFX.y - 28;
        p.line(panX + 24, divY, panX + panW - 24, divY);
        p.noStroke();

        // Label
        p.fill(90, 105, 155);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(5.5);
        p.text('音频设置', gW / 2, divY + 4);

        this._drawSlider(
            p,
            mx,
            my,
            this._sliderSFX,
            'SFX',
            this.audioManager?.sfxVolume ?? 0.85,
        );
        this._drawSlider(
            p,
            mx,
            my,
            this._sliderMusic,
            'Music',
            this.audioManager?.musicVolume ?? 0.25,
        );
    }

    /**
     * Route a click to the correct callback while paused.
     * @param mx
     * @param my
     * @param {Function} onResume
     * @param {Function} onRestart
     * @param {Function} onTutorial
     * @param {Function} onQuit
     * @param {Function} onDevMode
     */
    mousePressed(mx, my, onResume, onRestart, onTutorial, onQuit, onDevMode) {
        if (!this._paused) return;

        if (this.audioManager && this._sliderHit(mx, my, this._sliderSFX)) {
            this._activeSlider = 'sfx';
            this._setSliderFromMouse(this._sliderSFX, 'sfx', mx);
            return;
        }
        if (this.audioManager && this._sliderHit(mx, my, this._sliderMusic)) {
            this._activeSlider = 'music';
            this._setSliderFromMouse(this._sliderMusic, 'music', mx);
            return;
        }

        if (this._hits(mx, my, this._btnResume)) onResume();
        else if (this._hits(mx, my, this._btnRestart)) onRestart();
        else if (this._hits(mx, my, this._btnTutorial)) onTutorial();
        else if (this._hits(mx, my, this._btnQuit)) onQuit();
        else if (this._hits(mx, my, this._btnDevMode) && onDevMode) onDevMode();
    }

    mouseDragged(mx, _my) {
        if (!this._paused || !this.audioManager || !this._activeSlider) return;
        const slider =
            this._activeSlider === 'sfx' ? this._sliderSFX : this._sliderMusic;
        this._setSliderFromMouse(slider, this._activeSlider, mx);
    }

    mouseReleased() {
        this._activeSlider = null;
    }

    // ── Private ───────────────────────────────────────────────────────────

    _drawButton(p, mx, my, btn, label, baseCol, hoverCol, textCol) {
        const hov = this._hits(mx, my, btn);
        p.noStroke();
        p.fill(hov ? hoverCol : baseCol);
        p.rect(btn.x, btn.y, btn.w, btn.h, 8);
        p.fill(255, 255, 255, hov ? 22 : 14);
        p.rect(btn.x, btn.y, btn.w, btn.h * 0.45, 8);
        p.rect(btn.x, btn.y + btn.h * 0.45, btn.w, btn.h * 0.55);
        p.fill(...textCol);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(6.4);
        p.text(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
    }

    _drawSlider(p, mx, my, slider, label, value) {
        const hov = this._sliderHit(mx, my, slider);
        const clamped = Math.max(0, Math.min(1, Number(value) || 0));
        const fillW = slider.w * clamped;
        const thumbX = slider.x + fillW;
        const percent = Math.round(clamped * 100);

        p.fill(205, 214, 235);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.textSize(5.2);
        p.text(label, slider.x, slider.y - 8);

        p.fill(140, 150, 175);
        p.textAlign(p.RIGHT, p.BOTTOM);
        p.text(`${percent}%`, slider.x + slider.w, slider.y - 8);

        p.noStroke();
        p.fill(hov ? [44, 52, 76] : [34, 40, 60]);
        p.rect(slider.x, slider.y, slider.w, slider.h, 999);
        p.fill(76, 148, 230);
        p.rect(slider.x, slider.y, fillW, slider.h, 999);

        p.fill(236, 242, 255);
        p.circle(thumbX, slider.y + slider.h / 2, hov ? 16 : 14);
        p.fill(76, 148, 230);
        p.circle(thumbX, slider.y + slider.h / 2, hov ? 7 : 6);
    }

    _hits(mx, my, btn) {
        return (
            mx >= btn.x &&
            mx <= btn.x + btn.w &&
            my >= btn.y &&
            my <= btn.y + btn.h
        );
    }

    _sliderHit(mx, my, slider) {
        return (
            mx >= slider.x - 8 &&
            mx <= slider.x + slider.w + 8 &&
            my >= slider.y - 12 &&
            my <= slider.y + slider.h + 12
        );
    }

    _setSliderFromMouse(slider, type, mx) {
        const ratio = (mx - slider.x) / slider.w;
        this.audioManager?.setVolume(type, ratio);
    }
}
