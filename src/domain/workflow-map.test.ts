import { describe, expect, it } from 'vitest';
import { MAX_STEPS, overTurnCap, stepGate, TURN_CAP } from './workflow-map.ts';

describe('stepGate', () => {
	it('allows a read below the limit', () => {
		expect(stepGate(0, 4)).toEqual({ allowed: true, message: null });
		expect(stepGate(3, 4).allowed).toBe(true);
	});

	it('blocks at the limit and points at the current finish tool', () => {
		const gate = stepGate(4, 4);
		expect(gate.allowed).toBe(false);
		expect(gate.message).toContain('finish_operating_map');
	});

	it('blocks above the limit', () => {
		expect(stepGate(9, 4).allowed).toBe(false);
	});

	it('defaults to MAX_STEPS', () => {
		expect(stepGate(MAX_STEPS).allowed).toBe(false);
		expect(stepGate(MAX_STEPS - 1).allowed).toBe(true);
	});
});

describe('overTurnCap', () => {
	it('is false below the cap and true at or above it', () => {
		expect(overTurnCap(TURN_CAP - 1)).toBe(false);
		expect(overTurnCap(TURN_CAP)).toBe(true);
		expect(overTurnCap(TURN_CAP + 3)).toBe(true);
	});
});
