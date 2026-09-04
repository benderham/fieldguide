import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunEnvelope, RunOutcome } from '../domain/envelope.ts';
import type { OperatingMap } from '../domain/operating-map.ts';
import { type AuditStore, openAuditStore } from './audit.ts';
import { persistRun } from './persist.ts';

const map: OperatingMap = {
	objective: 'Audit the approval workflow',
	provenance: 'fixture',
	status: 'final',
	claims: [
		{
			claimId: 'C1',
			type: 'documented-policy',
			quote: 'Every release requires two approvals.',
			evidenceId: 'policy-approval',
		},
	],
	steps: [
		{
			seq: 1,
			actor: 'editor',
			action: 'reviews the release',
			diverges: false,
			claimRefs: ['C1'],
			isException: false,
		},
	],
	contradictions: [],
	openQuestions: [
		{
			question: 'Who signs off a compliance exception?',
			whyItMatters: 'It decides whether the exception path is auditable.',
			refs: ['C1'],
			blocking: true,
		},
	],
	frictions: [
		{
			id: 'F1',
			kind: 'friction',
			description: 'Approvals are chased by hand.',
			stepRef: '1',
			claimRefs: ['C1'],
			severity: 'medium',
			complianceSensitive: false,
		},
	],
	responsibility: [{ stepRef: '1', current: 'manual-human', target: 'manual-human' }],
	opportunities: [
		{
			id: 'O1',
			description: 'Track approvals in one place.',
			frictionRefs: ['F1'],
			responsibilityTarget: 'deterministic-software',
			impact: 'medium',
			effort: 'low',
			reversibility: 'reversible',
			complianceSensitive: false,
		},
	],
	recommendation: {
		opportunityRef: 'O1',
		scope: 'one team',
		whatAgentDoes: 'drafts the approval summary',
		aiRole: 'assist-only',
		decisionClass: 'advisory',
		supportRefs: ['C1'],
		whatStaysHuman: ['the approval itself'],
		boundaries: ['never publishes'],
		whyBounded: 'publication is irreversible',
	},
	expectedValue: { statements: [{ text: 'Less chasing.', unquantified: true }], assumptions: [] },
};

let store: AuditStore;
let dir: string;

const outcome = (over: Partial<RunOutcome> = {}): RunOutcome => ({
	auditId: 'a1',
	runId: 'r1',
	objective: 'first pass',
	provenance: 'fixture',
	incomplete: false,
	map,
	...over,
});

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunEnvelope;

beforeEach(() => {
	store = openAuditStore({ path: ':memory:' });
	store.createAudit({ auditId: 'a1', objective: 'Audit the approval workflow' });
	store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
	dir = mkdtempSync(join(tmpdir(), 'fieldguide-persist-'));
});

describe('the promotion seam', () => {
	it('accumulates evidence and questions into the audit', () => {
		persistRun(outcome(), { store, dir });
		const state = store.auditState('a1');
		expect(state.claims).toHaveLength(1);
		expect(state.questions).toHaveLength(1);
	});

	it('keeps the conclusions as a snapshot, out of the audit state', () => {
		persistRun(outcome(), { store, dir });
		const state = store.auditState('a1');
		expect(Object.keys(state)).not.toContain('recommendation');
		const snapshot = store.currentSnapshot('a1')?.envelope as RunEnvelope | undefined;
		expect(snapshot?.map?.recommendation?.opportunityRef).toBe('O1');
	});

	it('writes one file per run, so no run overwrites another record', () => {
		const first = persistRun(outcome(), { store, dir });
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });
		const second = persistRun(outcome({ runId: 'r2' }), { store, dir });
		expect(first).not.toBe(second);
		expect(read(first).run.runId).toBe('r1');
		expect(read(second).run.runId).toBe('r2');
	});

	it("records the audit's founding objective beside the run's own, so drift is visible", () => {
		const path = persistRun(outcome({ objective: 'narrow onto the exception path' }), {
			store,
			dir,
		});
		const envelope = read(path);
		expect(envelope.audit.objective).toBe('Audit the approval workflow');
		expect(envelope.run.objective).toBe('narrow onto the exception path');
	});

	it('ships the retention manifest with every record', () => {
		const envelope = read(persistRun(outcome(), { store, dir }));
		const keys = envelope.retention.map((entry) => entry.key);
		expect(keys).toContain('claims');
		expect(keys).toContain('transcript');
		for (const entry of envelope.retention) expect(entry.reason.length).toBeGreaterThan(0);
	});

	it('leaves an incomplete run structurally distinct from a finished one', () => {
		const envelope = read(
			persistRun(outcome({ incomplete: true, map: undefined, draft: { claims: map.claims } }), {
				store,
				dir,
			}),
		);
		expect(envelope.map).toBeUndefined();
		expect(envelope.run.incomplete).toBe(true);
		expect(envelope.draft?.claims).toHaveLength(1);
	});

	it("accumulates an incomplete run's evidence exactly as a complete one's", () => {
		persistRun(outcome({ incomplete: true, map: undefined, draft: { claims: map.claims } }), {
			store,
			dir,
		});
		expect(store.auditState('a1').claims).toHaveLength(1);
	});

	it('refuses to persist against an audit that was never founded', () => {
		expect(() => persistRun(outcome({ auditId: 'ghost' }), { store, dir })).toThrow(
			/Unknown audit/,
		);
	});
});
