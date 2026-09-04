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

/**
 * What kind of decision a recommendation's action makes. `approval` and
 * `publish` are the boundary-sensitive classes: a compliance sign-off, or an
 * irreversible release. `advisory` only informs a human who then decides.
 */
export const DecisionClass = v.picklist(['advisory', 'approval', 'publish']);
export type DecisionClass = v.InferOutput<typeof DecisionClass>;

/** An autonomous AI part making an approval or publish decision: the one recommendation the boundary forbids outright. */
export function isProhibitedAutonomy(rec: {
	aiRole: AiRole;
	decisionClass: DecisionClass;
}): boolean {
	return (
		rec.aiRole === 'autonomous' &&
		(rec.decisionClass === 'approval' || rec.decisionClass === 'publish')
	);
}

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
 * and `aiRole` records whether the AI part is assist-only. `supportRefs` ties the
 * recommendation to the claims or read evidence that justify it: a recommendation
 * with no support cannot be a final finding. The entry check forbids an autonomous
 * AI part from making an approval or publish decision; the whole-map check (see
 * `OperatingMap`) additionally forbids recommending a compliance-sensitive
 * opportunity unless its AI part is assist-only.
 */
export const Recommendation = v.pipe(
	v.object({
		opportunityRef: nonEmpty('opportunityRef is required'),
		scope: nonEmpty('scope is required'),
		whatAgentDoes: nonEmpty('whatAgentDoes is required'),
		aiRole: AiRole,
		decisionClass: DecisionClass,
		supportRefs: nonEmptyArray(
			v.string(),
			'a recommendation must cite at least one supporting claim or evidence id',
		),
		whatStaysHuman: nonEmptyArray(
			v.string(),
			'whatStaysHuman must list at least one human-held step',
		),
		boundaries: v.array(v.string()),
		whyBounded: nonEmpty('whyBounded is required'),
	}),
	v.check(
		(r) => !isProhibitedAutonomy(r),
		'an autonomous AI part may not make an approval or publish decision; that stays with a human',
	),
);
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

/** Where a map's evidence came from. The live Notion path cannot verify verbatim quotes, so its findings are never final. */
export const Provenance = v.picklist(['fixture', 'live']);
export type Provenance = v.InferOutput<typeof Provenance>;

/** Whether the map's findings are final or provisional. A provisional map is pending verification a human must complete. */
export const MapStatus = v.picklist(['final', 'provisional']);
export type MapStatus = v.InferOutput<typeof MapStatus>;

/**
 * The whole deliverable. The first object-level check enforces the boundary that
 * a compliance-sensitive opportunity may only be recommended when its AI part is
 * assist-only; the recommended opportunity must exist for the check to bind,
 * which the cross-reference validation in `finish_operating_map` guarantees. The
 * second forbids a `final` status on a `live`-sourced map: live reads cannot be
 * quote-verified, so their findings stay provisional. `provenance` and `status`
 * are set by the run at finish, not by the model.
 */
export const OperatingMap = v.pipe(
	v.object({
		objective: nonEmpty('objective is required'),
		provenance: Provenance,
		status: MapStatus,
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
	v.check(
		(map) => map.provenance !== 'live' || map.status === 'provisional',
		'a live-sourced map cannot be final; its findings are provisional until a human verifies them',
	),
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
	const inferenceIds = new Set(
		map.claims.filter((c) => c.type === 'inference').map((c) => c.claimId),
	);
	for (const [i, x] of map.contradictions.entries()) {
		if (x.claimRefs.length < 2) {
			problems.push(`Contradiction ${i + 1} ('${x.topic}') must reference at least two claims.`);
		}
		// A conflict between an inference and a document is the copilot disagreeing
		// with the evidence, not two accounts of the work disagreeing with each
		// other. Recording it as a contradiction would put the agent's own reasoning
		// on the same footing as the client's records.
		const evidenced = x.claimRefs.filter((r) => claimIds.has(r) && !inferenceIds.has(r));
		if (evidenced.length < 2) {
			problems.push(
				`Contradiction ${i + 1} ('${x.topic}') must hold at least two evidenced claims in conflict; an inference cannot be one side of it.`,
			);
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
	for (const s of map.expectedValue.statements) {
		if (s.evidenceRef !== undefined && !claimIds.has(s.evidenceRef) && !isKnownId(s.evidenceRef)) {
			problems.push(
				`Value statement cites '${s.evidenceRef}', which is neither a claim nor read evidence.`,
			);
		}
		// A value resting on the agent's own reasoning is an invented number wearing
		// a citation. Say it is unquantified instead.
		if (s.evidenceRef !== undefined && inferenceIds.has(s.evidenceRef)) {
			problems.push(
				`Value statement cites inference '${s.evidenceRef}' as its evidence. Cite evidence, or mark the statement unquantified.`,
			);
		}
	}

	problems.push(
		...recommendationProblems(map.recommendation, map.claims, map.opportunities, isKnownId),
	);

	return problems;
}

/**
 * Check a recommendation's cross-references and the compliance boundary, given
 * the claims and opportunities in scope: its opportunity must exist, a
 * compliance-sensitive one may be recommended only with an assist-only AI part,
 * and every supportRef must resolve to a claim or read evidence. Shared by the
 * whole-map validation and the incomplete-finish screen so a partial map is held
 * to the same guards as a complete one. Empty when clean.
 */
export function recommendationProblems(
	recommendation: Recommendation,
	claims: Claim[],
	opportunities: Opportunity[],
	isKnownId: (id: string) => boolean,
): string[] {
	const problems: string[] = [];
	const claimIds = new Set(claims.map((c) => c.claimId));
	const opp = opportunities.find((o) => o.id === recommendation.opportunityRef);
	if (opp === undefined) {
		problems.push(
			`Recommendation references unknown opportunity '${recommendation.opportunityRef}'.`,
		);
	} else if (opp.complianceSensitive && recommendation.aiRole !== 'assist-only') {
		problems.push(
			'a compliance-sensitive opportunity may only be recommended with an assist-only AI part',
		);
	}
	const inferenceIds = new Set(claims.filter((c) => c.type === 'inference').map((c) => c.claimId));
	let evidencedSupport = 0;
	for (const r of recommendation.supportRefs) {
		if (!claimIds.has(r) && !isKnownId(r)) {
			problems.push(
				`Recommendation cites support '${r}', which is neither a claim nor read evidence.`,
			);
			continue;
		}
		if (!inferenceIds.has(r)) evidencedSupport += 1;
	}
	// Inference may describe, never support. An inference claim is the agent's own
	// reasoning; letting it stand as the support under a recommendation would make
	// "unsupported conclusions cannot become final findings" mean reasoning-backed
	// rather than evidence-backed, which is the residual gap ADR-0008 named.
	if (recommendation.supportRefs.length > 0 && evidencedSupport === 0) {
		problems.push(
			'a recommendation must rest on at least one evidenced claim or read document; inference alone is not support',
		);
	}
	return problems;
}
