import { State } from './State.js';
import { GameStage } from '../config/GameStage.js';
import { GameConfig } from '../config/GameConfig.js';
import { ObstacleType } from '../config/ObstacleType.js';
import { drawShadowIcon } from '../utils/ShadowIcon.js';
import { drawBombIcon } from '../utils/BombIcon.js';

const ITEM_SUMMARIES = {
    PLATFORM: '实心支撑方块。',
    MOVING_PLATFORM: '水平移动升降台。',
    FALLING_PLATFORM: '踩两次破碎。',
    ICE_PLATFORM: '湿滑的实心方块。',
    BOUNCE_PAD: '将玩家向上弹飞。',
    SPIKE: '可伸缩尖刺。',
    CANNON: '定时发射炮弹。',
    ARROW: '重力弓箭。',
    SAW: '绳索摆动锯。',
    FLAME: '2格穿透火焰。',
    SPIKED_BALL: '地面滚动刺球。',
    WIND_ZONE: '电风扇。',
    TELEPORTER: '传送门+弹飞。',
    BOMB: '近距引爆的陷阱。',
    SHADOW: '重放轨迹+挡子弹。',
    SLIME: '粘液减速区。',
    BLACK_HOLE: '黑洞吸力。',
    MUSHROOM_TELEPORTER: '随机传送蘑菇。',
    LASER: '瞄准激光炮。',
    ERASER: '消除一个陷阱。卡关时免费获得。',
};

// Rich item descriptions for hover tooltips
const ITEM_DESCRIPTIONS = {
    PLATFORM: '放置一个实心方块，玩家可以站在上面、跳上去，或用来封堵路线。',
    MOVING_PLATFORM: '创建一个左右巡逻的平台，可以沿途搭载玩家。',
    FALLING_PLATFORM: '踩第一次出现裂痕，踩第二次才会坠落。有两次机会！',
    ICE_PLATFORM: '摩擦力极低的实心平台，玩家落上后会持续滑行。',
    BOUNCE_PAD: '弹簧方块，玩家踩上去的瞬间会被向上弹飞。',
    SPIKE: '可伸缩尖刺，伸出时致命，缩回时安全。周期1.8秒。',
    CANNON: '定向陷阱，周期性向地图发射炮弹。',
    ARROW: '弓箭陷阱，箭矢受重力影响会下坠，需要预判！',
    SAW: '绳索锯，像钟摆一样来回摆动，等待时机通过。',
    FLAME: '2格范围的穿透火焰，可以同时击杀多个玩家。',
    SPIKED_BALL: '只能放在地面上，自动左右滚动，碰到墙壁反弹。',
    WIND_ZONE: '电风扇，风力时大时小，忽上忽下很刺激！',
    TELEPORTER: '传送门，传送到对面后会被随机方向弹飞！',
    BOMB: '近距引爆的短引信陷阱，爆炸后摧毁附近的已放置障碍物。',
    SHADOW: '重放最近5秒移动轨迹的幽灵，还能帮你挡炮弹和弓箭！',
    SLIME: '绿色粘液，踩上去减速40%、跳跃降低30%，持续2秒。',
    BLACK_HOLE: '5格范围的吸力陷阱，把所有东西都吸向中心！',
    MUSHROOM_TELEPORTER: '红色蘑菇，踩上去随机传送到地图某处。有5秒冷却。',
    LASER: '激光炮，先瞄准2秒再发射，可以被障碍物阻挡。射程5格。',
    ERASER: '消除者，可以清理地图上的一个陷阱。卡关时每人免费获得一个，每人限购一个。',
};

// All purchasable items derived from GameConfig.SHOP_PRICES
// Shuffled each round via shuffleItems()
// Exclude ERASER from regular pool — it only appears when stuck
function makeShopItem(type) {
    return {
        type,
        price: GameConfig.SHOP_PRICES[type] ?? 5,
        label: type
            .split('_')
            .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
            .join(' '),
        desc: ITEM_DESCRIPTIONS[type] || '',
    };
}

let ALL_SHOP_ITEMS = Object.keys(GameConfig.SHOP_PRICES)
    .filter((type) => type !== 'ERASER')
    .map((type) => makeShopItem(type));

// Active items shown this round (random subset of 8)
let SHOP_ITEMS = ALL_SHOP_ITEMS;

let _isStuck = false;

/**
 *
 */
