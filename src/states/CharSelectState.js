import { State } from './State.js';
import { GameStage } from '../config/GameStage.js';
import { CHARACTERS } from '../config/CharacterConfig.js';
import { getPixelatedSprite } from '../utils/PixelSprite.js';

// Player accent colours used in UI
const PLAYER_COLOURS = [
    [90, 170, 255],  // P1 blue
    [255, 200, 80],  // P2 orange
    [100, 220, 120], // P3 green
    [255, 120, 150], // P4 pink
];

// Input method labels
const INPUT_LABELS = [
    '键盘 WASD',
    '键盘 方向键',
    '手柄1',
    '手柄2',
];

// Card layout (fits 4 cards in 960px canvas)
const CARD_W = 175;
const CARD_H = 200;
const CARD_GAP = 20;
const SPRITE_SCALE = 3;

/**
 * CharSelectState — character selection screen.
 *
 * Phase 1: Select player count (2/3/4)
 * Phase 2: Each player picks a character and enters nickname
 */
export class CharSelectState extends State {
    enter() {
        this._phase = 'count'; // 'count' or 'char'
        this._playerCount = 2;
        this._currentTurn = 0;
        this._hovered = null;
        this._highlighted = null;
        this._chosen = [];
        this._nicknames = [];
        this._pendingNameFor = null;
        this._animTick = 0;
        this._cardFrameCache = new Map();
        this._countHovered = null; // which count button is hovered
    }

    update(deltaTime) {
        this._animTick += deltaTime;
    }

    render(mx, my) {
        const { p, gameWidth, gameHeight } = this.ctx;

        if (this._phase === 'count') {
            this._renderCountSelect(mx, my, p, gameWidth, gameHeight);
        } else {
            const col = PLAYER_COLOURS[this._currentTurn];
            this._renderCharacterSelect(mx, my, p, gameWidth, gameHeight, col);
        }
    }

    // ── Phase 1: Player count selection ────────────────────────────────

    _renderCountSelect(mx, my, p, gameWidth, gameHeight) {
        p.background(12, 14, 24);

        // Title
        p.noStroke();
        p.fill(255, 255, 255);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(12);
        p.text('选择玩家人数', gameWidth / 2, 80);

        p.fill(160, 160, 190);
        p.textSize(5);
        p.text('选择后进入角色选择', gameWidth / 2, 110);

        // Count buttons: 2, 3, 4
        const btnW = 140;
        const btnH = 160;
        const gap = 30;
        const totalW = 3 * btnW + 2 * gap;
        const startX = (gameWidth - totalW) / 2;
        const btnY = (gameHeight - btnH) / 2 - 20;

        this._countHovered = null;

        for (let i = 0; i < 3; i++) {
            const count = i + 2;
            const bx = startX + i * (btnW + gap);
            const isHovered = mx >= bx && mx <= bx + btnW && my >= btnY && my <= btnY + btnH;

            if (isHovered) this._countHovered = count;

            // Button background
            p.fill(isHovered ? [35, 42, 70] : [20, 24, 40]);
            p.noStroke();
            p.rect(bx, btnY, btnW, btnH, 12);

            if (isHovered) {
                p.stroke(100, 180, 255);
                p.strokeWeight(2);
                p.noFill();
                p.rect(bx, btnY, btnW, btnH, 12);
                p.noStroke();
            }

            // Number
            p.fill(255, 255, 255);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(24);
            p.text(count, bx + btnW / 2, btnY + btnH / 2 - 20);

            // Label
            p.fill(160, 160, 190);
            p.textSize(5.5);
            p.text(`${count} 人游戏`, bx + btnW / 2, btnY + btnH / 2 + 20);

            // Player icons
            const iconY = btnY + btnH - 35;
            for (let j = 0; j < count; j++) {
                const iconX = bx + btnW / 2 - (count * 14) / 2 + j * 14 + 7;
                p.fill(...PLAYER_COLOURS[j]);
                p.circle(iconX, iconY, 10);
            }
        }

        // Controls hint
        p.fill(70, 70, 90);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.textSize(5);
        p.text('点击选择人数  •  ESC 返回', gameWidth / 2, gameHeight - 8);
    }

    // ── Phase 2: Character selection ───────────────────────────────────

