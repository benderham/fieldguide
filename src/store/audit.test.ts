import { beforeEach, describe, expect, it } from 'vitest';
import { claimHash, questionHash } from '../domain/identity.ts';
import type { Claim, Contradiction, OpenQuestion } from '../domain/operating-map.ts';
import { SEEDED_CLAIM_CAP } from '../domain/retention.ts';
import { type AuditStore, openAuditStore } from './audit.ts';

const policy: Claim = {
	claimId: 'C1',
	type: 'documented-policy',
	quote: 'Every release requires two approvals.',
	evidenceId: 'policy-approval',
};

const practice: Claim = {
	claimId: 'C2',
	type: 'observed-practice',
	quote: 'In practice one approval is usually enough.',
	evidenceId: 'interview-dana',
};

const question: OpenQuestion = {
	question: 'Who signs off a compliance exception?',
	whyItMatters: 'It decides whether the exception path is auditable.',
	refs: ['C1'],
	blocking: true,
};

const contradiction: Contradiction = {
	topic: 'approval count',
	claimRefs: ['C1', 'C2'],
	nature: 'Policy requires two approvals; practice accepts one.',
	status: 'needs-human',
};

let store: AuditStore;

beforeEach(() => {
	store = openAuditStore({ path: ':memory:' });
	store.createAudit({ auditId: 'a1', objective: 'Audit the approval workflow' });
});

describe('founding an audit', () => {
	it('refuses to found the same audit twice', () => {
		expect(() => store.createAudit({ auditId: 'a1', objective: 'again' })).toThrow(
			/already exists/,
		);
	});

	it('refuses a run against an audit that was never founded, naming the rule', () => {
		expect(() => store.requireAudit('a-typo')).toThrow(/Unknown audit 'a-typo'/);
		expect(() => store.beginRun({ auditId: 'a-typo', runId: 'r1', objective: 'x' })).toThrow(
			/Unknown audit/,
		);
	});
});

describe('the read set', () => {
	beforeEach(() => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
	});

	it('records a read as it happens, without waiting for a finish', () => {
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'policy-approval' });
		expect(store.readSet('a1')).toEqual(['policy-approval']);
	});

	it('accumulates across runs and stays a set', () => {
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'policy-approval' });
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		store.recordRead({ auditId: 'a1', runId: 'r2', evidenceId: 'policy-approval' });
		store.recordRead({ auditId: 'a1', runId: 'r2', evidenceId: 'interview-dana' });
		expect(store.readSet('a1')).toEqual(['interview-dana', 'policy-approval']);
	});

	it('keeps a read from a run that never existed out of the audit', () => {
		expect(() =>
			store.recordRead({ auditId: 'a1', runId: 'ghost', evidenceId: 'policy-approval' }),
		).toThrow();
	});
});

describe('accumulating evidence', () => {
	beforeEach(() => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
	});

	it('promotes claims, questions and contradictions at the finish seam', () => {
		const summary = store.accumulate({
			auditId: 'a1',
			runId: 'r1',
			claims: [policy, practice],
			questions: [question],
			contradictions: [contradiction],
		});
		expect(summary).toEqual({
			claims: 2,
			questions: 1,
			contradictions: 1,
			unresolvedContradictions: 0,
		});

		const state = store.auditState('a1');
		expect(state.claims.map((c) => c.evidenceId)).toEqual(['policy-approval', 'interview-dana']);
		expect(state.questions[0]?.question).toBe(question.question);
		expect(state.contradictions[0]?.claimHashes).toEqual(
			[claimHash(policy), claimHash(practice)].sort(),
		);
	});

	it('corroborates rather than duplicates when a later run re-quotes the same span', () => {
		store.accumulate({ auditId: 'a1', runId: 'r1', claims: [policy] });
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		// Same span, same classification, a different run-local id and different wrapping.
		store.accumulate({
			auditId: 'a1',
			runId: 'r2',
			claims: [{ ...policy, claimId: 'K9', quote: 'Every release\nrequires two approvals.' }],
		});

		const state = store.auditState('a1');
		expect(state.claims).toHaveLength(1);
		expect(state.claims[0]?.sightings).toEqual([
			{ runId: 'r1', claimId: 'C1' },
			{ runId: 'r2', claimId: 'K9' },
		]);
	});

	it('does not let a later sighting rewrite the record', () => {
		store.accumulate({ auditId: 'a1', runId: 'r1', questions: [question] });
		store.answerQuestion({
			auditId: 'a1',
			questionHash: questionHash(question.question),
			evidenceId: 'answer-1',
		});
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		store.accumulate({ auditId: 'a1', runId: 'r2', questions: [question] });

		const state = store.auditState('a1');
		expect(state.questions).toHaveLength(1);
		expect(state.questions[0]?.status).toBe('answered');
	});

	it('drops a contradiction whose claims were never recorded, and counts it', () => {
		const summary = store.accumulate({
			auditId: 'a1',
			runId: 'r1',
			claims: [policy],
			contradictions: [contradiction],
		});
		expect(summary.contradictions).toBe(0);
		expect(summary.unresolvedContradictions).toBe(1);
		expect(store.auditState('a1').contradictions).toEqual([]);
	});

	it('accumulates from an incomplete run exactly as from a complete one', () => {
		store.accumulate({ auditId: 'a1', runId: 'r1', claims: [policy], questions: [question] });
		store.saveSnapshot({
			auditId: 'a1',
			runId: 'r1',
			envelope: { map: null },
			incomplete: true,
			readsUsed: 2,
			turnsUsed: 12,
		});
		expect(store.auditState('a1').claims).toHaveLength(1);
		expect(store.auditState('a1').questions).toHaveLength(1);
	});
});

