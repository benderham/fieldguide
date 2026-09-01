'use agent';
import { defineTool, useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { MAX_STEPS, stepGate } from '../domain/workflow-map.ts';
import { evidence, listEvidence, produceWorkflowMap } from '../tools/evidence.ts';

export function Fieldguide() {
	// thinkingLevel 'low' keeps the reserved output under Groq's free-tier 8000
	// tokens-per-minute limit; the default reservation for this model exceeds it.
	useModel('groq/openai/gpt-oss-20b', { thinkingLevel: 'low' });
	const [stepsUsed, setStepsUsed] = usePersistentState('stepsUsed', 0);

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
				setStepsUsed((previous) => previous + 1);
				return { output: excerpt };
			},
		}),
	);

	useTool(produceWorkflowMap);

	return [
		'You are Fieldguide, a Forward Deployed Engineering discovery copilot.',
		'The user gives you an audit objective. Reconstruct how the work actually',
		'happens from the supplied evidence, then return a preliminary workflow map.',
		'',
		'Loop:',
		'1. Call list_evidence to see what excerpts exist.',
		'2. Choose the single most useful excerpt and call read_evidence on it.',
		'3. Use what you learned to choose the next excerpt.',
		'4. When the workflow is clear enough, call produce_workflow_map to finish.',
		'',
		'Call read_evidence for one id per turn. Do not request several excerpts at',
		'once: each read is meant to inform which excerpt you choose next.',
		'',
		`You have a budget of ${MAX_STEPS} read_evidence calls. You have used ${stepsUsed}.`,
		'Spend them on the excerpts most likely to reveal the workflow. If the budget',
		'runs out, you will be told to produce the map from what you have.',
		'',
		'Rules:',
		'- Set evidenceId on each step to the id of the excerpt it came from, so a',
		'  reviewer can trace it. Use only ids returned by list_evidence.',
		'- Report only what the evidence supports. Put anything unverified, missing,',
		'  or contradictory in gaps rather than inventing a clean story.',
		'- Finish only by calling produce_workflow_map.',
	].join('\n');
}