function shuffleShopItems() {
    const shuffled = [...ALL_SHOP_ITEMS].sort(() => Math.random() - 0.5);
    SHOP_ITEMS = shuffled.slice(0, Math.min(8, shuffled.length));
}

export function setShopItemsForCurrentRound(types, isStuck = false) {
    const normalItems = (types || [])
        .filter((type) => type !== ObstacleType.ERASER)
        .map((type) => makeShopItem(type));

    if (isStuck) {
        SHOP_ITEMS = [
            makeShopItem(ObstacleType.ERASER),
            ...normalItems.slice(0, 7),
        ];
    } else {
        SHOP_ITEMS = normalItems.slice(0, 8);
    }
    _isStuck = isStuck;
}

// Player colours
const PLAYER_COLOURS = [
    [90, 170, 255], // P1 blue
    [255, 200, 80], // P2 orange
];

const GRID_COLS = 4;
const CARD_W = 212;
const CARD_H = 132;
const CARD_GAP_X = 14;
const CARD_GAP_Y = 16;

/**
 * ShopState — turn-based shop.
 *
 * A player can buy as many items as they can afford in their turn.
 * Each purchase immediately deducts from wallet and adds to inventory.
 * "Done" (or ENTER with nothing selected) ends the turn.
 *
 * Layout: 2-column scrollable table. Each row shows name, price, and a Buy
 * button. All 13 items fit within the 960-wide canvas without overflow.
 *
 * Controls:
 *   Click Buy button   — purchase that item (if affordable)
 *   Click Done / ENTER — end turn
 *   S                  — end turn (skip)
 */
export class ShopState extends State {
    enter() {
        this.ctx.shopHasRun = true;
        this._currentTurn = 0;
        this._message = '';
        this._msgTimer = 0;
        this._hoveredItem = null;
        shuffleShopItems(); // Feature 7: random shop each round

        // Stuck detection: use pre-computed result from RunState (before scores were reset)
        _isStuck = this.ctx._stuckResult === true;
        if (_isStuck) {
            // Replace the first shop item with eraser (keep 8 total)
            const eraserItem = {
                type: ObstacleType.ERASER,
                price: 0,
                label: '消除者',
                desc: ITEM_DESCRIPTIONS.ERASER || '',
            };
            SHOP_ITEMS = [eraserItem, ...SHOP_ITEMS.slice(0, 7)];
        }
    }

    update(deltaTime) {
        if (this._msgTimer > 0) {
            this._msgTimer -= deltaTime;
            if (this._msgTimer <= 0) this._message = '';
        }
        this._hoveredItem = null; // reset each frame, set during render
    }

