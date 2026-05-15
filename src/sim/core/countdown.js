export function advanceCountdown(timeLeftSeconds, deltaTimeMs) {
    const next = Math.max(
        0,
        Number(timeLeftSeconds || 0) - Number(deltaTimeMs || 0) / 1000,
    );

    return {
        timeLeft: next,
        expired: next <= 0,
    };
}
