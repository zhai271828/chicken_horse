import { RectButton } from '../utils/RectButton.js';
import { RoundButton } from '../utils/RoundButton.js';
import { GameConfig } from '../config/GameConfig.js';

/**
 * @description splash screen display
 * Handles rendering of the start menu UI
 * @class
 */

export class SplashScreen {
    /**
     * @description creates splash screen
     * @param {p5} p - The p5 instance
     * @param {string} stage - Current game stage
     * @param gameWidth
     * @param gameHeight
     * @param bgImage
     * @param menuFont
     */
    constructor(p, gameWidth, gameHeight, bgImage = null, menuFont = null) {
        this.gameWidth = gameWidth;
        this.gameHeight = gameHeight;
        this.bgImage = bgImage;
        this.menuFont = menuFont;
        const centerX = gameWidth / 2;
        const buttonGap = 28;
        const totalButtonsWidth =
            GameConfig.BUTTON1_W + GameConfig.BUTTON2_W + buttonGap;
        const buttonsLeft = centerX - totalButtonsWidth / 2;
        const buttonY = Math.round(gameHeight * 0.67);

        this.button1 = new RectButton(
            p,
            buttonsLeft,
            buttonY,
            GameConfig.BUTTON1_W,
            GameConfig.BUTTON1_H,
            '教程',
        );
        this.button2 = new RectButton(
            p,
            buttonsLeft + GameConfig.BUTTON1_W + buttonGap,
            buttonY,
            GameConfig.BUTTON2_W,
            GameConfig.BUTTON2_H,
            '设置',
        );

        this.settingsPanel = {
            w: 380,
            h: 540,
            x: gameWidth / 2 - 190,
            y: gameHeight / 2 - 270,
        };
        this.displayFitButton = new RectButton(
            p,
            this.settingsPanel.x + 32,
            this.settingsPanel.y + 80,
            140,
            42,
            '标准视图',
        );
        this.displayStretchButton = new RectButton(
            p,
            this.settingsPanel.x + this.settingsPanel.w - 32 - 140,
            this.settingsPanel.y + 80,
            140,
            42,
            '拉伸视图',
        );
        this.aiOnButton = new RectButton(
            p,
            this.settingsPanel.x + 32,
            this.settingsPanel.y + 310,
            140,
            42,
            'AI 开启',
        );
        this.aiOffButton = new RectButton(
            p,
            this.settingsPanel.x + this.settingsPanel.w - 32 - 140,
            this.settingsPanel.y + 310,
            140,
            42,
            'AI 关闭',
        );
        this.apiKeyInputButton = new RectButton(
            p,
            this.settingsPanel.x + 32,
            this.settingsPanel.y + 420,
            this.settingsPanel.w - 64,
            42,
            '',
        );
        this.closeButton = new RoundButton(
            p,
            this.settingsPanel.x + this.settingsPanel.w - 26,
            this.settingsPanel.y + 26,
            22,
            'X',
        );
    }
    /**
     * @description renders splash screen
     * @param {p5} p - The p5 instance
     * @param {number} mx - Mouse X position
     * @param {number} my - Mouse Y position
     * @param showSettings
     * @param displayMode
     * @param aiMapFlag
     * @param apiKey
     * @param apiKeyFocused
     */
    render(
        p,
        mx,
        my,
        showSettings = false,
        displayMode = 'stretch',
        aiMapFlag = 1,
        apiKey = '',
        apiKeyFocused = false,
    ) {
        const scale = Math.min(this.gameWidth / 1920, this.gameHeight / 1080);
        const titleBaseX = 500 * (this.gameWidth / 1920);
        const titleX = titleBaseX;
        const titleY = 230 * (this.gameHeight / 1080);
        const promptX = 960 * (this.gameWidth / 1920);
        const promptY = 650 * (this.gameHeight / 1080);
        const homepageFont = this.menuFont ?? 'Noto Sans SC';
        const titleFontSize = Math.max(34, 140 * scale);
        const titleText = 'The Incredible\n ChickenBunny';

        // Branch-faithful title treatment
        p.textAlign(p.CENTER, p.CENTER);
        p.stroke(0);
        p.strokeWeight(Math.max(4, 8 * scale));
        p.textFont(homepageFont, titleFontSize);
        p.fill(
            GameConfig.TITLE_COLOUR.r,
            GameConfig.TITLE_COLOUR.g,
            GameConfig.TITLE_COLOUR.b,
        );
        p.text(titleText, titleX, titleY);

        // Animated prompt with pulsing effect - use Noto Sans SC for Chinese characters
        const pulseAlpha = 180 + 75 * Math.sin(p.frameCount * 0.05);
        p.textFont('Noto Sans SC', Math.max(16, 57 * scale));
        p.stroke(0);
        p.strokeWeight(Math.max(3, 8 * scale));
        p.fill(
            GameConfig.PRESS_COLOUR.r,
            GameConfig.PRESS_COLOUR.g,
            GameConfig.PRESS_COLOUR.b,
            pulseAlpha,
        );
        p.text('[ 按空格键开始游戏 ]', promptX, promptY);
        p.noStroke();

        // Additional hint below
        p.textFont('Noto Sans SC', Math.max(12, 36 * scale));
        p.fill(180, 180, 200, 200);
        p.text('或点击下方按钮', promptX, promptY + 50 * scale);

        p.cursor(p.ARROW); // default cursor

        this.button1.defaultColour = { r: 255, g: 210, b: 80 };
        this.button1.changedColour = { r: 220, g: 170, b: 55 };
        this.button2.defaultColour = { r: 255, g: 160, b: 200 };
        this.button2.changedColour = { r: 220, g: 120, b: 175 };
        this.button1.textSize = 30;
        this.button2.textSize = 30;

        this.button1.drawButton(p, mx, my);
        this.button2.drawButton(p, mx, my);

        this.button1.updateCursor(mx, my);
        this.button2.updateCursor(mx, my);

        if (showSettings) {
            this._drawSettingsPanel(
                p,
                mx,
                my,
                displayMode,
                aiMapFlag,
                apiKey,
                apiKeyFocused,
            );
        }
    }

