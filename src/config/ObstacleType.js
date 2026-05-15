/**
 * Enum of all placeable obstacle types available in the Build phase.
 * Add new entries here as new obstacle classes are implemented.
 */
export const ObstacleType = Object.freeze({
    // Solid only
    PLATFORM: 'PLATFORM', // static solid block
    MOVING_PLATFORM: 'MOVING_PLATFORM', // slides on a fixed path
    FALLING_PLATFORM: 'FALLING_PLATFORM', // two-hit: crack then fall
    ICE_PLATFORM: 'ICE_PLATFORM', // solid but zero friction
    BOUNCE_PAD: 'BOUNCE_PAD', // launches player upward on landing

    // Hazard only
    SPIKE: 'SPIKE', // retractable spike, cycles on/off
    CANNON: 'CANNON', // fires projectiles
    SAW: 'SAW', // pendulum swinging blade
    FLAME: 'FLAME', // 2-tile range penetrating flame
    SPIKED_BALL: 'SPIKED_BALL', // rolling ground hazard ball

    // Special effect (neither solid nor hazard)
    WIND_ZONE: 'WIND_ZONE', // electric fan, sinusoidal wind
    TELEPORTER: 'TELEPORTER', // warps player to linked partner + random momentum
    BOMB: 'BOMB', // terrain-destroying explosive
    SHADOW: 'SHADOW', // replays movement + blocks projectiles

    // New traps
    SLIME: 'SLIME', // sticky puddle, slows + reduces jump
    BLACK_HOLE: 'BLACK_HOLE', // suction trap, pulls everything inward
    MUSHROOM_TELEPORTER: 'MUSHROOM_TELEPORTER', // random teleport mushroom
    ARROW: 'ARROW', // gravity-affected arrow turret
    LASER: 'LASER', // aims then fires laser beam
    ERASER: 'ERASER', // special: removes obstacles (given when stuck)
});
