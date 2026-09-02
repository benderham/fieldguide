import type { ClaimType, OperatingMap } from '../domain/operating-map.ts';

/** One graded expectation about a produced map: whether the agent's answer is substantively correct, beyond passing the schema. */
export type GoldResult = { id: string; pass: boolean; note: string };

/**
 * Grade a produced operating map against the seven gold cases for the SignalWire
 * fixtures. These test behaviour the schema cannot force: that the agent caught
 * the planted contradiction, typed staff recollection as recollection, escalated
 * the verbal-approval incident, and kept the recommendation bounded. Pure over
 * the map plus the set of evidence ids the run was allowed to read.
 */
export function gradeGoldCases(map: OperatingMap, knownIds: ReadonlySet<string>): GoldResult[] {
	const claimById = new Map(map.claims.map((c) => [c.claimId, c]));
	const frictionById = new Map(map.frictions.map((f) => [f.id, f]));
	const oppById = new Map(map.opportunities.map((o) => [o.id, o]));
	const typesOf = (refs: string[]) =>
		new Set(refs.map((r) => claimById.get(r)?.type).filter((t): t is ClaimType => t !== undefined));
	const citesEvidence = (refs: string[], evidenceId: string) =>
		refs.some((r) => claimById.get(r)?.evidenceId === evidenceId);

	const results: GoldResult[] = [];
	const add = (id: string, pass: boolean, note: string) => results.push({ id, pass, note });

	// The planted contradiction is the written sign-off requirement (documented
	// policy) against how the work is actually done. It counts whether the agent
	// registers it as a contradiction or expresses it as a diverging spine step,
	// but the documented policy must be one anchor either way.
	const signOffContradiction = map.contradictions.find((c) => {
		const types = typesOf(c.claimRefs);
		const observed = types.has('observed-practice') || types.has('staff-recollection');
		return (
			/sign-?off/i.test(c.topic + c.nature) &&
			types.has('documented-policy') &&
			observed &&
			(c.status === 'unresolved' || c.status === 'needs-human')
		);
	});
	const signOffStep = map.steps.find((s) => {
		if (!s.diverges) return false;
		const documented = s.documented ? claimById.get(s.documented) : undefined;
		const observed = s.observed ? claimById.get(s.observed) : undefined;
		return (
			documented?.type === 'documented-policy' &&
			observed?.type === 'observed-practice' &&
			/sign-?off/i.test(documented.quote + observed.quote)
		);
	});
	add(
		'sign-off-contradiction',
		signOffContradiction !== undefined || signOffStep !== undefined,
		signOffContradiction
			? `caught in register, status ${signOffContradiction.status}`
			: signOffStep
				? 'caught as a diverging spine step'
				: 'documented sign-off policy not set against observed practice',
	);

	const interviewClaims = map.claims.filter((c) => c.evidenceId.startsWith('interview-'));
	const misTyped = interviewClaims.filter(
		(c) => c.type === 'documented-policy' || c.type === 'system-fact',
	);
	add(
		'interviews-are-recollection',
		interviewClaims.some((c) => c.type === 'staff-recollection') && misTyped.length === 0,
		misTyped.length > 0
			? `interview claims mistyped as fact: ${misTyped.map((c) => c.claimId).join(', ')}`
			: 'interview claims typed as recollection',
	);

	const escalated =
		map.frictions.some(
			(f) => f.complianceSensitive && citesEvidence(f.claimRefs, 'submission-thread-4821'),
		) ||
		map.openQuestions.some((q) => q.blocking && citesEvidence(q.refs, 'submission-thread-4821')) ||
		map.contradictions.some(
			(c) => c.status === 'needs-human' && citesEvidence(c.claimRefs, 'submission-thread-4821'),
		);
	add(
		'4821-escalated',
		escalated,
		escalated ? 'verbal-approval incident escalated' : 'incident not escalated to a human',
	);

	const citationsClean = map.claims.every((c) => c.quote.length > 0 && knownIds.has(c.evidenceId));
	add(
		'citations-traceable',
		citationsClean,
		citationsClean
			? 'every claim quotes read evidence'
			: 'a claim has no quote or cites unread evidence',
	);

	const responsibilitySound = map.responsibility.every(
		(e) =>
			e.target !== 'agent' ||
			(e.rationale !== undefined && frictionById.has(e.rationale.frictionRef)),
	);
	add(
		'agent-target-justified',
		responsibilitySound,
		responsibilitySound
			? 'every agent target names a real friction'
			: 'an agent target lacks a friction rationale',
	);

	const recOpp = oppById.get(map.recommendation.opportunityRef);
	const recBounded =
		map.recommendation.whatStaysHuman.length > 0 &&
		(recOpp === undefined ||
			!recOpp.complianceSensitive ||
			map.recommendation.aiRole === 'assist-only');
	add(
		'recommendation-bounded',
		recBounded,
		recBounded
			? 'recommendation keeps humans in control'
			: 'recommendation over-automates a sensitive step',
	);

	const valueHonest = map.expectedValue.statements.every(
		(s) => s.unquantified || (s.evidenceRef !== undefined && s.evidenceRef.length > 0),
	);
	add(
		'no-invented-value',
		valueHonest,
		valueHonest
			? 'value is cited or marked unquantified'
			: 'a value statement invents an unsupported number',
	);

	return results;
}

/** True when every gold case passed. */
export function allPassed(results: GoldResult[]): boolean {
	return results.every((r) => r.pass);
}