    render(mx, my) {
        const { p, gameWidth, gameHeight, players, scoreManager } = this.ctx;
        const player = players[this._currentTurn];
        const col = PLAYER_COLOURS[this._currentTurn];
        const panelX = 24;
        const panelY = 56;
        const panelW = gameWidth - 48;
        const panelH = gameHeight - 122;
        const gridX = panelX + 20;
        const gridY = panelY + 38;

        p.background(11, 13, 22);

        // Header
        p.noStroke();
        p.fill(...col);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(8);
        p.text(`P${this._currentTurn + 1} 道具商店`, gameWidth / 2, 10);

        p.fill(160, 160, 190);
        p.textSize(5);
        p.textAlign(p.CENTER, p.TOP);
        p.text(
            '悬停图标查看详情，用钱包金币购买陷阱。',
            gameWidth / 2,
            36,
        );

        this._hoveredItem = null;

        // Main shop panel
        p.fill(16, 20, 34);
        p.rect(panelX, panelY, panelW, panelH, 10);
        p.stroke(...col);
        p.strokeWeight(2);
        p.noFill();
        p.rect(panelX, panelY, panelW, panelH, 10);
        p.noStroke();

        p.fill(32, 38, 60);
        p.rect(panelX, panelY, panelW, 24, 10, 10, 0, 0);
        p.fill(205, 218, 255);
        p.textAlign(p.LEFT, p.CENTER);
        p.textSize(5.5);
        p.text('道具商店', panelX + 12, panelY + 13);

        const wallet = scoreManager.getWallet(player);
        p.fill(100, 220, 180);
        p.textAlign(p.RIGHT, p.CENTER);
        p.text(`钱包 ${wallet}`, panelX + panelW - 12, panelY + 13);

        const invEntries = [...player.inventory.entries()].filter(
            ([, c]) => c > 0,
        );
        p.fill(invEntries.length ? [150, 176, 220] : [95, 102, 130]);
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(4.8);
        p.text(
            invEntries.length
                ? `背包 ${invEntries.map(([t, c]) => `${this._labelFor(t)} x${c}`).join('   ')}`
                : '背包为空',
            gridX,
            gridY - 16,
        );

        // Item cards
        for (let i = 0; i < SHOP_ITEMS.length; i++) {
            const item = SHOP_ITEMS[i];
            const column = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const rx = gridX + column * (CARD_W + CARD_GAP_X);
            const ry = gridY + row * (CARD_H + CARD_GAP_Y);
            const canAfford = wallet >= item.price;
            const iconRect = { x: rx + 12, y: ry + 18, w: 56, h: 56 };
            const buyRect = {
                x: rx + CARD_W - 70,
                y: ry + CARD_H - 28,
                w: 58,
                h: 18,
            };
            const cardHovered =
                mx >= rx && mx <= rx + CARD_W && my >= ry && my <= ry + CARD_H;
            const iconHovered =
                mx >= iconRect.x &&
                mx <= iconRect.x + iconRect.w &&
                my >= iconRect.y &&
                my <= iconRect.y + iconRect.h;
            const buyHovered =
                mx >= buyRect.x &&
                mx <= buyRect.x + buyRect.w &&
                my >= buyRect.y &&
                my <= buyRect.y + buyRect.h;
            if (iconHovered) this._hoveredItem = item;

            p.noStroke();
            p.fill(cardHovered ? [28, 34, 56] : [22, 26, 44]);
            p.rect(rx, ry, CARD_W, CARD_H, 8);
            p.stroke(...this._itemColor(item.type), cardHovered ? 255 : 170);
            p.strokeWeight(1.5);
            p.noFill();
            p.rect(rx, ry, CARD_W, CARD_H, 8);
            p.noStroke();

            p.fill(34, 40, 66);
            p.rect(rx, ry, CARD_W, 18, 8, 8, 0, 0);
            p.fill(225, 232, 255);
            p.textAlign(p.LEFT, p.CENTER);
            p.textSize(5);
            p.text(this._labelFor(item.type), rx + 10, ry + 10);

            p.fill(18, 22, 36);
            p.rect(iconRect.x, iconRect.y, iconRect.w, iconRect.h, 6);
            p.stroke(66, 78, 120);
            p.strokeWeight(1);
            p.noFill();
            p.rect(iconRect.x, iconRect.y, iconRect.w, iconRect.h, 6);
            p.noStroke();
            this._drawShopIcon(
                item.type,
                iconRect.x,
                iconRect.y,
                iconRect.w,
                iconRect.h,
            );

            p.fill(canAfford ? [255, 215, 0] : [170, 88, 88]);
            p.textAlign(p.LEFT, p.TOP);
            p.textSize(5.5);
            p.text(`价格 ${item.price}`, rx + 82, ry + 30);

            const owned = player.inventory.get(item.type) ?? 0;
            p.fill(124, 210, 170);
            p.textSize(5);
            p.text(`拥有 ${owned}`, rx + 82, ry + 50);

            p.fill(120, 132, 170);
            p.textSize(4.3);
            p.text(
                ITEM_SUMMARIES[item.type] ?? '',
                rx + 12,
                ry + 82,
                CARD_W - 24,
                28,
            );

            p.fill(
                canAfford
                    ? buyHovered
                        ? [72, 156, 90]
                        : [46, 112, 62]
                    : [44, 44, 54],
            );
            p.rect(buyRect.x, buyRect.y, buyRect.w, buyRect.h, 4);
            p.fill(canAfford ? [238, 248, 238] : [110, 110, 118]);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(5);
            p.text(
                '购买',
                buyRect.x + buyRect.w / 2,
                buyRect.y + buyRect.h / 2 + 0.5,
            );
        }

        if (this._hoveredItem) {
            const item = this._hoveredItem;
            const tipW = 270;
            const tipH = 74;
            const tipX = Math.min(mx + 14, gameWidth - tipW - 8);
            const tipY = Math.max(my - tipH - 8, 8);
            p.noStroke();
            p.fill(14, 18, 30, 242);
            p.rect(tipX, tipY, tipW, tipH, 8);
            p.stroke(...this._itemColor(item.type));
            p.strokeWeight(1.5);
            p.noFill();
            p.rect(tipX, tipY, tipW, tipH, 8);
            p.noStroke();
            this._drawShopIcon(item.type, tipX + 10, tipY + 10, 42, 42);
            p.fill(...this._itemColor(item.type));
            p.textAlign(p.LEFT, p.TOP);
            p.textSize(5.5);
            p.text(this._labelFor(item.type), tipX + 62, tipY + 12);
            p.fill(255, 215, 0);
            p.text(`价格 ${item.price}`, tipX + 62, tipY + 28);
            p.fill(180, 185, 210);
            p.textSize(4.7);
            p.text(item.desc, tipX + 10, tipY + 48, tipW - 20, 22);
        }

        // Done button
        const doneY = gameHeight - 48;
        const doneW = 160;
        const doneH = 28;
        const doneX = gameWidth / 2 - doneW / 2;
        const doneHov =
            mx >= doneX &&
            mx <= doneX + doneW &&
            my >= doneY &&
            my <= doneY + doneH;

        p.fill(doneHov ? [60, 120, 180] : [40, 85, 135]);
        p.noStroke();
        p.rect(doneX, doneY, doneW, doneH, 6);
        p.fill(220, 235, 255);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(5);
        p.text('完成购物', doneX + doneW / 2, doneY + doneH / 2 + 0.5);

        // Turn dots
        const dotY = doneY + doneH + 8;
        [0, 1].forEach((i) => {
            const dotX = gameWidth / 2 + (i === 0 ? -14 : 14);
            const active = i === this._currentTurn;
            p.fill(active ? PLAYER_COLOURS[i] : [45, 45, 60]);
            p.noStroke();
            p.circle(dotX, dotY, active ? 12 : 8);
        });

        // Feedback message
        if (this._message) {
            p.fill(255, 220, 80);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.textSize(5.5);
            p.text(this._message, gameWidth / 2, doneY - 4);
        }

        // Controls hint
        p.fill(75, 75, 95);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.textSize(5);
        p.text(
            '回车 / 完成 → 结束回合   S → 跳过回合',
            14,
            gameHeight - 2,
        );
    }

