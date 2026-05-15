/**
 * HandleInput — per-player input handler.
 *
 * P1 (idx 0): WASD
 * P2 (idx 1): Arrow keys
 * P3 (idx 2): Gamepad 0 — left stick + button 0 (A)
 * P4 (idx 3): Gamepad 1 — left stick + button 0 (A)
 */
export class HandleInput {
    constructor(p, playerIndex) {
        this.p = p;
        this.idx = playerIndex;
    }

    get left() {
        if (this.idx === 0) return this.p.keyIsDown(65); // A
        if (this.idx === 1) return this.p.keyIsDown(this.p.LEFT_ARROW);
        return this._gamepadAxis(0) < -0.3;
    }

    get right() {
        if (this.idx === 0) return this.p.keyIsDown(68); // D
        if (this.idx === 1) return this.p.keyIsDown(this.p.RIGHT_ARROW);
        return this._gamepadAxis(0) > 0.3;
    }

    get jump() {
        if (this.idx === 0) return this.p.keyIsDown(87); // W
        if (this.idx === 1) return this.p.keyIsDown(this.p.UP_ARROW);
        return this._gamepadButton(0);
    }

    _gamepadAxis(axisIndex) {
        const gamepads = navigator.getGamepads();
        const gpIndex = this.idx - 2; // P3=gp0, P4=gp1
        const gp = gamepads[gpIndex];
        if (!gp || !gp.axes) return 0;
        return gp.axes[axisIndex] || 0;
    }

    _gamepadButton(btnIndex) {
        const gamepads = navigator.getGamepads();
        const gpIndex = this.idx - 2;
        const gp = gamepads[gpIndex];
        if (!gp || !gp.buttons) return false;
        return gp.buttons[btnIndex]?.pressed || false;
    }
}
