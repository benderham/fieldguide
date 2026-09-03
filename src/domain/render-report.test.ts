import { describe, expect, it } from 'vitest';
import type { OperatingMap } from './operating-map.ts';
import { renderReport } from './render-report.ts';

const map: OperatingMap = {
	objective: 'Audit the press-release approval workflow',
	provenance: 'fixture',
	status: 'final',
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
			whyItMatters: 'It decides whether sign-off is a control or a formality',
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
		decisionClass: 'advisory',
		supportRefs: ['c1', 'c2'],
		whatStaysHuman: ['Compliance sign-off', 'The decision to distribute'],
		boundaries: ['Never approves', 'Never pushes'],
		whyBounded: 'Approval and distribution are compliance-sensitive and irreversible',
	},
	expectedValue: {
		statements: [
			{ text: 'Catches unsigned financial releases before they go out', unquantified: true },
			{
				text: 'One release went out unsigned',
				evidenceRef: 'submission-thread-4821',
				unquantified: false,
			},
		],
		assumptions: ['Editors act on the warning rather than dismissing it'],
	},
};

describe('renderReport', () => {
	const report = renderReport(map);

	it('renders one heading per deliverable', () => {
		for (const heading of [
			'# Operating map: Audit the press-release approval workflow',
			'## 1. Current-state operating map',
			'## 2. Evidence and contradiction register',
			'## 3. Focused clarification questions',
			'## 4. Friction and risk',
			'## 5. Responsibility map',
			'## 6. Ranked opportunity assessment',
			'## 7. Recommended thin-slice workflow',
			'## 8. Expected value and open assumptions',
		]) {
			expect(report).toContain(heading);
		}
	});

	it('calls out human control points before the sections', () => {
		const controlAt = report.indexOf('## Human control points');
		expect(controlAt).toBeGreaterThan(-1);
		expect(controlAt).toBeLessThan(report.indexOf('## 1.'));
		expect(report).toContain('Blocking question: How often is the verbal-approval exception used?');
		expect(report).toContain('Needs a human decision: written compliance sign-off');
	});

	it('shows both sides of a contradiction with their quotes and status', () => {
		expect(report).toContain('#### written compliance sign-off [needs-human]');
		expect(report).toContain('MUST receive written compliance sign-off before distribution');
		expect(report).toContain('the written sign-off step is more of a formality');
	});

	it('marks a diverging step and shows documented vs observed', () => {
		expect(report).toContain('### Step 1: Duty editor [DIVERGES]');
	});

	it('renders each claim with its type', () => {
		expect(report).toContain('**c1** [documented-policy]');
		expect(report).toContain('**c2** [observed-practice], Sam');
	});

	it('flags unquantified value and lists assumptions as not fact', () => {
		expect(report).toContain('_unquantified_');
		expect(report).toContain('**Assumptions (not fact):**');
		expect(report).toContain('Editors act on the warning rather than dismissing it');
	});

	it('states the recommendation aiRole, decision class, support, and what stays human', () => {
		expect(report).toContain('What the agent does (assist-only, advisory)');
		expect(report).toContain('Support: c1, c2');
		expect(report).toContain('Stays human: Compliance sign-off; The decision to distribute');
	});

	it('does not add a provisional banner to a final fixture map', () => {
		expect(report).not.toContain('Provisional map');
	});

	it('adds a provisional banner to a live-sourced map', () => {
		const live = renderReport({ ...map, provenance: 'live', status: 'provisional' });
		expect(live).toContain('Provisional map (live-sourced)');
	});
});
