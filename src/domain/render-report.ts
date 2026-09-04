import type { RetentionEntry } from './retention.ts';
import type {
	Claim,
	Contradiction,
	FrictionRisk,
	OpenQuestion,
	OperatingMap,
	Opportunity,
	Recommendation,
	ResponsibilityEntry,
	WorkflowStep,
} from './operating-map.ts';

/**
 * Render an operating map as a Markdown report. Pure and deterministic: the same
 * map always yields the same text, and no model is involved. One section per
 * deliverable, in the order of the copilot assignment, with the human-control
 * points called out up front so a reviewer sees them before anything else.
 */
export function renderReport(map: OperatingMap, retention?: RetentionEntry[]): string {
	const claimById = new Map(map.claims.map((c) => [c.claimId, c]));
	const quote = (id: string | undefined): string => {
		if (id === undefined) return '_none_';
		const claim = claimById.get(id);
		return claim ? `"${claim.quote}" (${claim.evidenceId})` : `_unknown claim ${id}_`;
	};

	const lines: string[] = [`# Operating map: ${map.objective}`, ''];

	if (map.status === 'provisional') {
		lines.push(
			`> **Provisional map (${map.provenance}-sourced).** Findings are not final until a human verifies them.`,
			'',
		);
	}

	lines.push(...controlPoints(map));
	lines.push('## 1. Current-state operating map', '');
	for (const step of map.steps) lines.push(...renderStep(step, quote));

	lines.push('## 2. Evidence and contradiction register', '', '### Evidence', '');
	for (const claim of map.claims) lines.push(renderClaim(claim));
	lines.push('', '### Contradictions', '');
	if (map.contradictions.length === 0) lines.push('_None recorded._', '');
	for (const c of map.contradictions) lines.push(...renderContradiction(c, quote));

	lines.push('## 3. Focused clarification questions', '');
	if (map.openQuestions.length === 0) lines.push('_None recorded._', '');
	for (const q of map.openQuestions) lines.push(renderQuestion(q));
	lines.push('');

	lines.push('## 4. Friction and risk', '');
	if (map.frictions.length === 0) lines.push('_None recorded._', '');
	for (const f of map.frictions) lines.push(renderFriction(f));
	lines.push('');

	lines.push('## 5. Responsibility map', '');
	for (const e of map.responsibility) lines.push(renderResponsibility(e));
	lines.push('');

	lines.push('## 6. Ranked opportunity assessment', '');
	for (const o of map.opportunities) lines.push(renderOpportunity(o));
	lines.push('');

	lines.push('## 7. Recommended thin-slice workflow', '');
	lines.push(...renderRecommendation(map.recommendation));

	lines.push('## 8. Expected value and open assumptions', '');
	for (const s of map.expectedValue.statements) {
		const cite = s.unquantified ? '_unquantified_' : `(${s.evidenceRef})`;
		lines.push(`- ${s.text} ${cite}`);
	}
	lines.push('', '**Assumptions (not fact):**');
	if (map.expectedValue.assumptions.length === 0) lines.push('- _none_');
	for (const a of map.expectedValue.assumptions) lines.push(`- ${a}`);
	lines.push('');

	// What the run kept and why, at both scopes. A reader who wants to know what
	// this record rests on should be able to see what outlived the run that made
	// it — including the parts deliberately discarded.
	if (retention !== undefined && retention.length > 0) {
		lines.push('---', '', '## What this run retained, and why', '');
		for (const entry of retention) {
			lines.push(`- **${entry.key}** (${entry.scope}): ${entry.reason}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

function controlPoints(map: OperatingMap): string[] {
	const blocking = map.openQuestions
		.filter((q) => q.blocking)
		.map((q) => `- Blocking question: ${q.question}`);
	const needsHuman = map.contradictions
		.filter((c) => c.status === 'needs-human')
		.map((c) => `- Needs a human decision: ${c.topic}`);
	const sensitive = map.frictions
		.filter((f) => f.complianceSensitive)
		.map((f) => `- Compliance-sensitive: ${f.description}`);
	const all = [...blocking, ...needsHuman, ...sensitive];
	if (all.length === 0) return [];
	return ['## Human control points', '', ...all, ''];
}

function renderStep(step: WorkflowStep, quote: (id: string | undefined) => string): string[] {
	const flags = [step.diverges ? 'DIVERGES' : '', step.isException ? 'EXCEPTION' : '']
		.filter(Boolean)
		.join(', ');
	const head = `### Step ${step.seq}: ${step.actor} ${flags ? `[${flags}]` : ''}`.trimEnd();
	return [
		head,
		'',
		`- Action: ${step.action}`,
		`- Documented: ${quote(step.documented)}`,
		`- Observed: ${quote(step.observed)}`,
		'',
	];
}

function renderClaim(claim: Claim): string {
	const actor = claim.actor ? `, ${claim.actor}` : '';
	return `- **${claim.claimId}** [${claim.type}]${actor}: "${claim.quote}" (${claim.evidenceId})`;
}

function renderContradiction(c: Contradiction, quote: (id: string) => string): string[] {
	const lines = [`#### ${c.topic} [${c.status}]`, '', `${c.nature}`, ''];
	for (const ref of c.claimRefs) lines.push(`- ${quote(ref)}`);
	lines.push('');
	return lines;
}

function renderQuestion(q: OpenQuestion): string {
	const mark = q.blocking ? ' **[blocking]**' : '';
	return `- ${q.question}${mark}: ${q.whyItMatters}`;
}

function renderFriction(f: FrictionRisk): string {
	const cs = f.complianceSensitive ? ', compliance-sensitive' : '';
	return `- **${f.id}** (${f.kind}, ${f.severity}${cs}) at step ${f.stepRef}: ${f.description}`;
}

function renderResponsibility(e: ResponsibilityEntry): string {
	const why = e.rationale ? `, ${e.rationale.text} (friction ${e.rationale.frictionRef})` : '';
	return `- Step ${e.stepRef}: ${e.current} now, ${e.target} target${why}`;
}

function renderOpportunity(o: Opportunity): string {
	const cs = o.complianceSensitive ? ', compliance-sensitive' : '';
	return `- **${o.id}** (impact ${o.impact}, effort ${o.effort}, ${o.reversibility}${cs}): ${o.description}`;
}

function renderRecommendation(r: Recommendation): string[] {
	return [
		`Try opportunity **${r.opportunityRef}**, scoped to ${r.scope}.`,
		'',
		`- What the agent does (${r.aiRole}, ${r.decisionClass}): ${r.whatAgentDoes}`,
		`- Support: ${r.supportRefs.join(', ')}`,
		`- Stays human: ${r.whatStaysHuman.join('; ')}`,
		`- Boundaries: ${r.boundaries.length > 0 ? r.boundaries.join('; ') : '_none stated_'}`,
		`- Why bounded: ${r.whyBounded}`,
		'',
	];
}