    menuActionAt(mx, my) {
        if (this.button1.isHovered(mx, my)) return 'tutorial';
        if (this.button2.isHovered(mx, my)) return 'settings';
        return null;
    }

    settingsActionAt(mx, my) {
        if (this.closeButton.isHovered(mx, my)) return 'close';
        if (this.displayFitButton.isHovered(mx, my)) return 'fit';
        if (this.displayStretchButton.isHovered(mx, my)) return 'stretch';
        if (this.aiOnButton.isHovered(mx, my)) return 'ai_on';
        if (this.aiOffButton.isHovered(mx, my)) return 'ai_off';
        if (this.apiKeyInputButton.isHovered(mx, my)) return 'focus_api_key';
        return null;
    }

    _drawSettingsPanel(
        p,
        mx,
        my,
        displayMode,
        aiMapFlag,
        apiKey,
        apiKeyFocused,
    ) {
        const panel = this.settingsPanel;
        const uiTextScale = 3;
        p.noStroke();
        p.fill(0, 0, 0, 170);
        p.rect(0, 0, this.gameWidth, this.gameHeight);

        p.fill(18, 26, 42, 245);
        p.rect(panel.x, panel.y, panel.w, panel.h, 12);
        p.stroke(86, 126, 190);
        p.strokeWeight(2);
        p.noFill();
        p.rect(panel.x, panel.y, panel.w, panel.h, 12);
        p.noStroke();

        p.fill(220, 232, 255);
        p.textAlign(p.CENTER, p.TOP);
        p.textFont(GameConfig.FONT, 27.6);
        p.text('设 置', panel.x + panel.w / 2, panel.y + 16);

        // --- DISPLAY MODE ---
        p.fill(120, 144, 188);
        p.textFont(GameConfig.FONT, 17.4);
        p.text('显示模式', panel.x + panel.w / 2, panel.y + 42);

        this.displayFitButton.textSize = 22.2;
        this.displayStretchButton.textSize = 22.2;
        this.displayFitButton.drawButton(p, mx, my);
        this.displayStretchButton.drawButton(p, mx, my);
        this.displayFitButton.updateCursor(mx, my);
        this.displayStretchButton.updateCursor(mx, my);

        const activeText =
            displayMode === 'stretch'
                ? '当前：拉伸视图'
                : '当前：标准视图';
        p.fill(180, 208, 255);
        p.textFont(GameConfig.FONT, 15.3);
        p.text(activeText, panel.x + panel.w / 2, panel.y + 130);

        p.fill(120, 144, 188);
        p.textFont(GameConfig.FONT, 14.7);
        p.text(
            '标准视图保持原始画面比例。',
            panel.x + panel.w / 2,
            panel.y + 180,
        );
        p.text(
            '拉伸视图通过拉伸画面填满整个窗口。',
            panel.x + panel.w / 2,
            panel.y + 194,
        );

        // --- AI MAP GENERATION ---
        p.fill(120, 144, 188);
        p.textFont(GameConfig.FONT, 5.8 * uiTextScale);
        p.text('AI 地图生成', panel.x + panel.w / 2, panel.y + 270);

        const hasApiKey = apiKey && apiKey.trim().length > 0;

        // Buttons
        this.aiOnButton.textSize = 7.4 * uiTextScale;
        this.aiOffButton.textSize = 7.4 * uiTextScale;

        // Style buttons based on state
        if (!hasApiKey) {
            this.aiOnButton.defaultColour = { r: 80, g: 80, b: 80 };
            this.aiOnButton.changedColour = { r: 80, g: 80, b: 80 };
        } else {
            this.aiOnButton.defaultColour = { r: 80, g: 220, b: 120 };
            this.aiOnButton.changedColour = { r: 50, g: 180, b: 90 };
        }
        this.aiOffButton.defaultColour = { r: 255, g: 100, b: 100 };
        this.aiOffButton.changedColour = { r: 200, g: 70, b: 70 };

        this.aiOnButton.drawButton(p, mx, my);
        this.aiOffButton.drawButton(p, mx, my);
        if (hasApiKey) this.aiOnButton.updateCursor(mx, my);
        this.aiOffButton.updateCursor(mx, my);

        const activeAIText =
            aiMapFlag === 0 ? '当前：AI 已启用' : '当前：程序化生成';
        p.fill(180, 208, 255);
        p.textFont(GameConfig.FONT, 5.1 * uiTextScale);
        p.text(activeAIText, panel.x + panel.w / 2, panel.y + 360);

        // --- API KEY ---
        p.fill(120, 144, 188);
        p.textFont(GameConfig.FONT, 5.8 * uiTextScale);
        p.text('AIML API 密钥', panel.x + panel.w / 2, panel.y + 390);

        this.apiKeyInputButton.textSize = 5.5 * uiTextScale;
        this.apiKeyInputButton.drawButton(p, mx, my);
        this.apiKeyInputButton.updateCursor(mx, my);

        // Draw current API key or placeholder
        const displayKey = apiKeyFocused
            ? apiKey + (p.frameCount % 60 < 30 ? '|' : '')
            : apiKey
              ? '*'.repeat(Math.min(apiKey.length, 15))
              : '点击此处输入';

        p.fill(255);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont(GameConfig.FONT, 5 * uiTextScale);
        p.text(
            displayKey,
            panel.x + panel.w / 2,
            this.apiKeyInputButton.y + this.apiKeyInputButton.h / 2,
        );

        if (!hasApiKey && aiMapFlag === 0) {
            p.fill(255, 100, 100);
            p.textSize(4 * uiTextScale);
            p.text(
                'AI 地图需要输入 API 密钥',
                panel.x + panel.w / 2,
                panel.y + 480,
            );
        }

        this.closeButton.textSize = 21.6;
        this.closeButton.drawButton(p, mx, my);
        this.closeButton.updateCursor(mx, my);
    }
}
