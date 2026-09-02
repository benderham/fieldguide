import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { type Excerpt, parseExcerpt } from '../domain/excerpt.ts';
import {
	Claim,
	Contradiction,
	ExpectedValue,
	FrictionRisk,
	OpenQuestion,
	OperatingMap,
	type OperatingMap as OperatingMapType,
	type OperatingMapDraft,
	Opportunity,
	Recommendation,
	ResponsibilityEntry,
	WorkflowStep,
	validateCrossRefs,
} from '../domain/operating-map.ts';

const evidenceDir = fileURLToPath(new URL('../../evidence/', import.meta.url));

// Stand-in for the durable evidence store described in the README. For this
// slice the deliverable is written to a file so a run produces something a
// reviewer can open.
const mapPath = fileURLToPath(new URL('../../data/last-operating-map.json', import.meta.url));

/** Load every `.md` excerpt from the evidence directory, sorted by filename. */
export function loadEvidence(dir: string = evidenceDir): Excerpt[] {
	return readdirSync(dir)
		.filter((file) => file.endsWith('.md'))
		.sort()
		.map((file) => parseExcerpt(file, readFileSync(join(dir, file), 'utf8')));
}

export const evidence = loadEvidence();
export const evidenceIds = new Set(evidence.map((item) => item.id));

/** Write a finished operating map to disk as JSON, creating the target directory. */
export function saveOperatingMap(map: OperatingMapType, path: string = mapPath): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(map, null, 2));
}

export const listEvidence = defineTool({
	name: 'list_evidence',
	description:
		'List every available evidence excerpt as id and title. Free to call and does not count as an investigative step. Use it to decide what to read next.',
	async run() {
		return { output: evidence.map(({ id, title }) => ({ id, title })) };
	},
});

/** The state the section tools accumulate; the agent supplies live read/patch access to its persistent copy. */
export type OperatingMapToolDeps = {
	isKnownId: (id: string) => boolean;
	getState: () => OperatingMapDraft;
	patch: (partial: OperatingMapDraft) => void;
	save?: (map: OperatingMapType) => void;
	// Confirm a quote is a real span of the cited document. Supplied on the
	// fixtures path, where the bodies are in hand; omitted on the live path,
	// where read bodies are not retained.
	verifyQuote?: (evidenceId: string, quote: string) => boolean;
};

const REQUIRED_SECTIONS: Array<{ key: keyof OperatingMapDraft; label: string; tool: string }> = [
	{ key: 'objective', label: 'objective', tool: 'record_workflow' },
	{ key: 'claims', label: 'claims', tool: 'record_claims' },
	{ key: 'steps', label: 'workflow steps', tool: 'record_workflow' },
	{ key: 'frictions', label: 'friction and risk', tool: 'record_frictions' },
	{ key: 'responsibility', label: 'responsibility', tool: 'record_responsibility' },
	{ key: 'opportunities', label: 'opportunities', tool: 'record_opportunities' },
	{ key: 'recommendation', label: 'recommendation', tool: 'record_recommendation' },
	{ key: 'expectedValue', label: 'expected value', tool: 'record_value' },
];

function isFilled(value: unknown): boolean {
	if (value === undefined) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'string') return value.length > 0;
	return true;
}

function progress(state: OperatingMapDraft): string {
	const missing = REQUIRED_SECTIONS.filter((s) => !isFilled(state[s.key]));
	if (missing.length === 0) return 'All required sections recorded. Call finish_operating_map.';
	return `Still needed: ${missing.map((s) => `${s.label} (${s.tool})`).join(', ')}.`;
}

function firstIssue(
	issues: ReadonlyArray<{ message: string; path?: Array<{ key?: unknown }> }>,
): string {
	const issue = issues[0];
	const where = issue?.path
		?.map((p) => (typeof p.key === 'string' || typeof p.key === 'number' ? String(p.key) : ''))
		.filter(Boolean)
		.join('.');
	return where ? `${where}: ${issue.message}` : (issue?.message ?? 'invalid input');
}