    _renderCharacterSelect(mx, my, p, gameWidth, gameHeight, col) {
        p.background(12, 14, 24);

        // Title
        p.noStroke();
        p.fill(...col);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(10);
        p.text(
            `P${this._currentTurn + 1} — 选择你的角色`,
            gameWidth / 2,
            12,
        );

        p.fill(160, 160, 190);
        p.textSize(5);
        p.text(
            `操控方式：${INPUT_LABELS[this._currentTurn]}`,
            gameWidth / 2,
            34,
        );

        p.fill(120, 120, 150);
        p.textSize(4.5);
        p.text(
            this._pendingNameFor
                ? '在选中角色上方输入昵称  •  回车确认  •  ESC 取消'
                : '点击角色进行选择  •  悬停查看属性',
            gameWidth / 2,
            50,
        );

        // Character cards
        const totalW = CHARACTERS.length * CARD_W + (CHARACTERS.length - 1) * CARD_GAP;
        const startX = (gameWidth - totalW) / 2;
        const cardY = (gameHeight - CARD_H) / 2 - 10;

        this._hovered = null;
        let hoveredChar = null;

        CHARACTERS.forEach((char, i) => {
            const cx = startX + i * (CARD_W + CARD_GAP);
            const isHovered = mx >= cx && mx <= cx + CARD_W && my >= cardY && my <= cardY + CARD_H;
            const takenBy = this._takenBy(char.id);
            const isTaken = takenBy !== null;
            const isChosen = this._chosen[this._currentTurn] === char.id;

            if (isHovered && !isTaken) {
                this._hovered = char.id;
                hoveredChar = char;
            }

            // Card background
            if (isChosen) {
                p.fill(45, 55, 90);
            } else if (isHovered && !isTaken) {
                p.fill(32, 38, 62);
            } else {
                p.fill(20, 22, 38);
            }
            p.noStroke();
            p.rect(cx, cardY, CARD_W, CARD_H, 10);

            // Selection border
            if (isChosen) {
                p.stroke(...col);
                p.strokeWeight(2.5);
                p.noFill();
                p.rect(cx, cardY, CARD_W, CARD_H, 10);
                p.noStroke();
            } else if (isHovered && !isTaken) {
                p.stroke(100, 110, 160);
                p.strokeWeight(1.5);
                p.noFill();
                p.rect(cx, cardY, CARD_W, CARD_H, 10);
                p.noStroke();
            }

            // Sprite preview
            const spriteSheet = this.ctx.sprites[char.spriteKey];
            if (spriteSheet) {
                this._drawCardSprite(p, char, spriteSheet, cx, cardY, isTaken);
            } else {
                p.noStroke();
                p.fill(...char.colour, isTaken ? 80 : 180);
                p.circle(cx + CARD_W / 2, cardY + 90, 60);
            }

            // Character name
            p.noStroke();
            p.fill(isTaken ? [80, 80, 90] : [220, 220, 240]);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(6);
            p.text(char.displayName, cx + CARD_W / 2, cardY + CARD_H - 28);

            // Taken badge
            if (isTaken) {
                const takenCol = PLAYER_COLOURS[takenBy];
                p.fill(0, 0, 0, 130);
                p.rect(cx, cardY, CARD_W, CARD_H, 10);
                p.fill(...takenCol);
                p.textSize(5);
                p.textAlign(p.CENTER, p.CENTER);
                p.text(`P${takenBy + 1}`, cx + CARD_W / 2, cardY + CARD_H - 20);
            }

            // Name input
            if (this._pendingNameFor === char.id && this._currentTurn < this._playerCount) {
                this._drawInlineNameInput(p, cx + CARD_W / 2, cardY + 14, col, this._nicknames[this._currentTurn]);
            }
        });

        // Hover details popup
        if (hoveredChar && !this._takenBy(hoveredChar.id)) {
            this._drawCharacterDetailsPopup(p, hoveredChar, mx, my, gameWidth, gameHeight);
        }

        // Player turn indicators
        const dotsY = cardY + CARD_H + 22;
        const dotsTotalW = this._playerCount * 24;
        const dotsStartX = (gameWidth - dotsTotalW) / 2;

        for (let i = 0; i < this._playerCount; i++) {
            const dotX = dotsStartX + i * 24 + 12;
            const active = i === this._currentTurn;
            p.fill(active ? PLAYER_COLOURS[i] : [40, 40, 55]);
            p.noStroke();
            p.circle(dotX, dotsY, active ? 13 : 9);

            if (this._chosen[i]) {
                const charName = CHARACTERS.find((c) => c.id === this._chosen[i])?.displayName ?? '';
                p.fill(PLAYER_COLOURS[i]);
                p.textAlign(p.CENTER, p.TOP);
                p.textSize(4);
                p.text(charName, dotX, dotsY + 10);
            }
        }

        // Controls hint
        p.fill(70, 70, 90);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.textSize(5);
        p.text(
            this._pendingNameFor
                ? '回车确认昵称  •  退格删除  •  ESC 取消选择'
                : '点击选择角色',
            gameWidth / 2,
            gameHeight - 4,
        );
    }

