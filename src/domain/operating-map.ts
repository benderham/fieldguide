import * as v from 'valibot';

/**
 * The canonical operating-map record. One valibot-validated object holds every
 * one of the copilot deliverable's eight outputs; the Markdown report is a pure
 * function over this object, and the schema itself carries the operating-boundary
 * guards (see the object-level and entry-level `v.check`s below).
 *
 * Cross-reference resolution (does a claimRef point at a real claim, is an
 * evidenceId one the run actually read) is not a schema concern: it needs the
 * run's read set and is enforced in `finish_operating_map`. The schema enforces
 * only what a single parsed object can prove about itself.
 */

const nonEmpty = (message: string) => v.pipe(v.string(), v.minLength(1, message));

const nonEmptyArray = <T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
	item: T,
	message: string,
) => v.pipe(v.array(item), v.minLength(1, message));

/** How a claim stands relative to the evidence. Staff recollection is never `system-fact`; both are evidence, not adjudicated truth. */
export const ClaimType = v.picklist([
	'documented-policy',
	'observed-practice',
	'staff-recollection',
	'system-fact',
	'inference',
]);
export type ClaimType = v.InferOutput<typeof ClaimType>;

/**
 * One traceable statement drawn from the evidence. `quote` is a verbatim span
 * from the cited document so a reviewer can find it; `type` is the agent's
 * classification, assigned at read time (fixtures carry no machine tags).
 */
export const Claim = v.object({
	claimId: nonEmpty('claimId is required'),
	type: ClaimType,
	quote: nonEmpty('quote must be a verbatim span from the cited document'),
	evidenceId: nonEmpty('evidenceId is required'),
	actor: v.optional(v.string()),
});
export type Claim = v.InferOutput<typeof Claim>;

/**
 * One step of the operating spine. `documented` and `observed` cite the claims
 * that establish each; `diverges` is set when they conflict, so the split
 * between policy and practice is visible rather than silently reconciled.
 */
export const WorkflowStep = v.object({
	seq: v.number(),
	actor: nonEmpty('actor is required'),
	action: nonEmpty('action is required'),
	documented: v.optional(v.string()),
	observed: v.optional(v.string()),
	diverges: v.boolean(),
	claimRefs: v.array(v.string()),
	isException: v.boolean(),
});
export type WorkflowStep = v.InferOutput<typeof WorkflowStep>;

/**
 * A conflict between two or more claims. There is deliberately no resolution or
 * winner field: the copilot never adjudicates contradictory accounts, it records
 * them and, where a human must decide, marks the status `needs-human`.
 */
export const Contradiction = v.object({
	topic: nonEmpty('topic is required'),
	claimRefs: v.pipe(
		v.array(v.string()),
		v.minLength(2, 'a contradiction must reference at least two claims'),
	),
	nature: nonEmpty('nature is required'),
	status: v.picklist(['unresolved', 'needs-human']),
});
export type Contradiction = v.InferOutput<typeof Contradiction>;

/** A focused clarification question. `blocking: true` marks an answer a human must supply before the work can proceed. */
export const OpenQuestion = v.object({
	question: nonEmpty('question is required'),
	whyItMatters: nonEmpty('whyItMatters is required'),
	refs: v.array(v.string()),
	blocking: v.boolean(),
});
export type OpenQuestion = v.InferOutput<typeof OpenQuestion>;

export const Severity = v.picklist(['low', 'medium', 'high']);
export type Severity = v.InferOutput<typeof Severity>;

/** A point of friction or risk in the workflow, tied to the step and claims that reveal it. */
export const FrictionRisk = v.object({
	id: nonEmpty('id is required'),
	kind: v.picklist(['friction', 'risk']),
	description: nonEmpty('description is required'),
	stepRef: v.string(),
	claimRefs: v.array(v.string()),
	severity: Severity,
	complianceSensitive: v.boolean(),
});
export type FrictionRisk = v.InferOutput<typeof FrictionRisk>;

export const ResponsibilityActor = v.picklist([
	'deterministic-software',
	'agent',
	'manual-human',
	'none',
]);
export type ResponsibilityActor = v.InferOutput<typeof ResponsibilityActor>;