/**
 * Build the section-recording tools plus the finish tool. Each record tool
 * validates its slice against the schema and merges it into the durable draft;
 * `finish_operating_map` assembles the whole object, revalidates it, checks that
 * every citation resolves and every cited evidence id was actually read, then
 * saves and ends the run. `isKnownId` decides which evidence ids count as read,
 * so eval runs verify against fixture ids and live runs against fetched ids.
 */
export function createOperatingMapTools(deps: OperatingMapToolDeps) {
	const save = deps.save ?? saveOperatingMap;

	// Flue re-renders the agent each turn, so this factory runs per turn and seeds
	// the mirror from the latest durable draft. Within a turn the mirror also
	// captures sections recorded this same turn, which the persistent snapshot
	// (read at turn start) does not, so progress and finish see the live draft.
	let draft: OperatingMapDraft = { ...deps.getState() };
	const patch = (partial: OperatingMapDraft) => {
		draft = { ...draft, ...partial };
		deps.patch(partial);
	};

	const section = <S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(config: {
		name: string;
		description: string;
		schema: S;
		merge: (value: v.InferOutput<S>) => OperatingMapDraft;
		checkEvidence?: (value: v.InferOutput<S>) => string[];
	}) =>
		defineTool({
			name: config.name,
			description: config.description,
			input: config.schema as never,
			async run({ data }) {
				const parsed = v.safeParse(config.schema, data);
				if (!parsed.success) return `Rejected: ${firstIssue(parsed.issues)}.`;
				const evidenceProblems = config.checkEvidence?.(parsed.output) ?? [];
				if (evidenceProblems.length > 0) return `Rejected: ${evidenceProblems.join(' ')}`;
				patch(config.merge(parsed.output));
				return `Recorded ${config.name}. ${progress(draft)}`;
			},
		});

	const recordClaims = section({
		name: 'record_claims',
		description:
			'Record the evidence register: every claim you draw from the documents, each with a claimId, a type (documented-policy, observed-practice, staff-recollection, system-fact, or inference), a verbatim quote from the cited document, and the evidenceId of the document you read it in. Treat staff interviews as staff-recollection, not fact.',
		schema: v.object({ claims: v.array(Claim) }),
		merge: (value) => ({ claims: value.claims }),
		checkEvidence: (value) => {
			const problems: string[] = [];
			for (const c of value.claims) {
				if (!deps.isKnownId(c.evidenceId)) {
					problems.push(`Claim '${c.claimId}' cites '${c.evidenceId}', which you did not read.`);
				} else if (deps.verifyQuote && !deps.verifyQuote(c.evidenceId, c.quote)) {
					problems.push(
						`Claim '${c.claimId}' quote is not a verbatim span of '${c.evidenceId}'. Copy the exact words from the document.`,
					);
				}
			}
			return problems;
		},
	});

	const recordWorkflow = section({
		name: 'record_workflow',
		description:
			'Record the audit objective and the operating spine: the ordered steps of how the work actually happens. For each step give a seq, the actor, the action, the claimRefs it rests on, and set diverges when the documented policy and the observed practice disagree. Reference the documented and observed claims by claimId. Mark isException for steps that only happen as an exception.',
		schema: v.object({
			objective: v.pipe(v.string(), v.minLength(1)),
			steps: v.array(WorkflowStep),
		}),
		merge: (value) => ({ objective: value.objective, steps: value.steps }),
	});

	const recordContradictions = section({
		name: 'record_contradictions',
		description:
			'Record contradictions between claims. Each names a topic, the claimRefs that conflict (at least two), the nature of the conflict, and a status: unresolved, or needs-human when a person must decide. Never pick a winner or resolve the conflict yourself.',
		schema: v.object({ contradictions: v.array(Contradiction) }),
		merge: (value) => ({ contradictions: value.contradictions }),
	});

	const recordOpenQuestions = section({
		name: 'record_open_questions',
		description:
			'Record focused clarification questions. Each has the question, why it matters, the claimRefs behind it, and blocking: true when a human must answer before the work can proceed.',
		schema: v.object({ openQuestions: v.array(OpenQuestion) }),
		merge: (value) => ({ openQuestions: value.openQuestions }),
	});

	const recordFrictions = section({
		name: 'record_frictions',
		description:
			'Record friction and risk. Each has an id, kind (friction or risk), a description, the stepRef it occurs at, the claimRefs that reveal it, a severity, and complianceSensitive: true when it touches compliance sign-off or an irreversible publish.',
		schema: v.object({ frictions: v.array(FrictionRisk) }),
		merge: (value) => ({ frictions: value.frictions }),
	});

	const recordResponsibility = section({
		name: 'record_responsibility',
		description:
			'Record, per step, who owns it now (current) and who should (target): deterministic-software, agent, manual-human, or none. A target of agent requires a rationale naming the friction/risk id it addresses. Do not propose an agent for a step merely because it is manual today.',
		schema: v.object({ responsibility: v.array(ResponsibilityEntry) }),
		merge: (value) => ({ responsibility: value.responsibility }),
	});

	const recordOpportunities = section({
		name: 'record_opportunities',
		description:
			'Record ranked improvement opportunities. Each has an id, a description, the frictionRefs it relieves, a responsibilityTarget, impact, effort, reversibility, and complianceSensitive.',
		schema: v.object({ opportunities: v.array(Opportunity) }),
		merge: (value) => ({ opportunities: value.opportunities }),
	});

	const recordRecommendation = section({
		name: 'record_recommendation',
		description:
			'Record the single recommended thin-slice workflow: the opportunityRef, the scope, what the agent does, aiRole (assist-only or autonomous), what stays human (at least one item), the boundaries, and why it is bounded. The AI part must never approve compliance or trigger an irreversible publish.',
		schema: v.object({ recommendation: Recommendation }),
		merge: (value) => ({ recommendation: value.recommendation }),
	});

	const recordValue = section({
		name: 'record_value',
		description:
			'Record expected value and assumptions. Each value statement is either cited to evidence or marked unquantified; never invent a number. List every assumption separately so it is flagged as assumption, not fact.',
		schema: v.object({ expectedValue: ExpectedValue }),
		merge: (value) => ({ expectedValue: value.expectedValue }),
	});

	const finish = defineTool({
		name: 'finish_operating_map',
		description:
			'Finish the audit. Call once every section is recorded. It assembles the whole operating map, revalidates it, checks that every citation resolves and every cited document was read, then saves it and ends the run. If anything is missing or dangling it tells you what to fix.',
		async run() {
			const state = draft;
			const missing = REQUIRED_SECTIONS.filter((s) => !isFilled(state[s.key]));
			if (missing.length > 0) {
				return `Not finished. ${progress(state)}`;
			}

			const candidate = {
				objective: state.objective ?? '',
				claims: state.claims ?? [],
				steps: state.steps ?? [],
				contradictions: state.contradictions ?? [],
				openQuestions: state.openQuestions ?? [],
				frictions: state.frictions ?? [],
				responsibility: state.responsibility ?? [],
				opportunities: state.opportunities ?? [],
				recommendation: state.recommendation,
				expectedValue: state.expectedValue,
			};

			const parsed = v.safeParse(OperatingMap, candidate);
			if (!parsed.success) {
				return `The recorded map does not validate: ${firstIssue(parsed.issues)}. Re-record that section.`;
			}

			const problems = validateCrossRefs(parsed.output, deps.isKnownId);
			if (problems.length > 0) {
				return `The map has dangling references: ${problems.join(' ')} Fix them and finish again.`;
			}

			save(parsed.output);
			return {
				output: { map: parsed.output, saved: 'data/last-operating-map.json' },
				terminate: true,
			};
		},
	});

	const tools = {
		recordClaims,
		recordWorkflow,
		recordContradictions,
		recordOpenQuestions,
		recordFrictions,
		recordResponsibility,
		recordOpportunities,
		recordRecommendation,
		recordValue,
		finish,
	};
	return { ...tools, all: Object.values(tools) };
}
