import { describe, expect, it } from 'vitest';
import type { OperatingMap } from '../domain/operating-map.ts';
import { type ResumptionFacts, gradeResumption } from './resumption.ts';

const secondMap = (over: Partial<OperatingMap> = {}): OperatingMap =>
	({
		claims: [
			{
				claimId: 'C1',
				type: 'documented-policy',
				quote: 'Every release requires two approvals.',
				evidenceId: 'policy-approval',
			},
		],
		openQuestions: [],
		...over,
	}) as OperatingMap;

const facts = (over: Partial<ResumptionFacts> = {}): ResumptionFacts => ({
	answeredQuestion: 'Who signs off a compliance exception?',
	answerEvidenceId: 'answer-compliance-signoff',
	firstRunReads: ['policy-approval', 'interview-dana'],
	secondRunReads: ['answer-compliance-signoff'],
	secondMap: secondMap(),
	...over,
});

const verdict = (results: ReturnType<typeof gradeResumption>, id: string) =>
	results.find((r) => r.id === id)?.pass;

describe('grading a resumed run', () => {
	it('passes a run that reads the answer, settles the question, and uses inherited evidence', () => {
		expect(gradeResumption(facts()).every((r) => r.pass)).toBe(true);
	});

	it('fails a run that never opened the document answering its blocking question', () => {
		const results = gradeResumption(facts({ secondRunReads: ['interview-dana'] }));
		expect(verdict(results, 'reads-the-answer')).toBe(false);
	});

	it('fails a run that raises the answered question again, however reworded in case or spacing', () => {
		const results = gradeResumption(
			facts({
				secondMap: secondMap({
					openQuestions: [
						{
							question: 'WHO SIGNS OFF   a compliance exception?',
							whyItMatters: 'still unclear',
							refs: [],
							blocking: true,
						},
					],
				}),
			}),
		);
		expect(verdict(results, 'does-not-re-raise')).toBe(false);
	});

	it('fails a run that cites only what it read again itself', () => {
		const results = gradeResumption(
			facts({ secondRunReads: ['answer-compliance-signoff', 'policy-approval'] }),
		);
		expect(verdict(results, 'rests-on-inherited-evidence')).toBe(false);
	});

	it('counts a re-read document as read, not inherited', () => {
		// The second run re-read everything: nothing was inherited, so the case fails
		// even though the map is otherwise sound.
		const results = gradeResumption(
			facts({
				secondRunReads: ['answer-compliance-signoff', 'policy-approval', 'interview-dana'],
			}),
		);
		expect(verdict(results, 'rests-on-inherited-evidence')).toBe(false);
		expect(verdict(results, 'reads-the-answer')).toBe(true);
	});
});
