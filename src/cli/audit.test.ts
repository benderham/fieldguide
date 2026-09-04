import { beforeEach, describe, expect, it } from 'vitest';
import { questionHash } from '../domain/identity.ts';
import type { OpenQuestion } from '../domain/operating-map.ts';
import { type AuditStore, openAuditStore } from '../store/audit.ts';
import { runAuditCli } from './audit.ts';

const question: OpenQuestion = {
	question: 'Who signs off a compliance exception?',
	whyItMatters: 'It decides whether the exception path is auditable.',
	refs: [],
	blocking: true,
};

let store: AuditStore;
let lines: string[];

const cli = (...argv: string[]) => runAuditCli(argv, { store, log: (line) => lines.push(line) });

beforeEach(() => {
	store = openAuditStore({ path: ':memory:' });
	lines = [];
});

describe('audit new', () => {
	it('founds an audit and shows how to run against it', () => {
		cli('new', '--id', 'a1', '--objective', 'Audit the approval workflow');
		expect(store.getAudit('a1')?.objective).toBe('Audit the approval workflow');
		expect(lines.join('\n')).toContain('"auditId":"a1"');
	});

	it('names the missing option rather than founding a half-specified audit', () => {
		expect(() => cli('new', '--id', 'a1')).toThrow(/--objective is required/);
		expect(store.getAudit('a1')).toBeUndefined();
	});
});

describe('audit answer', () => {
	beforeEach(() => {
		cli('new', '--id', 'a1', '--objective', 'Audit the approval workflow');
		store.beginRun({ auditId: 'a1', runId: 'r1', objective: 'first pass' });
		store.accumulate({ auditId: 'a1', runId: 'r1', questions: [question] });
	});

	it('marks the question answered by the evidence the answer arrived as', () => {
		cli('answer', '--id', 'a1', '--question', question.question, '--evidence', 'answer-1');
		const answered = store.auditState('a1').questions[0];
		expect(answered?.status).toBe('answered');
		expect(answered?.answeredByEvidenceId).toBe('answer-1');
	});

	it('matches the question however it was cased or wrapped', () => {
		cli(
			'answer',
			'--id',
			'a1',
			'--question',
			'  WHO SIGNS OFF a compliance   exception?  ',
			'--evidence',
			'answer-1',
		);
		expect(store.auditState('a1').questions[0]?.status).toBe('answered');
	});

	it('refuses a question the audit never raised', () => {
		expect(() =>
			cli('answer', '--id', 'a1', '--question', 'Something else?', '--evidence', 'answer-1'),
		).toThrow(/No open question/);
		expect(questionHash('Something else?')).not.toBe(questionHash(question.question));
	});
});

describe('audit retention', () => {
	it('prints every retained item with its scope and reason', () => {
		cli('retention');
		const printed = lines.join('\n');
		for (const key of ['claims', 'openQuestions', 'snapshots', 'transcript', 'readSet']) {
			expect(printed).toContain(key);
		}
		expect(printed).toContain('never read back');
	});
});

describe('an unknown command', () => {
	it('prints usage rather than guessing', () => {
		expect(() => cli('destroy', '--id', 'a1')).toThrow(/Usage:/);
	});
});
