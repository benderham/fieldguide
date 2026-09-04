import { questionHash } from '../domain/identity.ts';
import type { OperatingMap } from '../domain/operating-map.ts';
import type { GoldResult } from './gold-cases.ts';

/**
 * The gold case for resuming an audit.
 *
 * Everything else in the retention design is decidable without a model, so the
 * deterministic suite carries it. Resumption is the exception: whether a second
 * run actually *uses* what the audit already knows — reads the answer a human
 * supplied, stops re-raising a question that has been answered, and rests on
 * evidence it inherited instead of spending its budget re-reading — is
 * behaviour, and only a model in the loop shows it.
 *
 * Pure over the two runs' facts, so the grading is unit-tested without tokens.
 */

export type ResumptionFacts = {
	/** The blocking question run 1 raised, verbatim, that a human then answered. */
	answeredQuestion: string;
	/** The document the answer arrived as. */
	answerEvidenceId: string;
	/** Documents each run opened, in order. */
	firstRunReads: string[];
	secondRunReads: string[];
	/** The map the second run produced. */
	secondMap: OperatingMap;
};

export function gradeResumption(facts: ResumptionFacts): GoldResult[] {
	const results: GoldResult[] = [];
	const add = (id: string, pass: boolean, note: string) => results.push({ id, pass, note });

	// 1. The answer is prominent in the seed, but not free: the run has to spend a
	//    read on it before anything may rest on it.
	const readTheAnswer = facts.secondRunReads.includes(facts.answerEvidenceId);
	add(
		'reads-the-answer',
		readTheAnswer,
		readTheAnswer
			? `read '${facts.answerEvidenceId}'`
			: `never opened '${facts.answerEvidenceId}', the document answering its blocking question`,
	);

	// 2. An answered question is settled. Raising it again means the seed was
	//    ignored, which is the failure that makes escalation pointless.
	const answeredHash = questionHash(facts.answeredQuestion);
	const raisedAgain = facts.secondMap.openQuestions.some(
		(q) => questionHash(q.question) === answeredHash,
	);
	add(
		'does-not-re-raise',
		!raisedAgain,
		raisedAgain ? 'raised the answered question again' : 'left the answered question settled',
	);

	// 3. Inherited evidence is there to be used. A run that cites only what it read
	//    itself has resumed in name only, and will exhaust its budget re-reading
	//    what the audit already holds.
	const secondRunRead = new Set(facts.secondRunReads);
	const inheritedOnly = facts.firstRunReads.filter((id) => !secondRunRead.has(id));
	const restsOnInherited = facts.secondMap.claims.some((claim) =>
		inheritedOnly.includes(claim.evidenceId),
	);
	add(
		'rests-on-inherited-evidence',
		restsOnInherited,
		restsOnInherited
			? 'cited a document it inherited rather than re-read'
			: 'cited nothing it did not read again itself',
	);

	return results;
}