    // ── Input ──────────────────────────────────────────────────────────

    mousePressed(mx, my) {
        if (this._phase === 'count') {
            if (this._countHovered) {
                this._playerCount = this._countHovered;
                this._chosen = new Array(this._playerCount).fill(null);
                this._nicknames = new Array(this._playerCount).fill('');
                this.ctx.playerCount = this._playerCount;
                this._phase = 'char';
            }
            return;
        }

        if (this._pendingNameFor) return;

        const { gameWidth, gameHeight } = this.ctx;
        const totalW = CHARACTERS.length * CARD_W + (CHARACTERS.length - 1) * CARD_GAP;
        const startX = (gameWidth - totalW) / 2;
        const cardY = (gameHeight - CARD_H) / 2 - 10;

        CHARACTERS.forEach((char, i) => {
            const cx = startX + i * (CARD_W + CARD_GAP);
            if (mx >= cx && mx <= cx + CARD_W && my >= cardY && my <= cardY + CARD_H) {
                if (this._takenBy(char.id) !== null) return;
                this._selectChar(char);
            }
        });
    }

    keyPressed() {
        const { p } = this.ctx;

        if (this._phase === 'count') {
            if (p.keyCode === p.ESCAPE) {
                this.goTo(GameStage.MENU);
            }
            // Number keys 2/3/4 to select count
            if (p.key === '2' || p.key === '3' || p.key === '4') {
                this._playerCount = parseInt(p.key);
                this._chosen = new Array(this._playerCount).fill(null);
                this._nicknames = new Array(this._playerCount).fill('');
                this.ctx.playerCount = this._playerCount;
                this._phase = 'char';
            }
            return;
        }

        if (this._pendingNameFor) {
            if (p.keyCode === p.ENTER || p.keyCode === 13) {
                this._confirmCurrentName();
            } else if (p.keyCode === p.BACKSPACE) {
                this._nicknames[this._currentTurn] = this._nicknames[this._currentTurn].slice(0, -1);
            } else if (p.keyCode === p.ESCAPE) {
                this._cancelCurrentSelection();
            } else if (p.key && p.key.length === 1 && /[a-zA-Z0-9 ]/.test(p.key)) {
                if (this._nicknames[this._currentTurn].length < 12) {
                    this._nicknames[this._currentTurn] += p.key;
                }
            }
        } else if (p.keyCode === p.ESCAPE) {
            this._stepBackSelectionFlow();
        }
    }

    // ── Private ────────────────────────────────────────────────────────

    _selectChar(char) {
        const playerIdx = this._currentTurn;
        const player = this.ctx.players[playerIdx];

        this._chosen[playerIdx] = char.id;
        player.character = char;

        const sheet = this.ctx.sprites[char.spriteKey];
        if (sheet) player.setSprite(sheet, char.animConfig);

        if (char.speed !== undefined) player.speed = char.speed;
        if (char.jumpVel !== undefined) player.jumpVel = char.jumpVel;
        if (char.maxJumps !== undefined) {
            player.maxJumps = char.maxJumps;
            player.jumpsLeft = char.maxJumps;
        }
        if (char.gravity !== undefined) player.gravity = char.gravity;

        this._pendingNameFor = char.id;
    }

    _confirmCurrentName(useDefault = false) {
        const fallback = `玩家${this._currentTurn + 1}`;
        const value = useDefault ? fallback : this._nicknames[this._currentTurn].trim() || fallback;
        this._nicknames[this._currentTurn] = value;
        this.ctx.players[this._currentTurn].nickname = value;
        this._pendingNameFor = null;
        this._currentTurn++;
        if (this._currentTurn >= this._playerCount) {
            this.goTo(GameStage.WALK_MAP);
        }
    }

    _cancelCurrentSelection() {
        const playerIdx = this._currentTurn;
        this._pendingNameFor = null;
        this._resetPlayerSelection(playerIdx);
    }

    _stepBackSelectionFlow() {
        if (this._pendingNameFor) {
            this._cancelCurrentSelection();
            return;
        }
        if (this._currentTurn <= 0) {
            // Go back to count selection
            this._phase = 'count';
            return;
        }
        const previousPlayerIdx = this._currentTurn - 1;
        this._resetPlayerSelection(previousPlayerIdx);
        this._currentTurn = previousPlayerIdx;
    }

