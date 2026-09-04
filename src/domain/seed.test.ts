import { describe, expect, it } from 'vitest';
import type { AuditState } from '../store/audit.ts';
import { seedBlocks } from './seed.ts';

const empty: AuditState = {
	audit: { auditId: 'a1', objective: 'Audit the approval workflow', createdAt: 'now' },
	readSet: [],
	claims: [],
	questions: [],
	contradictions: [],
};

const populated: AuditState = {
	...empty,
	readSet: ['policy-approval', 'interview-dana'],
	claims: [
		{
			claimHash: 'aaaaaaaaaaaabbbb',
			type: 'documented-policy',
			quote: 'Every release requires two approvals.',
			evidenceId: 'policy-approval',
			sightings: [
				{ runId: 'r1', claimId: 'C1' },
				{ runId: 'r2', claimId: 'K9' },
			],
		},
	],
	questions: [
		{
			questionHash: 'q1111111111',
			question: 'Who signs off a compliance exception?',
			whyItMatters: 'It decides whether the exception path is auditable.',
			blocking: true,
			status: 'open',
		},
		{
			questionHash: 'q2222222222',
			question: 'Which channel publishes first?',
			whyItMatters: 'It sets the irreversible point.',
			blocking: false,
			status: 'answered',
			answeredByEvidenceId: 'answer-channel-order',
		},
	],
	contradictions: [
		{
			contradictionHash: 'c3333333333',
			topic: 'approval count',
			nature: 'Policy requires two approvals; practice accepts one.',
			status: 'needs-human',
			claimHashes: ['aaaaaaaaaaaabbbb', 'ccccccccccccdddd'],
		},
	],
};

describe('seeding a run', () => {
	it('seeds nothing on a first run rather than empty headings', () => {
		expect(seedBlocks(empty)).toEqual([]);
	});

	it('seeds evidence and unresolved questions, and nothing else', () => {
		const types = seedBlocks(populated).map((block) => block.type);
		expect(types).toEqual([
			'audit.open-questions',
			'audit.contradictions',
			'audit.claims',
			'audit.read-set',
		]);
	});

	it('puts an answered question first, with the document to read for the answer', () => {
		const questions = seedBlocks(populated).find((b) => b.type === 'audit.open-questions');
		const lines = questions?.body.split('\n').filter((line) => line.startsWith('- ')) ?? [];
		expect(lines[0]).toContain('ANSWERED');
		expect(lines[0]).toContain('answer-channel-order');
		expect(lines[1]).toContain('BLOCKING');
	});

	it('carries the verbatim quote, so a claim can be recorded again without a re-read', () => {
		const claims = seedBlocks(populated).find((b) => b.type === 'audit.claims');
		expect(claims?.body).toContain('"Every release requires two approvals."');
		expect(claims?.body).toContain('policy-approval');
	});

	it('shows corroboration when more than one run found the same span', () => {
		const claims = seedBlocks(populated).find((b) => b.type === 'audit.claims');
		expect(claims?.body).toContain('found in 2 runs');
	});

	it("never seeds a prior run's conclusions", () => {
		const body = seedBlocks(populated)
			.map((block) => block.body)
			.join('\n');
		for (const conclusion of ['recommendation', 'opportunit', 'friction', 'expected value']) {
			expect(body.toLowerCase()).not.toContain(conclusion);
		}
	});
});
