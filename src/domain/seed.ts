import type { AuditState } from '../store/audit.ts';

/**
 * What a resumed run wakes up knowing.
 *
 * A run is a fresh instance with an empty transcript, so everything it inherits
 * arrives here — and only canonical records do. No prior conclusions, and no
 * prose from an earlier run: a resumed audit re-derives its findings from the
 * evidence rather than inheriting the story someone told about it last time.
 *
 * Each record class becomes one XML-tagged signal block, which is also why the
 * seed reads as supplied context rather than as something the model said: the
 * segregation between scratch reasoning and audit data shows up in the layout of
 * the context itself.
 */

export type SeedBlock = {
	/** The signal type, namespaced so a reader can tell seeded audit state from framework narration. */
	type: string;
	/** The XML tag the block renders as in model context. */
	tagName: string;
	body: string;
};

/** Enough of a hash to be unambiguous in context without spending tokens on 64 hex characters. */
const short = (hash: string) => hash.slice(0, 12);

function claimsBlock(state: AuditState): SeedBlock | undefined {
	if (state.claims.length === 0) return undefined;
	const lines = state.claims.map((claim) => {
		const corroborated =
			claim.sightings.length > 1 ? ` (found in ${claim.sightings.length} runs)` : '';
		return `- [${short(claim.claimHash)}] ${claim.type} from ${claim.evidenceId}${corroborated}: "${claim.quote}"`;
	});
	return {
		type: 'audit.claims',
		tagName: 'evidence-already-gathered',
		body: [
			'Claims earlier runs of this audit drew from the evidence. The quotes are verbatim',
			'spans of documents this audit has read, so you may record any of them again in',
			'your own claims without spending a read on the document.',
			'',
			...lines,
		].join('\n'),
	};
}

function questionsBlock(state: AuditState): SeedBlock | undefined {
	if (state.questions.length === 0) return undefined;
	// Answered questions first, blocking ones ahead of the rest: an answer a human
	// went to the trouble of writing is the most useful thing a resumed run can
	// spend a read on, and priority is how that is signalled rather than by
	// exempting it from the budget.
	const ordered = [...state.questions].sort((a, b) => {
		const answered = Number(b.status === 'answered') - Number(a.status === 'answered');
		if (answered !== 0) return answered;
		return Number(b.blocking) - Number(a.blocking);
	});
	const lines = ordered.map((question) => {
		if (question.status === 'answered') {
			return `- ANSWERED — read '${question.answeredByEvidenceId}' for the answer: ${question.question}`;
		}
		return `- ${question.blocking ? 'BLOCKING' : 'open'}: ${question.question} (${question.whyItMatters})`;
	});
	return {
		type: 'audit.open-questions',
		tagName: 'open-questions',
		body: [
			'Questions raised by earlier runs of this audit. An answered one has come back',
			'from a human as a document: read it before relying on the answer, and treat it',
			'as staff recollection, not fact. Do not raise a question again once it is answered.',
			'',
			...lines,
		].join('\n'),
	};
}

function contradictionsBlock(state: AuditState): SeedBlock | undefined {
	if (state.contradictions.length === 0) return undefined;
	const lines = state.contradictions.map(
		(contradiction) =>
			`- ${contradiction.topic} [${contradiction.status}] between ${contradiction.claimHashes
				.map(short)
				.join(' and ')}: ${contradiction.nature}`,
	);
	return {
		type: 'audit.contradictions',
		tagName: 'unresolved-contradictions',
		body: [
			'Conflicts earlier runs found and did not resolve, because resolving one is a',
			"human's decision. Record them again if they still stand; never pick a winner.",
			'',
			...lines,
		].join('\n'),
	};
}

function readSetBlock(state: AuditState): SeedBlock | undefined {
	if (state.readSet.length === 0) return undefined;
	return {
		type: 'audit.read-set',
		tagName: 'documents-already-read',
		body: [
			'Documents this audit has opened in an earlier run. You may cite any of them',
			'without reading it again, though re-reading one costs a step like any other read.',
			'',
			...state.readSet.map((id) => `- ${id}`),
		].join('\n'),
	};
}

/**
 * Render an audit's canonical state as the blocks a fresh run is seeded with.
 * A first run seeds nothing: an empty audit produces no blocks rather than a set
 * of empty headings the model has to read past.
 */
export function seedBlocks(state: AuditState): SeedBlock[] {
	return [
		questionsBlock(state),
		contradictionsBlock(state),
		claimsBlock(state),
		readSetBlock(state),
	].filter((block): block is SeedBlock => block !== undefined);
}
