import { describe, expect, it } from 'vitest';
import { MAX_STEPS, stepGate } from './workflow-map.ts';

describe('stepGate', () => {
	it('allows a read below the limit', () => {
		expect(stepGate(0, 4)).toEqual({ allowed: true, message: null });
		expect(stepGate(3, 4).allowed).toBe(true);
	});

	it('blocks at the limit and returns a produce-map instruction', () => {
		const gate = stepGate(4, 4);
		expect(gate.allowed).toBe(false);
		expect(gate.message).toContain('produce_workflow_map');
	});

	it('blocks above the limit', () => {
		expect(stepGate(9, 4).allowed).toBe(false);
	});

	it('defaults to MAX_STEPS', () => {
		expect(stepGate(MAX_STEPS).allowed).toBe(false);
		expect(stepGate(MAX_STEPS - 1).allowed).toBe(true);
	});
});
