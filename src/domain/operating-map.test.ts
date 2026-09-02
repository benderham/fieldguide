import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { type OperatingMap as OperatingMapType, OperatingMap } from './operating-map.ts';

/** A minimal but complete map that satisfies every guard, used as the baseline each rejection test mutates. */
function validMap(): OperatingMapType {
	return {
		objective: 'Audit the press-release approval workflow',
		claims: [
			{
				claimId: 'c1',
				type: 'documented-policy',
				quote: 'MUST receive written compliance sign-off before distribution',
				evidenceId: 'procedure-approvals',
				actor: 'Editorial Operations',
			},
			{
				claimId: 'c2',
				type: 'observed-practice',
				quote: 'the written sign-off step is more of a formality',
				evidenceId: 'interview-editor',
				actor: 'Sam',
			},
		],
		steps: [
			{
				seq: 1,
				actor: 'Duty editor',
				action: 'approves the release',
				documented: 'c1',
				observed: 'c2',
				diverges: true,
				claimRefs: ['c1', 'c2'],
				isException: false,
			},
		],
		contradictions: [
			{
				topic: 'written compliance sign-off',
				claimRefs: ['c1', 'c2'],
				nature: 'policy requires it; practice treats it as optional',
				status: 'needs-human',
			},
		],
		openQuestions: [
			{
				question: 'How often is the verbal-approval exception used?',
				whyItMatters: 'It determines whether sign-off is a control or a formality',
				refs: ['c1'],
				blocking: true,
			},
		],
		frictions: [
			{
				id: 'f1',
				kind: 'risk',
				description: 'Releases distributed without written sign-off',
				stepRef: '1',
				claimRefs: ['c1', 'c2'],
				severity: 'high',
				complianceSensitive: true,
			},
		],
		responsibility: [
			{
				stepRef: '1',
				current: 'manual-human',
				target: 'agent',
				rationale: { frictionRef: 'f1', text: 'Flag missing sign-off before distribution' },
			},
		],
		opportunities: [
			{
				id: 'o1',
				description: 'Assistant checks sign-off exists before a push',
				frictionRefs: ['f1'],
				responsibilityTarget: 'agent',
				impact: 'high',
				effort: 'low',
				reversibility: 'reversible',
				complianceSensitive: true,
			},
		],
		recommendation: {
			opportunityRef: 'o1',
			scope: 'Financial releases only',
			whatAgentDoes: 'Warns the editor when no sign-off log entry exists',
			aiRole: 'assist-only',
			whatStaysHuman: ['Compliance sign-off', 'The decision to distribute'],
			boundaries: ['Never approves', 'Never pushes'],
			whyBounded: 'Approval and distribution are compliance-sensitive and irreversible',
		},
		expectedValue: {
			statements: [
				{ text: 'Catches unsigned financial releases before they go out', unquantified: true },
				{
					text: 'One release (#4821) went out unsigned',
					evidenceRef: 'submission-thread-4821',
					unquantified: false,
				},
			],
			assumptions: ['Editors act on the warning rather than dismissing it'],
		},
	};
}

describe('OperatingMap schema', () => {
	it('round-trips a complete, valid map', () => {
		expect(v.parse(OperatingMap, validMap())).toEqual(validMap());
	});
});

describe('claim citation guards', () => {
	it('rejects a claim with an empty quote span', () => {
		const map = validMap();
		map.claims[0].quote = '';
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});

	it('rejects a claim with an empty evidenceId', () => {
		const map = validMap();
		map.claims[0].evidenceId = '';
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});

	it('rejects an unknown claim type', () => {
		const map = validMap() as unknown as { claims: Array<{ type: string }> };
		map.claims[0].type = 'hearsay';
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});
});

describe('contradiction guard', () => {
	it('has no resolution field to parse, and needs at least one claim ref', () => {
		const map = validMap();
		map.contradictions[0].claimRefs = [];
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});
});

describe('responsibility guard', () => {
	it('rejects an agent target with no rationale', () => {
		const map = validMap();
		map.responsibility[0].rationale = undefined;
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});

	it('accepts a non-agent target with no rationale', () => {
		const map = validMap();
		map.responsibility[0].target = 'deterministic-software';
		map.responsibility[0].rationale = undefined;
		expect(() => v.parse(OperatingMap, map)).not.toThrow();
	});
});

describe('recommendation guards', () => {
	it('rejects an empty whatStaysHuman', () => {
		const map = validMap();
		map.recommendation.whatStaysHuman = [];
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});

	it('rejects recommending a compliance-sensitive opportunity with an autonomous AI part', () => {
		const map = validMap();
		map.recommendation.aiRole = 'autonomous';
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});

	it('allows an autonomous AI part when the recommended opportunity is not compliance-sensitive', () => {
		const map = validMap();
		map.opportunities[0].complianceSensitive = false;
		map.recommendation.aiRole = 'autonomous';
		expect(() => v.parse(OperatingMap, map)).not.toThrow();
	});
});

describe('expected-value guard', () => {
	it('rejects a value statement that is neither cited nor marked unquantified', () => {
		const map = validMap();
		map.expectedValue.statements[1].evidenceRef = undefined;
		map.expectedValue.statements[1].unquantified = false;
		expect(() => v.parse(OperatingMap, map)).toThrow();
	});
});