/** The justification for handing a step to an agent. It must name the friction/risk it addresses. */
export const AgentRationale = v.object({
	frictionRef: nonEmpty('rationale must reference a friction/risk id'),
	text: nonEmpty('rationale text is required'),
});
export type AgentRationale = v.InferOutput<typeof AgentRationale>;

/**
 * Who owns a step now (`current`) and who should (`target`). Proposing an agent
 * target is gated: it requires a rationale naming the friction/risk it solves,
 * so a step is never handed to AI merely because it is currently manual.
 */
export const ResponsibilityEntry = v.pipe(
	v.object({
		stepRef: v.string(),
		current: ResponsibilityActor,
		target: ResponsibilityActor,
		rationale: v.optional(AgentRationale),
	}),
	v.check(
		(entry) => entry.target !== 'agent' || entry.rationale !== undefined,
		'an agent target requires a rationale that references a friction/risk id',
	),
);
export type ResponsibilityEntry = v.InferOutput<typeof ResponsibilityEntry>;

/** Whether the AI part of an opportunity acts on its own or only assists a human who stays in control. */
export const AiRole = v.picklist(['assist-only', 'autonomous']);
export type AiRole = v.InferOutput<typeof AiRole>;

/** A ranked improvement opportunity, scored on impact, effort, and reversibility, tied to the frictions it would relieve. */
export const Opportunity = v.object({
	id: nonEmpty('id is required'),
	description: nonEmpty('description is required'),
	frictionRefs: v.array(v.string()),
	responsibilityTarget: ResponsibilityActor,
	impact: Severity,
	effort: Severity,
	reversibility: v.picklist(['reversible', 'irreversible']),
	complianceSensitive: v.boolean(),
});
export type Opportunity = v.InferOutput<typeof Opportunity>;

/**
 * The single recommended thin-slice workflow. `whatStaysHuman` must be non-empty,
 * and `aiRole` records whether the AI part is assist-only. The whole-map check
 * (see `OperatingMap`) forbids recommending a compliance-sensitive opportunity
 * unless its AI part is assist-only.
 */
export const Recommendation = v.object({
	opportunityRef: nonEmpty('opportunityRef is required'),
	scope: nonEmpty('scope is required'),
	whatAgentDoes: nonEmpty('whatAgentDoes is required'),
	aiRole: AiRole,
	whatStaysHuman: nonEmptyArray(
		v.string(),
		'whatStaysHuman must list at least one human-held step',
	),
	boundaries: v.array(v.string()),
	whyBounded: nonEmpty('whyBounded is required'),
});
export type Recommendation = v.InferOutput<typeof Recommendation>;

/** One expected-value statement: evidence-cited, or explicitly `unquantified`. Numbers are never invented to fill it. */
export const ValueStatement = v.pipe(
	v.object({
		text: nonEmpty('text is required'),
		evidenceRef: v.optional(v.string()),
		unquantified: v.boolean(),
	}),
	v.check(
		(s) => s.unquantified || (s.evidenceRef !== undefined && s.evidenceRef.length > 0),
		'a value statement must cite evidence or be marked unquantified',
	),
);
export type ValueStatement = v.InferOutput<typeof ValueStatement>;

/** Expected value plus the assumptions it rests on; every assumption is listed here, flagged as assumption not fact. */
export const ExpectedValue = v.object({
	statements: v.array(ValueStatement),
	assumptions: v.array(nonEmpty('an assumption must not be empty')),
});
export type ExpectedValue = v.InferOutput<typeof ExpectedValue>;

/**
 * The whole deliverable. The object-level check enforces the boundary that a
 * compliance-sensitive opportunity may only be recommended when its AI part is
 * assist-only; the recommended opportunity must exist for the check to bind,
 * which the cross-reference validation in `finish_operating_map` guarantees.
 */
export const OperatingMap = v.pipe(
	v.object({
		objective: nonEmpty('objective is required'),
		claims: v.array(Claim),
		steps: v.array(WorkflowStep),
		contradictions: v.array(Contradiction),
		openQuestions: v.array(OpenQuestion),
		frictions: v.array(FrictionRisk),
		responsibility: v.array(ResponsibilityEntry),
		opportunities: v.array(Opportunity),
		recommendation: Recommendation,
		expectedValue: ExpectedValue,
	}),
	v.check((map) => {
		const opp = map.opportunities.find((o) => o.id === map.recommendation.opportunityRef);
		if (opp === undefined) return true;
		return !opp.complianceSensitive || map.recommendation.aiRole === 'assist-only';
	}, 'a compliance-sensitive opportunity may only be recommended with an assist-only AI part'),
);
export type OperatingMap = v.InferOutput<typeof OperatingMap>;

