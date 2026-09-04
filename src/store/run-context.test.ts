import { beforeEach, describe, expect, it } from 'vitest';
import { type AuditStore, openAuditStore } from './audit.ts';
import { forgetRun, noteRead, runKnowledge } from './run-context.ts';

let store: AuditStore;

beforeEach(() => {
	store = openAuditStore({ path: ':memory:' });
	store.createAudit({ auditId: 'a1', objective: 'Audit the approval workflow' });
	store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
	forgetRun('r1');
	forgetRun('r2');
});

describe("a run's working knowledge", () => {
	it('inherits every document the audit has read, from any run', () => {
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'policy-approval' });
		store.beginRun({ auditId: 'a1', runId: 'r2', objective: 'second pass' });

		// A later run, in a fresh instance with no memory of the first.
		expect(runKnowledge('r2', 'a1', store).knownIds.has('policy-approval')).toBe(true);
	});

	it('sees a document opened later in the same run', () => {
		const knowledge = runKnowledge('r1', 'a1', store);
		expect(knowledge.knownIds.has('interview-dana')).toBe(false);
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'interview-dana' });
		noteRead('r1', 'a1', 'interview-dana', store);
		expect(knowledge.knownIds.has('interview-dana')).toBe(true);
	});

	it('rebuilds itself from the store after the cache is lost', () => {
		store.recordRead({ auditId: 'a1', runId: 'r1', evidenceId: 'policy-approval' });
		noteRead('r1', 'a1', 'policy-approval', store);
		forgetRun('r1');
		expect(runKnowledge('r1', 'a1', store).knownIds.has('policy-approval')).toBe(true);
	});

	it('knows nothing of a document no run ever opened', () => {
		expect(runKnowledge('r1', 'a1', store).knownIds.has('never-read')).toBe(false);
	});
});
