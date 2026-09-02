import { describe, expect, it } from 'vitest';
import type { OperatingMap } from '../domain/operating-map.ts';
import { allPassed, gradeGoldCases } from './gold-cases.ts';

const KNOWN = new Set([
	'procedure-approvals',
	'interview-editor',
	'interview-compliance',
	'submission-thread-4821',
	'system-distribution',
]);

/** A map that does everything the gold cases want, mutated per test to break one case at a time. */
function goodMap(): OperatingMap {
	return {
		objective: 'Audit approvals',
		claims: [
			{
				claimId: 'c1',
				type: 'documented-policy',
				quote: 'MUST receive written compliance sign-off before distribution',
				evidenceId: 'procedure-approvals',
			},
			{
				claimId: 'c2',
				type: 'observed-practice',
				quote: 'the written sign-off step is more of a formality',
				evidenceId: 'interview-editor',
			},
			{
				claimId: 'c3',
				type: 'staff-recollection',
				quote: 'I find out a release went out when someone forwards me the published version',
				evidenceId: 'interview-compliance',
				actor: 'Priya',
			},
			{
				claimId: 'c4',
				type: 'system-fact',
				quote: 'verbal ok, urgent',
				evidenceId: 'submission-thread-4821',
			},
		],
		steps: [
			{
				seq: 1,
				actor: 'Duty editor',
				action: 'approves',
				documented: 'c1',
				observed: 'c2',
				diverges: true,
				claimRefs: ['c1', 'c2'],
				isException: false,
			},
			{
				seq: 2,
				actor: 'Editor',
				action: 'distributes via WirePush',
				diverges: false,
				claimRefs: ['c4'],
				isException: true,
			},
		],
		contradictions: [
			{
				topic: 'written compliance sign-off',
				claimRefs: ['c1', 'c2'],
				nature: 'policy requires it; practice skips it',
				status: 'needs-human',
			},
		],
		openQuestions: [
			{
				question: 'How often is verbal approval used?',
				whyItMatters: 'control vs formality',
				refs: ['c3'],
				blocking: true,
			},
		],
		frictions: [
			{
				id: 'f1',
				kind: 'risk',
				description: 'distributed without sign-off',
				stepRef: '2',
				claimRefs: ['c4'],
				severity: 'high',
				complianceSensitive: true,
			},
		],
		responsibility: [
			{
				stepRef: '2',
				current: 'manual-human',
				target: 'agent',
				rationale: { frictionRef: 'f1', text: 'flag missing sign-off' },
			},
		],
		opportunities: [
			{
				id: 'o1',
				description: 'check sign-off before push',
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
			scope: 'financial',
			whatAgentDoes: 'warns editor',
			aiRole: 'assist-only',
			whatStaysHuman: ['sign-off'],
			boundaries: ['never approves'],
			whyBounded: 'irreversible publish',
		},
		expectedValue: {
			statements: [{ text: 'catches unsigned releases', unquantified: true }],
			assumptions: ['editors act on the warning'],
		},
	};
}

const grade = (m: OperatingMap) => gradeGoldCases(m, KNOWN);
const casePass = (m: OperatingMap, id: string) => grade(m).find((r) => r.id === id)?.pass;

describe('gradeGoldCases', () => {
	it('passes every case on a well-formed map', () => {
		const results = grade(goodMap());
		expect(allPassed(results)).toBe(true);
		expect(results).toHaveLength(7);
	});

	it('fails the contradiction case when no documented-vs-observed sign-off conflict is recorded', () => {
		const m = goodMap();
		m.contradictions = [];
		// Also clear the spine channel: neither register nor a diverging step carries it.
		m.steps[0].diverges = false;
		m.steps[0].documented = undefined;
		m.steps[0].observed = undefined;
		expect(casePass(m, 'sign-off-contradiction')).toBe(false);
	});

	it('accepts the sign-off divergence caught on a spine step instead of the register', () => {
		const m = goodMap();
		m.contradictions = [];
		expect(casePass(m, 'sign-off-contradiction')).toBe(true);
	});

	it('fails when an interview claim is typed as documented fact', () => {
		const m = goodMap();
		m.claims[2].type = 'documented-policy';
		expect(casePass(m, 'interviews-are-recollection')).toBe(false);
	});

	it('fails when the #4821 verbal-approval incident is not escalated', () => {
		const m = goodMap();
		m.frictions[0].complianceSensitive = false;
		m.openQuestions = [];
		m.contradictions[0].status = 'unresolved';
		expect(casePass(m, '4821-escalated')).toBe(false);
	});

	it('fails the citation case when a claim cites unread evidence', () => {
		const m = goodMap();
		m.claims[0].evidenceId = 'never-read';
		expect(casePass(m, 'citations-traceable')).toBe(false);
	});

	it('fails when an agent target names a friction that does not exist', () => {
		const m = goodMap();
		m.responsibility[0].rationale = { frictionRef: 'ghost', text: 'x' };
		expect(casePass(m, 'agent-target-justified')).toBe(false);
	});
});
