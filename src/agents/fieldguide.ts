'use agent';
import { defineTool, useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';
import type { OperatingMapDraft } from '../domain/operating-map.ts';
import { MAX_STEPS, stepGate } from '../domain/workflow-map.ts';
import { createOperatingMapTools, evidence, listEvidence } from '../tools/evidence.ts';
import { notionEnabled, notionTools } from '../tools/notion.ts';
// Registers a Fireworks provider whose catalog includes the pinned model below.
// Side-effect import; `flue run` loads only this agent module.
import '../providers.ts';

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when the quote is a span of the cited fixture, comparing on collapsed whitespace so line wrapping does not matter. */
function verifyFixtureQuote(evidenceId: string, quote: string): boolean {
	const excerpt = evidence.find((item) => item.id === evidenceId);
	if (excerpt === undefined) return true;
	return normalize(excerpt.body).includes(normalize(quote));
}

export function Fieldguide() {
	useModel('fireworks/accounts/fireworks/models/deepseek-v4-flash-0731');
	const [stepsUsed, setStepsUsed] = usePersistentState('stepsUsed', 0);
	const [readIds, setReadIds] = usePersistentState<string[]>('readIds', []);
	const [draft, setDraft] = usePersistentState<OperatingMapDraft>('operatingMap', {});

	const spend = () => setStepsUsed((previous) => previous + 1);
	const recordRead = (id: string) =>
		setReadIds((previous) => (previous.includes(id) ? previous : [...previous, id]));

	// A Notion credential switches the agent onto the live workspace; without one
	// it runs against the local fixtures, which is how the evals exercise the loop.
	const liveNotion = notionEnabled();

	if (liveNotion) {
		const { searchDocuments, readDocument } = notionTools({ stepsUsed, spend, onRead: recordRead });
		useTool(searchDocuments);
		useTool(readDocument);
	} else {
		useTool(listEvidence);
		useTool(
			defineTool({
				name: 'read_evidence',
				description:
					'Read the full text of one evidence excerpt by id. Each successful call is one investigative step and counts against the step budget. Read one excerpt at a time, then decide the next.',
				input: v.object({ id: v.string() }),
				async run({ data }) {
					const gate = stepGate(stepsUsed);
					if (!gate.allowed) return gate.message;
					const excerpt = evidence.find((item) => item.id === data.id);
					if (!excerpt) {
						return `No excerpt with id "${data.id}". Call list_evidence for valid ids.`;
					}
					spend();
					recordRead(data.id);
					return { output: excerpt };
				},
			}),
		);
	}

	// getState seeds the tools' in-turn mirror from the durable draft; patch writes
	// back durably. The mirror lets finish and the progress messages see sections
	// recorded earlier in the same turn, which the captured snapshot alone would miss.
	const operatingMap = createOperatingMapTools({
		isKnownId: (id) => readIds.includes(id),
		getState: () => draft,
		patch: (partial) => setDraft((previous) => ({ ...previous, ...partial })),
		verifyQuote: liveNotion ? undefined : verifyFixtureQuote,
	});
	for (const tool of operatingMap.all) useTool(tool);

	const intro = [
		'You are Fieldguide, a Forward Deployed Engineering discovery copilot.',
		'The user gives you an audit objective. Reconstruct how the work actually',
		'happens from the evidence you can reach, then produce a full operating map:',
		'the eight deliverables below, each traceable to the evidence it rests on.',
		'',
	];

	const investigate = liveNotion
		? [
				'Investigate first:',
				'1. Call search_documents with a natural-language query to find relevant documents.',
				'2. Choose the single most useful document and call read_document on its id.',
				'3. Use what you learned to choose the next query or read.',
				'Read one document per turn: each read informs which document you choose next.',
				'',
			]
		: [
				'Investigate first:',
				'1. Call list_evidence to see what excerpts exist.',
				'2. Choose the single most useful excerpt and call read_evidence on it.',
				'3. Use what you learned to choose the next excerpt.',
				'Read one excerpt per turn: each read informs which excerpt you choose next.',
				'',
			];

	const budget = [
		`You have a budget of ${MAX_STEPS} reads. You have used ${stepsUsed}.`,
		'Spend them on the documents most likely to reveal the workflow. When the budget',
		'runs out you will be told to stop reading and record from what you have.',
		'',
	];

	const record = [
		'Then record the operating map, one section per tool. You can record a section',
		'more than once to correct it; the last version wins.',
		'- record_claims: the evidence register. Every claim you rely on, each with a',
		'  claimId, a type, a verbatim quote, and the evidenceId you read it in.',
		'  Classify each claim honestly: documented-policy for written procedure,',
		'  observed-practice for how people say the work is really done,',
		'  staff-recollection for what an interviewee remembers, system-fact for a tool',
		'  or log statement, inference for your own reasoning. A staff interview is',
		'  staff-recollection, never fact.',
		'- record_workflow: the objective and the operating spine. When a step is done',
		'  differently from how policy says, set diverges and set documented and observed',
		'  to the claimIds of the written rule and the actual practice, so the split is',
		'  traceable.',
		'- record_contradictions: conflicting claims. When written policy and practice',
		'  disagree, one side of the contradiction should be the documented-policy claim',
		'  that states the rule. Record both; never pick a winner.',
		'- record_open_questions: focused questions a human should answer.',
		'- record_frictions: friction and risk, each tied to a step and its claims.',
		'- record_responsibility: who owns each step now and who should. An agent target',
		'  needs a rationale naming the friction it solves.',
		'- record_opportunities: ranked improvements, scored on impact, effort, reversibility.',
		'- record_recommendation: one thin-slice workflow to try.',
		'- record_value: expected value and assumptions.',
		'Finish by calling finish_operating_map on its own, after the last record call.',
		'',
	];

	const rules = [
		'Rules:',
		'- Cite evidence you actually read. Every quote must be a verbatim span from the',
		'  document, and every evidenceId must be one you retrieved.',
		'- Report only what the evidence supports. Do not invent numbers, quotes, or a',
		'  clean story. If you cannot quantify a value, mark it unquantified.',
		'- Never resolve a contradiction yourself. Record both accounts.',
		'- Escalate, do not decide. Anything touching compliance sign-off, or an',
		'  irreversible act such as distributing or publishing a release, is for a human.',
		'  Mark such open questions blocking, mark such contradictions needs-human, and',
		'  set complianceSensitive on the frictions and opportunities involved. The AI',
		'  part of any recommendation must never approve compliance or trigger a publish.',
		'- Do not propose an agent for a step merely because it is manual today; propose',
		'  it only where a named friction or risk justifies it.',
		'- Finish only by calling finish_operating_map.',
	];

	return [...intro, ...investigate, ...budget, ...record, ...rules].join('\n');
}
