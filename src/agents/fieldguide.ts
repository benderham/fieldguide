'use agent';
import { defineTool, useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { MAX_STEPS, stepGate } from '../domain/workflow-map.ts';
import { createProduceWorkflowMap, evidence, listEvidence } from '../tools/evidence.ts';
import { notionEnabled, notionTools } from '../tools/notion.ts';
// Registers a Fireworks provider whose catalog includes the pinned model below.
// Side-effect import; `flue run` loads only this agent module.
import '../providers.ts';

export function Fieldguide() {
	useModel('fireworks/accounts/fireworks/models/deepseek-v4-flash-0731');
	const [stepsUsed, setStepsUsed] = usePersistentState('stepsUsed', 0);
	const [readIds, setReadIds] = usePersistentState<string[]>('readIds', []);

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

	useTool(createProduceWorkflowMap((id) => readIds.includes(id)));

	const intro = [
		'You are Fieldguide, a Forward Deployed Engineering discovery copilot.',
		'The user gives you an audit objective. Reconstruct how the work actually',
		'happens from the evidence you can reach, then return a preliminary workflow map.',
		'',
	];

	const loop = liveNotion
		? [
				'Loop:',
				'1. Call search_documents with a natural-language query to find relevant documents.',
				'2. Choose the single most useful document and call read_document on its id.',
				'3. Use what you learned to choose the next query or read.',
				'4. When the workflow is clear enough, call produce_workflow_map to finish.',
				'',
				'Each turn, decide whether you already have enough context, need to',
				'search_documents to find more, or should spend a read_document on one',
				'specific document. Search to narrow before you spend a read. Read one',
				'document per turn: each read is meant to inform which document you choose next.',
			]
		: [
				'Loop:',
				'1. Call list_evidence to see what excerpts exist.',
				'2. Choose the single most useful excerpt and call read_evidence on it.',
				'3. Use what you learned to choose the next excerpt.',
				'4. When the workflow is clear enough, call produce_workflow_map to finish.',
				'',
				'Call read_evidence for one id per turn. Do not request several excerpts at',
				'once: each read is meant to inform which excerpt you choose next.',
			];

	const budget = [
		'',
		`You have a budget of ${MAX_STEPS} reads. You have used ${stepsUsed}.`,
		'Spend them on the documents most likely to reveal the workflow. If the budget',
		'runs out, you will be told to produce the map from what you have.',
		'',
	];

	const rules = [
		'Rules:',
		'- Set evidenceId on each step to the id of the document it came from, so a',
		'  reviewer can trace it. Cite only ids of documents you actually read.',
		'- Report only what the evidence supports. Put anything unverified, missing,',
		'  or contradictory in gaps rather than inventing a clean story.',
		'- Finish only by calling produce_workflow_map.',
	];

	return [...intro, ...loop, ...budget, ...rules].join('\n');
}
