import { describe, expect, it } from 'vitest';
import { assertValidObjective, AUDIT_OBJECTIVE_MAX } from './objective.ts';

describe('assertValidObjective', () => {
	it('accepts a normal audit objective', () => {
		expect(() => assertValidObjective('Audit the press-release approval workflow')).not.toThrow();
	});

	it('rejects an empty or whitespace-only objective', () => {
		expect(() => assertValidObjective('')).toThrow(/required/);
		expect(() => assertValidObjective('   \n\t ')).toThrow(/required/);
	});

	it('rejects an objective with fewer than three readable characters', () => {
		expect(() => assertValidObjective('!!')).toThrow(/readable text/);
		expect(() => assertValidObjective('-- .. --')).toThrow(/readable text/);
	});

	it('rejects an objective past the length ceiling', () => {
		expect(() => assertValidObjective('a'.repeat(AUDIT_OBJECTIVE_MAX + 1))).toThrow(/at most/);
	});

	it('prefixes the rejection so the failed rule is named', () => {
		expect(() => assertValidObjective('')).toThrow(/^Rejected audit objective:/);
	});
});
