export function runFixedSteps(
    {
        accumulator = 0,
        elapsedMs = 0,
        fixedStepMs = 1000 / 60,
        maxCatchUpMs = 1000,
    },
    onStep,
) {
    const cappedElapsed = Math.min(
        Math.max(0, Number(elapsedMs) || 0),
        maxCatchUpMs,
    );
    let nextAccumulator = Math.max(0, Number(accumulator) || 0) + cappedElapsed;
    let steps = 0;
    const maxSteps = Math.ceil(maxCatchUpMs / fixedStepMs);

    while (nextAccumulator >= fixedStepMs && steps < maxSteps) {
        onStep?.(fixedStepMs, steps);
        nextAccumulator -= fixedStepMs;
        steps++;
    }

    if (steps >= maxSteps && nextAccumulator >= fixedStepMs) {
        nextAccumulator = 0;
    }

    return {
        accumulator: nextAccumulator,
        steps,
    };
}
