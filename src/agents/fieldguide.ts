'use agent';
import {
	type AgentProps,
	defineTool,
	useAgentStart,
	useDelivery,
	useInitialData,
	useModel,
	usePersistentState,
	useTool,
} from '@flue/runtime';
import * as v from 'valibot';
import { assertValidObjective } from '../domain/objective.ts';
import type { OperatingMapDraft } from '../domain/operating-map.ts';
import { seedBlocks } from '../domain/seed.ts';
import { MAX_STEPS, overTurnCap, stepGate, TURN_CAP } from '../domain/workflow-map.ts';
import { auditStore } from '../store/audit.ts';
import { noteRead, runKnowledge } from '../store/run-context.ts';
import { createOperatingMapTools, evidence } from '../tools/evidence.ts';
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

/**
 * Which audit this run belongs to. Validated synchronously at admission, before
 * anything durable is written, so a run against an id the store does not hold
 * fails before the first model turn rather than accumulating into nothing.
 */
const AuditIdentity = v.object({
	auditId: v.pipe(v.string(), v.minLength(1, 'an auditId is required')),
});

export function Fieldguide({ id: runId }: AgentProps) {
	useModel('fireworks/accounts/fireworks/models/deepseek-v4-flash-0731');

	// A run is one bounded pass over an audit: a fresh instance with an empty
	// transcript, its own budgets, and no memory of any earlier run except the
	// canonical records the audit store hands it at intake. The audit itself lives
	// in the store, not in Flue, which is what keeps a resumed run from inheriting
	// a previous run's reasoning along with its findings.
	const { auditId } = useInitialData<v.InferOutput<typeof AuditIdentity>>() ?? { auditId: '' };

	const delivery = useDelivery();
	const objective = delivery.kind === 'user' ? delivery.body.trim() : '';

	// The intake seam: validate the submitted objective, resolve the audit, open
	// the run, and seed the model with what the audit already knows. A throw here
	// fails the submission before the first model turn. Signals carry no human
	// input, so only user deliveries are checked.
	useAgentStart(async (ctx) => {
		if (delivery.kind === 'user') assertValidObjective(delivery.body);
		const store = auditStore();
		store.requireAudit(auditId);
		store.beginRun({ auditId, runId, objective });

		// Seeded as signals rather than as instruction text: a durable write made
		// here is not visible until the next render, which happens after the first
		// turn, and interpolating a growing register into the instructions would
		// bust the provider's prompt cache on every one of them.
		const state = store.auditState(auditId);
		for (const block of seedBlocks(state)) {
			ctx.append({
				kind: 'signal',
				type: block.type,
				tagName: block.tagName,
				body: block.body,
			});
		}
	});

	const [stepsUsed, setStepsUsed] = usePersistentState('stepsUsed', 0);
	const [turnsUsed, setTurnsUsed] = usePersistentState('turnsUsed', 0);
	const [draft, setDraft] = usePersistentState<OperatingMapDraft>('operatingMap', {});

	const spend = () => setStepsUsed((previous) => previous + 1);
	const spendTurn = () => setTurnsUsed((previous) => previous + 1);

	// A read is written through to the audit as it happens rather than held until
	// the finish seam: opening a document is an event that occurred, not a
	// judgement awaiting validation, so a run that never finishes still leaves the
	// audit knowing what was looked at.
	const recordRead = (evidenceId: string) => {
		auditStore().recordRead({ auditId, runId, evidenceId });
		noteRead(runId, auditId, evidenceId);
	};

	// Which documents may be cited: everything this audit has read, in this run or
	// an earlier one. Read from the store on first use inside a tool, never during
	// a render.
	const isKnownId = (evidenceId: string) => runKnowledge(runId, auditId).knownIds.has(evidenceId);

	// A Notion credential switches the agent onto the live workspace; without one
	// it runs against the local fixtures, which is how the evals exercise the loop.
	const liveNotion = notionEnabled();
	const provenance = liveNotion ? 'live' : 'fixture';

	// getState seeds the tools' in-turn mirror from the durable draft; patch writes
	// back durably. The mirror lets finish and the progress messages see sections
	// recorded earlier in the same turn, which the captured snapshot alone would miss.
	const operatingMap = createOperatingMapTools({
		isKnownId,
		getState: () => draft,
		patch: (partial) => setDraft((previous) => ({ ...previous, ...partial })),
		objective,
		provenance,
		spendTurn,
		verifyQuote: liveNotion ? undefined : verifyFixtureQuote,
	});

	// Flue has no runtime turn bound, so the turn cap is enforced by the tool
	// surface: once the budget is spent the only tool offered is finish_incomplete,
	// which saves a provisional partial map and ends the run. See docs/decisions.md.
	if (overTurnCap(turnsUsed)) {
		useTool(operatingMap.finishIncomplete);
		return [
			`You have reached the turn budget of ${TURN_CAP}. Stop recording.`,
			'Call finish_incomplete now to save a provisional map from what you have.',
		].join('\n');
	}

	if (liveNotion) {
		const { searchDocuments, readDocument } = notionTools({
			stepsUsed,
			spend,
			spendTurn,
			onRead: recordRead,
		});
		useTool(searchDocuments);
		useTool(readDocument);
	} else {
		useTool(
			defineTool({
				name: 'list_evidence',
				description:
					'List every available evidence excerpt as id and title. Use it to decide what to read next.',
				async run() {
					spendTurn();
					return { output: evidence.map(({ id, title }) => ({ id, title })) };
				},
			}),
		);
		useTool(
			defineTool({
				name: 'read_evidence',
				description:
					'Read the full text of one evidence excerpt by id. Each successful call is one investigative step and counts against the step budget. Read one excerpt at a time, then decide the next.',
				input: v.object({ id: v.string() }),
				async run({ data }) {
					spendTurn();
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

	for (const tool of operatingMap.all) useTool(tool);

	const intro = [
		'You are Fieldguide, a Forward Deployed Engineering discovery copilot.',
		'The user gives you an audit objective. Reconstruct how the work actually',
		'happens from the evidence you can reach, then produce a full operating map:',
		'the eight deliverables below, each traceable to the evidence it rests on.',
		'',
	];

	// A resumed run is told what the audit already holds, as tagged blocks ahead of
	// the objective. They are records, not a previous run's conclusions: no earlier
	// map is ever handed back, so the findings are re-derived from the evidence.
	const resumed = [
		'This audit may have been investigated before. Any evidence, open questions',
		'and unresolved contradictions earlier runs recorded are supplied to you as',
		'tagged blocks ahead of the objective. Treat them as established evidence:',
		'you may record a supplied claim as your own without re-reading its document,',
		'and you should answer or carry forward the questions rather than raise them',
		"again. You are never given an earlier run's conclusions; the map is yours to",
		'reach from the evidence.',
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
		`You also have ${TURN_CAP} turns in all (used ${turnsUsed}); past that you can only`,
		'save a provisional partial map, so record efficiently and finish.',
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
		'- record_workflow: the operating spine (the objective is fixed from the request,',
		'  you do not supply it). When a step is done differently from how policy says,',
		'  set diverges and set documented and observed to the claimIds of the written',
		'  rule and the actual practice, so the split is traceable.',
		'- record_contradictions: conflicting claims. When written policy and practice',
		'  disagree, one side of the contradiction should be the documented-policy claim',
		'  that states the rule. Record both; never pick a winner.',
		'- record_open_questions: focused questions a human should answer.',
		'- record_frictions: friction and risk, each tied to a step and its claims.',
		'- record_responsibility: who owns each step now and who should. An agent target',
		'  needs a rationale naming the friction it solves.',
		'- record_opportunities: ranked improvements, scored on impact, effort, reversibility.',
		'- record_recommendation: one thin-slice workflow to try. Set decisionClass to',
		'  advisory, approval, or publish; an autonomous aiRole may never be approval or',
		'  publish. Cite the claims or evidence that justify it in supportRefs.',
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

	return [...intro, ...resumed, ...investigate, ...budget, ...record, ...rules].join('\n');
}

Fieldguide.initialData = AuditIdentity;