/** A map under construction: each section is filled by its own tool before the run finishes. */
export type OperatingMapDraft = Partial<OperatingMap>;

/**
 * Check the cross-references a single parsed object cannot: that every citation
 * points at a claim that exists and at evidence the run actually read, that step,
 * friction, and opportunity references resolve, and that the sections a real
 * deliverable needs are present. Returns a problem per dangling reference, empty
 * when the map is whole. `isKnownId` decides which evidence ids count as read.
 */
export function validateCrossRefs(map: OperatingMap, isKnownId: (id: string) => boolean): string[] {
	const problems: string[] = [];
	const claimIds = new Set(map.claims.map((c) => c.claimId));
	const stepSeqs = new Set(map.steps.map((s) => String(s.seq)));
	const frictionIds = new Set(map.frictions.map((f) => f.id));
	const oppIds = new Set(map.opportunities.map((o) => o.id));

	if (map.claims.length !== claimIds.size) problems.push('claimId values must be unique.');
	if (map.claims.length === 0) problems.push('Record at least one claim before finishing.');
	if (map.steps.length === 0) problems.push('Record at least one workflow step before finishing.');
	if (map.opportunities.length === 0) {
		problems.push('Record at least one opportunity before finishing.');
	}

	const claimRef = (id: string, where: string) => {
		if (!claimIds.has(id)) problems.push(`${where} references unknown claim '${id}'.`);
	};
	const stepRef = (id: string, where: string) => {
		if (!stepSeqs.has(id)) problems.push(`${where} references unknown step '${id}'.`);
	};

	for (const c of map.claims) {
		if (!isKnownId(c.evidenceId)) {
			problems.push(`Claim '${c.claimId}' cites evidence '${c.evidenceId}' that was not read.`);
		}
	}
	for (const s of map.steps) {
		if (s.documented !== undefined) claimRef(s.documented, `Step ${s.seq} documented`);
		if (s.observed !== undefined) claimRef(s.observed, `Step ${s.seq} observed`);
		for (const r of s.claimRefs) claimRef(r, `Step ${s.seq}`);
	}
	for (const [i, x] of map.contradictions.entries()) {
		if (x.claimRefs.length < 2) {
			problems.push(`Contradiction ${i + 1} ('${x.topic}') must reference at least two claims.`);
		}
		for (const r of x.claimRefs) claimRef(r, `Contradiction '${x.topic}'`);
	}
	for (const q of map.openQuestions) {
		for (const r of q.refs) claimRef(r, `Open question '${q.question}'`);
	}
	for (const f of map.frictions) {
		stepRef(f.stepRef, `Friction '${f.id}'`);
		for (const r of f.claimRefs) claimRef(r, `Friction '${f.id}'`);
	}
	for (const e of map.responsibility) {
		stepRef(e.stepRef, `Responsibility for step '${e.stepRef}'`);
		if (
			e.target === 'agent' &&
			e.rationale !== undefined &&
			!frictionIds.has(e.rationale.frictionRef)
		) {
			problems.push(
				`Responsibility for step '${e.stepRef}' cites unknown friction '${e.rationale.frictionRef}'.`,
			);
		}
	}
	for (const o of map.opportunities) {
		for (const r of o.frictionRefs) {
			if (!frictionIds.has(r))
				problems.push(`Opportunity '${o.id}' cites unknown friction '${r}'.`);
		}
	}
	if (!oppIds.has(map.recommendation.opportunityRef)) {
		problems.push(
			`Recommendation references unknown opportunity '${map.recommendation.opportunityRef}'.`,
		);
	}
	for (const s of map.expectedValue.statements) {
		if (s.evidenceRef !== undefined && !claimIds.has(s.evidenceRef) && !isKnownId(s.evidenceRef)) {
			problems.push(
				`Value statement cites '${s.evidenceRef}', which is neither a claim nor read evidence.`,
			);
		}
	}

	return problems;
}
