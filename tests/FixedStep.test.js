import { describe, it, expect, vi } from 'vitest';
import { runFixedSteps } from '../src/sim/core/fixedStep.js';

describe('runFixedSteps', () => {
    it('executes the expected number of fixed steps', () => {
        const onStep = vi.fn();

        const result = runFixedSteps(
            {
                accumulator: 0,
                elapsedMs: 50,
                fixedStepMs: 10,
                maxCatchUpMs: 1000,
            },
            onStep,
        );

        expect(onStep).toHaveBeenCalledTimes(5);
        expect(result.accumulator).toBe(0);
        expect(result.steps).toBe(5);
    });

    it('caps catch-up work and clears overflowed accumulator', () => {
        const onStep = vi.fn();

        const result = runFixedSteps(
            {
                accumulator: 0,
                elapsedMs: 5000,
                fixedStepMs: 16,
                maxCatchUpMs: 64,
            },
            onStep,
        );

        expect(onStep).toHaveBeenCalledTimes(4);
        expect(result.accumulator).toBe(0);
    });
});
