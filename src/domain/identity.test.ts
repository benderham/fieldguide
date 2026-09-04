import { describe, expect, it } from 'vitest';
import { claimHash, contradictionHash, normalizeQuote, questionHash } from './identity.ts';

const claim = {
	evidenceId: 'policy-approval',
	quote: 'Every release requires two approvals.',
	type: 'documented-policy',
};

describe('claim identity', () => {
	it('gives the same span the same identity across runs', () => {
		expect(claimHash(claim)).toBe(claimHash({ ...claim }));
	});

	it('ignores line wrapping and casing, which are artefacts of the read', () => {
		expect(claimHash({ ...claim, quote: 'Every release\n  requires   two approvals.' })).toBe(
			claimHash(claim),
		);
		expect(claimHash({ ...claim, quote: 'EVERY RELEASE REQUIRES TWO APPROVALS.' })).toBe(
			claimHash(claim),
		);
	});

	it('separates the same words quoted from a different document', () => {
		expect(claimHash({ ...claim, evidenceId: 'interview-dana' })).not.toBe(claimHash(claim));
	});

	it('separates the same span classified differently', () => {
		expect(claimHash({ ...claim, type: 'observed-practice' })).not.toBe(claimHash(claim));
	});

	it('cannot be collided by moving the separator into a field', () => {
		expect(claimHash({ ...claim, evidenceId: 'policy approval documented-policy' })).not.toBe(
			claimHash(claim),
		);
	});
});

describe('question identity', () => {
	it('treats the same question asked twice as one question', () => {
		expect(questionHash('Who signs off a compliance exception?')).toBe(
			questionHash('who signs off a  compliance exception?'),
		);
	});
});

describe('contradiction identity', () => {
	it('is the set of claims in conflict, not their order', () => {
		expect(contradictionHash(['a', 'b'])).toBe(contradictionHash(['b', 'a']));
	});

	it('separates a conflict over different claims', () => {
		expect(contradictionHash(['a', 'b'])).not.toBe(contradictionHash(['a', 'c']));
	});
});

describe('normalizeQuote', () => {
	it('collapses whitespace and trims', () => {
		expect(normalizeQuote('  two   words\n')).toBe('two words');
	});
});