    _resetPlayerSelection(playerIdx) {
        this._chosen[playerIdx] = null;
        this._nicknames[playerIdx] = '';
        const player = this.ctx.players[playerIdx];
        if (!player) return;
        player.character = null;
        player.nickname = `玩家${playerIdx + 1}`;
    }

    _takenBy(charId) {
        for (let i = 0; i < this._chosen.length; i++) {
            if (this._chosen[i] === charId) return i;
        }
        return null;
    }

    _drawCardSprite(p, char, spriteSheet, cx, cardY, dimmed) {
        const fw = 28;
        const fh = spriteSheet.height;
        const scale = SPRITE_SCALE;

        const previewFrames =
            char.id === 'duck' && char.animConfig.RUN?.length
                ? char.animConfig.RUN
                : char.animConfig.IDLE;
        const frameIdx = previewFrames[Math.floor(this._animTick / 160) % previewFrames.length];

        const srcX = frameIdx * fw;
        const frameKey = `${char.id}:${frameIdx}`;
        let frame = this._cardFrameCache.get(frameKey);
        if (!frame) {
            frame = spriteSheet.get(srcX, 0, fw, fh);
            this._cardFrameCache.set(frameKey, frame);
        }
        const displayFrame = getPixelatedSprite(p, frame, char.pixelScale ?? 1);

        const drawW = fw * scale;
        const drawH = fh * scale;
        const drawX = cx + (CARD_W - drawW) / 2;
        const drawY = cardY + 20;

        p.push();
        p.noSmooth();
        if (dimmed) p.tint(255, 80);
        p.image(displayFrame, drawX, drawY, drawW, drawH);
        p.noTint();
        p.pop();
    }

    _drawInlineNameInput(p, cx, y, col, value) {
        const boxW = 132;
        const boxH = 28;
        const boxX = cx - boxW / 2;
        const display = value || '输入昵称';

        p.noStroke();
        p.fill(18, 22, 38, 235);
        p.rect(boxX, y, boxW, boxH, 7);
        p.fill(255, 255, 255, 14);
        p.rect(boxX + 2, y + 2, boxW - 4, boxH * 0.38, 5);
        p.stroke(...col);
        p.strokeWeight(1.8);
        p.noFill();
        p.rect(boxX, y, boxW, boxH, 7);
        p.noStroke();

        p.fill(...col);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(5);
        p.text(display, cx, y + boxH / 2 + 1);
    }

    _drawCharacterDetailsPopup(p, char, mx, my, gameWidth, gameHeight) {
        const popupW = 220;
        const popupH = 180;

        let popupX = mx + 15;
        let popupY = my - 60;
        if (popupX + popupW > gameWidth) popupX = gameWidth - popupW - 10;
        if (popupY < 10) popupY = 10;

        p.noStroke();
        p.fill(12, 16, 28);
        p.rect(popupX, popupY, popupW, popupH, 8);

        p.stroke(100, 110, 160);
        p.strokeWeight(1.5);
        p.noFill();
        p.rect(popupX, popupY, popupW, popupH, 8);
        p.noStroke();

        p.fill(...char.colour);
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(7);
        p.text(char.displayName, popupX + 12, popupY + 10);

        p.fill(150, 150, 180);
        p.textSize(5);
        p.text(char.tagline || '', popupX + 12, popupY + 28);

        if (char.stats) {
            const statKeys = Object.keys(char.stats);
            let statY = popupY + 48;

            statKeys.forEach((key) => {
                const val = char.stats[key];
                const maxVal = 5;

                p.fill(160, 160, 190);
                p.textSize(5);
                p.textAlign(p.LEFT, p.CENTER);
                p.text(key + ':', popupX + 12, statY + 5);

                const barX = popupX + 80;
                const barW = 120;
                const barH = 6;

                p.fill(40, 45, 70);
                p.noStroke();
                p.rect(barX, statY - 3, barW, barH, 2);

                p.fill(...char.colour);
                p.rect(barX, statY - 3, (barW * val) / maxVal, barH, 2);

                p.fill(200, 200, 220);
                p.textSize(5);
                p.textAlign(p.RIGHT, p.CENTER);
                p.text(val + '/' + maxVal, popupX + popupW - 12, statY + 5);

                statY += 22;
            });
        }
    }
}