    mousePressed(mx, my) {
        const { gameWidth, gameHeight, players, scoreManager } = this.ctx;
        const player = players[this._currentTurn];
        const panelX = 24;
        const panelY = 56;
        const gridX = panelX + 20;
        const gridY = panelY + 38;

        // Buy button clicks
        for (let i = 0; i < SHOP_ITEMS.length; i++) {
            const item = SHOP_ITEMS[i];
            const column = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const rx = gridX + column * (CARD_W + CARD_GAP_X);
            const ry = gridY + row * (CARD_H + CARD_GAP_Y);
            const btnRect = {
                x: rx + CARD_W - 70,
                y: ry + CARD_H - 28,
                w: 58,
                h: 18,
            };
            if (
                mx >= btnRect.x &&
                mx <= btnRect.x + btnRect.w &&
                my >= btnRect.y &&
                my <= btnRect.y + btnRect.h
            ) {
                this._buyItem(item, player, scoreManager);
                return;
            }
        }

        // Done button
        const doneY = gameHeight - 48;
        const doneW = 160;
        const doneH = 28;
        const doneX = gameWidth / 2 - doneW / 2;
        if (
            mx >= doneX &&
            mx <= doneX + doneW &&
            my >= doneY &&
            my <= doneY + doneH
        ) {
            this._doneTurn();
        }
    }

    keyPressed() {
        const { p } = this.ctx;
        if (p.keyCode === p.ENTER || p.keyCode === 13) {
            this._doneTurn();
        } else if (p.key === 's' || p.key === 'S') {
            this._doneTurn();
        }
    }

    // ── Private ───────────────────────────────────────────────────────────

    /**
     * Attempt to buy one unit of an item. Does NOT end the turn.
     * @param item
     * @param player
     * @param scoreManager
     * @private
     */
    _buyItem(item, player, scoreManager) {
        // Enforce limit: ERASER max 1 per player
        if (item.type === ObstacleType.ERASER) {
            const owned = player.inventory.get(item.type) ?? 0;
            if (owned >= 1) {
                this._showMessage('每人限购一个消除者！');
                return;
            }
        }
        const ok = scoreManager.spendWallet(player, item.price);
        if (!ok) {
            this._showMessage(`金币不足！需要 💰${item.price}`);
            return;
        }
        const current = player.inventory.get(item.type) ?? 0;
        player.inventory.set(item.type, current + 1);
        const label = this._labelFor(item.type);
        this._showMessage(
            `已购买 ${label}！（剩余 💰 ${scoreManager.getWallet(player)}）`,
        );
    }