describe('answers', () => {
	beforeEach(() => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
		store.accumulate({ auditId: 'a1', runId: 'r1', questions: [question] });
	});

	it('marks the question answered and names the evidence the answer arrived as', () => {
		store.answerQuestion({
			auditId: 'a1',
			questionHash: questionHash(question.question),
			evidenceId: 'answer-compliance-signoff',
		});
		const answered = store.auditState('a1').questions[0];
		expect(answered?.status).toBe('answered');
		expect(answered?.answeredByEvidenceId).toBe('answer-compliance-signoff');
	});

	it('does not add the answer to the read set: a run must read it before citing it', () => {
		store.answerQuestion({
			auditId: 'a1',
			questionHash: questionHash(question.question),
			evidenceId: 'answer-compliance-signoff',
		});
		expect(store.readSet('a1')).toEqual([]);
	});

	it('refuses to answer a question the audit does not hold', () => {
		expect(() =>
			store.answerQuestion({ auditId: 'a1', questionHash: 'nope', evidenceId: 'answer-1' }),
		).toThrow(/No open question/);
	});
});

describe('snapshots', () => {
	beforeEach(() => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
	});

	it("keeps a run's conclusions as history and out of the seeded state", () => {
		store.saveSnapshot({
			auditId: 'a1',
			runId: 'r1',
			envelope: { map: { recommendation: 'pilot the intake form' } },
			incomplete: false,
		});
		const state = store.auditState('a1');
		expect(Object.keys(state).sort()).toEqual([
			'audit',
			'claims',
			'contradictions',
			'questions',
			'readSet',
		]);
		expect(store.currentSnapshot('a1')?.envelope).toEqual({
			map: { recommendation: 'pilot the intake form' },
		});
	});

	it('never lets an incomplete run displace a finished map as the current view', () => {
		store.saveSnapshot({ auditId: 'a1', runId: 'r1', envelope: { n: 1 }, incomplete: false });
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		store.saveSnapshot({ auditId: 'a1', runId: 'r2', envelope: { n: 2 }, incomplete: true });
		expect(store.currentSnapshot('a1')?.runId).toBe('r1');
	});
});

describe('seeding cap', () => {
	it('refuses to seed a register past the cap rather than truncating it', () => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
		const claims: Claim[] = Array.from({ length: SEEDED_CLAIM_CAP + 1 }, (_unused, index) => ({
			claimId: `C${index}`,
			type: 'system-fact',
			quote: `line ${index}`,
			evidenceId: 'log-export',
		}));
		store.accumulate({ auditId: 'a1', runId: 'r1', claims });
		expect(() => store.auditState('a1')).toThrow(/past the seeding cap/);
	});
});

describe('counts', () => {
	it('records what the audit has spent, without bounding it', () => {
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'policy-approval' });
		store.accumulate({ auditId: 'a1', runId: 'r1', claims: [policy], questions: [question] });
		store.saveSnapshot({
			auditId: 'a1',
			runId: 'r1',
			envelope: {},
			incomplete: false,
			readsUsed: 1,
			turnsUsed: 7,
		});
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		store.recordRead({ auditId: 'a1', runId: 'r2', evidenceId: 'policy-approval' });
		store.recordRead({ auditId: 'a1', runId: 'r2', evidenceId: 'interview-dana' });

		expect(store.counts('a1')).toEqual({
			runs: 2,
			documentsRead: 2,
			readsSpent: 3,
			turnsSpent: 7,
			claims: 1,
			openQuestions: 1,
			answeredQuestions: 0,
			contradictions: 0,
		});
	});
});
