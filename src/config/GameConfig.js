export const GameConfig = {
    GAME_WIDTH: 960,
    GAME_HEIGHT: 544,

    RESPAWN_TIME: 2000, // 2 seconds
    SPAWN_POSITION: { x: 100, y: 100 },
    TIME_LIMIT: 90, // 1.5 minutes

    PLAYERSPEED: 3.2,
    JUMP_VELOCITY: 12,
    GRAVITY: 0.7,
    MAX_FALL_SPEED: 18,
    SKIN_WIDTH: 0.01,

    // Start Screen
    FONT: 'Noto Sans SC',
    TITLE_FONTSIZE: 19,
    TITLE_X: 310,
    TITLE_Y: 200,
    TITLE_COLOUR: { r: 245, g: 140, b: 255 },

    PRESS_FONTSIZE: 7,
    PRESS_X: 350,
    PRESS_Y: 300,
    PRESS_COLOUR: { r: 255, g: 215, b: 0 },

    BUTTON1_X: 330,
    BUTTON1_Y: 330,
    BUTTON1_W: 112,
    BUTTON1_H: 34,

    BUTTON2_X: 480,
    BUTTON2_Y: 330,
    BUTTON2_W: 112,
    BUTTON2_H: 34,

    // MAP MENU
    MAP_TITLE_COLOUR: { r: 143, g: 57, b: 133 }, // purple
    MAP_TITLE_X: 330,
    MAP_TITLE_Y: 200,

    MAP_BUTTON1_X: 200,
    MAP_BUTTON1_Y: 330,
    MAP_BUTTON1_W: 112,
    MAP_BUTTON1_H: 34,

    MAP_BUTTON2_X: 400,
    MAP_BUTTON2_Y: 330,
    MAP_BUTTON2_W: 112,
    MAP_BUTTON2_H: 34,

    MAP_RETURN_X: 50,
    MAP_RETURN_Y: 50,
    MAP_RETURN_R: 30,

    // tile
    TILE: 32,

    // Reward algorithm: index 0 = 1st place, 1 = 2nd, etc. Fail = 0.
    FINISH_REWARDS: [20, 10, 5, 2],

    // Value of each coin collected during a round
    COIN_VALUE: 1,
    RAINBOW_COIN_VALUE: 10, // special rainbow coin worth 10 coins

    // Scoring system
    POINTS_TO_ADVANCE_MAP: 100, // points needed to advance to next map
    TRAP_KILL_POINTS: 2, // points for killing someone with your trap
    KILL_ALL_POINTS: 3, // bonus for killing all other players
    ONLY_FINISHER_POINTS: 5, // bonus for being the only finisher
    NO_DEATH_FINISH_POINTS: 3, // bonus for finishing without dying
    NEAR_FINISH_DEATH_RADIUS_TILES: 10, // circular endpoint radius for title checks

    // Cannon
    CANNON_FIRE_INTERVAL: 2200, // ms between shots
    CANNON_PROJECTILE_SPEED: 5, // pixels per frame
    CANNON_PROJECTILE_RADIUS: 7,

    // Saw
    SAW_ROTATION_SPEED: 0.005, // radians per millisecond (~0.8 rotations/second)
    SAW_TOOTH_COUNT: 10, // number of teeth around the blade circumference

    // Shop — wallet cost to purchase one placement token per item type
    SHOP_PRICES: {
        PLATFORM: 3,
        SPIKE: 5,
        SAW: 7,
        CANNON: 8,
        ARROW: 7,
        MOVING_PLATFORM: 6,
        FALLING_PLATFORM: 5,
        ICE_PLATFORM: 4,
        BOUNCE_PAD: 5,
        FLAME: 6,
        SPIKED_BALL: 7,
        WIND_ZONE: 6,
        TELEPORTER: 10,
        BOMB: 8,
        SHADOW: 9,
        SLIME: 5,
        BLACK_HOLE: 10,
        MUSHROOM_TELEPORTER: 8,
        LASER: 12,
        ERASER: 0, // special: free when stuck (2 rounds nobody finishes)
    },
    SHADOW_RECORD_MS: 5000,
    SHADOW_COOLDOWN_MS: 5000,
    BOMB_FUSE_MS: 2000, // ms before bomb explodes after trigger
    BOMB_RADIUS: 1, // tile radius of explosion (destroys tiles + obstacles)
    BOMB_MAX_DEPTH: 1, // extra tiles below the surface that a bomb can carve out
    BOMB_TRIGGER_RADIUS: 1.5, // tile distance to trigger fuse

    // MovingPlatform
    MOVING_PLATFORM_SPEED: 1.5, // px per frame at 60 fps
    MOVING_PLATFORM_RANGE: 3, // tiles of travel from start position

    // FallingPlatform
    FALLING_PLATFORM_TRIGGER_MS: 500, // ms standing before drop starts
    FALLING_PLATFORM_GRAVITY: 0.4, // px/frame² acceleration while falling

    // BouncePad
    BOUNCE_PAD_FORCE: -18, // vy applied on landing (negative = up)

    // Flame (2-tile range, penetrates players)
    FLAME_ON_MS: 1500, // ms active (hazard)
    FLAME_OFF_MS: 2000, // ms inactive (safe)
    FLAME_RANGE_TILES: 2, // attack range in tiles

    // Slime (sticky puddle)
    SLIME_SPEED_MULT: 0.6, // speed multiplier when inside
    SLIME_JUMP_MULT: 0.7, // jump multiplier when inside
    SLIME_DURATION_MS: 2000, // effect lasts after leaving
    SLIME_PRICE: 5,

    // Black Hole (suction trap)
    BLACK_HOLE_RANGE: 5, // tiles of suction range
    BLACK_HOLE_FORCE: 0.6, // suction force per frame
    BLACK_HOLE_PRICE: 10,

    // Mushroom Teleporter
    MUSHROOM_TELEPORT_COOLDOWN_MS: 5000,
    MUSHROOM_TELEPORT_PRICE: 8,

    // Arrow (gravity-affected projectile)
    ARROW_GRAVITY: 0.15, // gravity affecting arrow
    ARROW_SPEED: 6, // base arrow speed
    ARROW_FIRE_INTERVAL: 2500, // ms between shots
    ARROW_PRICE: 7,

    // Pendulum
    PENDULUM_LENGTH: 3, // tiles length
    PENDULUM_PERIOD_MS: 3000, // full swing period
    PENDULUM_PRICE: 8,

    // Laser
    LASER_RANGE: 3, // tiles detection range (3 tiles)
    LASER_MAX_DISTANCE: 5, // max attack distance in tiles
    LASER_AIM_MS: 2000, // ms to aim before firing (2 seconds)
    LASER_FIRE_MS: 500, // ms beam duration
    LASER_COOLDOWN_MS: 3000, // ms between shots
    LASER_PRICE: 12,

    // FallingPlatform (two-hit)
    FALLING_PLATFORM_CRACK_THRESHOLD: 1, // hits before crack

    // WindZone
    WIND_FORCE: 0.35, // px/frame² push applied per frame inside zone

    // Teleporter
    TELEPORTER_COOLDOWN_MS: 1200, // ms before same player can teleport again

    // Developer Mode settings
    DEV_MODE_UNLIMITED_TIME: true, // disables time limit
    DEV_MODE_INSTANT_KILL: true, // K key to kill current player
    DEV_MODE_TELEPORT_TO_END: true, // E key to teleport to finish line
    DEV_MODE_FREEZE_TIME: true, // T key to freeze/unfreeze time
};