    /**
     * End this player's shopping turn.
     * @private
     */
    _doneTurn() {
        this._message = '';
        this._currentTurn++;
        if (this._currentTurn >= this.ctx.players.length) {
            // Do NOT regenerate map — map only changes when advancing at 100 points
            this.goTo(GameStage.BUILD);
        }
    }

    _showMessage(text) {
        this._message = text;
        this._msgTimer = 2200;
    }

    _itemColor(type) {
        const map = {
            PLATFORM: [120, 90, 60],
            MOVING_PLATFORM: [80, 110, 160],
            FALLING_PLATFORM: [90, 65, 40],
            ICE_PLATFORM: [160, 220, 245],
            BOUNCE_PAD: [80, 200, 100],
            SPIKE: [220, 60, 60],
            CANNON: [100, 100, 115],
            SAW: [200, 60, 60],
            FLAME: [240, 100, 20],
            SPIKED_BALL: [170, 80, 40],
            WIND_ZONE: [60, 185, 185],
            TELEPORTER: [160, 80, 240],
            BOMB: [220, 80, 40],
            SHADOW: [140, 90, 220],
            SLIME: [40, 180, 60],
            BLACK_HOLE: [100, 40, 200],
            MUSHROOM_TELEPORTER: [220, 50, 50],
            ARROW: [139, 90, 43],
            LASER: [255, 50, 50],
            ERASER: [255, 220, 80],
        };
        return map[type] ?? [150, 150, 150];
    }

    _labelFor(type) {
        const labels = {
            PLATFORM: '平台',
            MOVING_PLATFORM: '移动平台',
            FALLING_PLATFORM: '坠落平台',
            ICE_PLATFORM: '冰面平台',
            BOUNCE_PAD: '弹跳垫',
            SPIKE: '伸缩尖刺',
            CANNON: '炮台',
            ARROW: '弓箭',
            SAW: '绳索锯',
            FLAME: '火焰',
            SPIKED_BALL: '滚动刺球',
            WIND_ZONE: '电风扇',
            TELEPORTER: '传送器',
            BOMB: '炸弹',
            SHADOW: '影子',
            SLIME: '粘液',
            BLACK_HOLE: '黑洞',
            MUSHROOM_TELEPORTER: '传送蘑菇',
            LASER: '激光炮',
            ERASER: '消除者',
        };
        return labels[type] ?? type;
    }

    _drawShopIcon(type, x, y, w, h) {
        const { p, shopIcons } = this.ctx;
        const img = shopIcons?.[type] ?? null;
        p.push();
        p.noSmooth();
        if (img) {
            const { sx, sy, sw, sh, dx, dy, dw, dh } = this._iconDrawSpec(
                type,
                img,
                x,
                y,
                w,
                h,
            );
            p.image(img, dx, dy, dw, dh, sx, sy, sw, sh);
        } else if (type === ObstacleType.BOMB) {
            drawBombIcon(p, x, y, w, h);
        } else if (type === ObstacleType.SHADOW) {
            drawShadowIcon(p, x, y, w, h);
        } else if (type === ObstacleType.SLIME) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            p.noStroke();
            p.fill(40, 180, 60, 200);
            p.ellipse(cx, cy + 2, w * 0.7, h * 0.4);
            p.fill(60, 220, 80, 150);
            p.circle(cx - 3, cy, 4);
            p.circle(cx + 3, cy + 1, 3);
        } else if (type === ObstacleType.BLACK_HOLE) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            p.noStroke();
            p.fill(20, 10, 40, 200);
            p.circle(cx, cy, w * 0.6);
            p.fill(60, 20, 120, 180);
            p.circle(cx, cy, w * 0.35);
            p.fill(120, 50, 200, 150);
            p.circle(cx, cy, w * 0.15);
            p.stroke(180, 100, 255, 100);
            p.strokeWeight(1);
            p.noFill();
            p.circle(cx, cy, w * 0.75);
        } else if (type === ObstacleType.MUSHROOM_TELEPORTER) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            p.noStroke();
            p.fill(220, 200, 160, 200);
            p.rect(cx - 2, cy, 4, 8, 1);
            p.fill(220, 50, 50, 200);
            p.arc(cx, cy, w * 0.5, h * 0.35, p.PI, 0, p.CHORD);
            p.fill(255, 255, 255, 180);
            p.circle(cx - 3, cy - 3, 3);
            p.circle(cx + 2, cy - 2, 2);
        } else if (type === ObstacleType.ARROW) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            p.noStroke();
            p.stroke(139, 90, 43, 200);
            p.strokeWeight(2);
            p.noFill();
            p.arc(cx, cy, w * 0.4, h * 0.5, -p.PI * 0.4, p.PI * 0.4);
            p.stroke(139, 90, 43, 200);
            p.strokeWeight(1.5);
            p.line(cx - w * 0.25, cy, cx + w * 0.15, cy);
            p.noStroke();
            p.fill(180, 180, 190, 200);
            p.triangle(cx + w * 0.15, cy, cx + w * 0.08, cy - 3, cx + w * 0.08, cy + 3);
        } else if (type === ObstacleType.LASER) {
            const cx = x + w / 2;
            const cy = y + h / 2;
            p.noStroke();
            p.fill(70, 70, 80, 200);
            p.rect(cx - 5, cy, 10, 8, 2);
            p.fill(90, 90, 100, 200);
            p.rect(cx - 4, cy - 3, 8, 6, 2);
            p.fill(255, 50, 50, 200);
            p.circle(cx, cy - 2, 6);
            p.fill(255, 255, 255, 180);
            p.circle(cx - 1, cy - 3, 2);
        } else {
            p.noStroke();
            p.fill(...this._itemColor(type));
            p.rect(x + 8, y + 8, w - 16, h - 16, 4);
        }
        p.pop();
    }

    _fitIconRect(x, y, w, h, sourceW, sourceH, maxW = w, maxH = h) {
        const scale = Math.min(maxW / sourceW, maxH / sourceH);
        const dw = sourceW * scale;
        const dh = sourceH * scale;
        return {
            dx: x + (w - dw) / 2,
            dy: y + (h - dh) / 2,
            dw,
            dh,
        };
    }

    _iconDrawSpec(type, img, x, y, w, h) {
        if (type === ObstacleType.MOVING_PLATFORM) {
            const fit = this._fitIconRect(x, y, w, h, 32, 8, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 32,
                sh: 8,
                ...fit,
            };
        }

        if (type === ObstacleType.FALLING_PLATFORM) {
            const fit = this._fitIconRect(x, y, w, h, 32, 10, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 32,
                sh: 10,
                ...fit,
            };
        }

        if (type === ObstacleType.BOUNCE_PAD) {
            const fit = this._fitIconRect(x, y, w, h, 28, 28, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 28,
                sh: 28,
                ...fit,
            };
        }

        if (type === ObstacleType.SAW) {
            const fit = this._fitIconRect(x, y, w, h, 38, 38, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 38,
                sh: 38,
                ...fit,
            };
        }

        if (type === ObstacleType.FLAME) {
            const fit = this._fitIconRect(x, y, w, h, 16, 32, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 16,
                sh: 32,
                ...fit,
            };
        }

        if (type === ObstacleType.WIND_ZONE) {
            return {
                sx: 32 * 2 + 6,
                sy: 9,
                sw: 22,
                sh: 14,
                dx: x,
                dy: y,
                dw: w,
                dh: h,
            };
        }

        if (type === ObstacleType.SPIKE) {
            return {
                sx: 41,
                sy: 0,
                sw: 38,
                sh: 40,
                dx: x,
                dy: y,
                dw: w,
                dh: h,
            };
        }

        if (type === ObstacleType.CANNON) {
            const fit = this._fitIconRect(x, y, w, h, 30, 18, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 30,
                sh: 18,
                ...fit,
            };
        }

        if (type === ObstacleType.SPIKED_BALL) {
            const fit = this._fitIconRect(x, y, w, h, 28, 28, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 28,
                sh: 28,
                ...fit,
            };
        }

        if (type === ObstacleType.TELEPORTER) {
            const fit = this._fitIconRect(x, y, w, h, 40, 40, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 40,
                sh: 40,
                ...fit,
            };
        }

        if (
            type === ObstacleType.PLATFORM ||
            type === ObstacleType.ICE_PLATFORM
        ) {
            const fit = this._fitIconRect(x, y, w, h, 40, 40, w, h);
            return {
                sx: 0,
                sy: 0,
                sw: 40,
                sh: 40,
                ...fit,
            };
        }

        const fit = this._fitIconRect(x, y, w, h, img.width, img.height, w, h);
        return {
            sx: 0,
            sy: 0,
            sw: img.width,
            sh: img.height,
            ...fit,
        };
    }
}
