/**
 * The retention registry: one table naming everything this system keeps past the
 * moment it was computed, and why it is kept.
 *
 * Two mechanisms retain data — Flue's durable instance state and the audit store
 * — and both resolve their entry here before writing, so a persisted item with no
 * recorded reason fails at first use instead of slipping through review. A policy
 * that lives only in prose is a docs hope, the documentation analogue of the
 * prompt hopes the boundary guards replaced.
 *
 * The manifest shipped with every run is this table, rendered.
 */

/**
 * How long a retained item lives, and what a later run may do with it.
 *
 * - `run` — discarded when the run ends. Reasoning in flight: budgets, the
 *   in-progress draft, caches rebuilt from canonical state.
 * - `audit` — accumulates as canonical audit state. A later run may rest findings
 *   on it. Only evidence and unresolved questions belong here.
 * - `history` — retained past the run but never an input. Kept so a reader can
 *   reconstruct what happened; a run never reads it back, which is what stops a
 *   previous run's reasoning becoming this run's premise.
 */
export type RetentionScope = 'run' | 'audit' | 'history';

/** The most claims a run will seed from the audit register before refusing to start. */
export const SEEDED_CLAIM_CAP = 200;

export type RetentionEntry = {
	key: RetentionKey;
	scope: RetentionScope;
	reason: string;
	/** A ceiling past which the retained set can no longer be used as designed. Enforced by the code that reads it, not by this table. */
	cap?: number;
};

const entries = [
	{
		key: 'stepsUsed',
		scope: 'run',
		reason:
			'Reads spent by this run, against the read budget. The budget bounds one run (ADR-0002) and a run is a fresh instance, so carrying the count forward would silently shorten every later run of the same audit.',
	},
	{
		key: 'turnsUsed',
		scope: 'run',
		reason:
			'Tool-calling turns spent by this run, against the turn cap (ADR-0008). Run-scoped for the same reason as the read budget: a resumed audit gets a whole run, not the remainder of an earlier one.',
	},
	{
		key: 'operatingMap',
		scope: 'run',
		reason:
			'The in-progress draft. Scratch until a finish tool validates it and promotes what accumulates; an unpromoted draft is reasoning in flight, and persisting it as audit state would make an abandoned line of thought look like a finding.',
	},
	{
		key: 'readSet',
		scope: 'audit',
		reason:
			'Which documents this audit has opened, with the run and time of each read. Retained because it is provenance: a citation is only checkable against the set of documents actually read, and a saved map whose read set was discarded can never be re-verified (ADR-0005).',
	},
	{
		key: 'claims',
		scope: 'audit',
		reason:
			'The evidence register. A claim is a verbatim span of a document that was read; it stays true after the run that found it ends, so it accumulates rather than being re-derived. Content-addressed, so a later run re-quoting the same span corroborates the claim instead of duplicating it.',
		cap: SEEDED_CLAIM_CAP,
	},
	{
		key: 'openQuestions',
		scope: 'audit',
		reason:
			'Questions a human must answer. Retained because escalation is only real if the question outlives the run that raised it and can come back answered; a question that dies with its run is a field in a JSON file, not an escalation.',
	},
	{
		key: 'contradictions',
		scope: 'audit',
		reason:
			'Conflicting accounts found in the evidence. Unresolved-shaped like an open question, and retained for the same reason: the copilot never adjudicates one (ADR-0007), so it persists until a human does.',
	},
	{
		key: 'snapshots',
		scope: 'history',
		reason:
			"One run's conclusions — steps, frictions, responsibility, opportunities, recommendation, expected value — kept immutably. A later run re-derives its conclusions from the evidence rather than inheriting them, so a snapshot is superseded, never merged and never seeded back into context.",
	},
	{
		key: 'transcript',
		scope: 'history',
		reason:
			"Flue's conversation record in data/flue.db: every model turn, tool call and reasoning delta, retained indefinitely and append-only (the framework offers no pruning). Non-canonical and never read back into a run — a bad map is only debuggable from the reasoning that produced it, which is worth keeping and worth never trusting. On real client evidence this would need a deletion policy the framework cannot currently provide.",
	},
] as const satisfies ReadonlyArray<{
	key: string;
	scope: RetentionScope;
	reason: string;
	cap?: number;
}>;

/** The name of a retained item. Adding a durable write means adding a key here first. */
export type RetentionKey = (typeof entries)[number]['key'];

const byKey = new Map<string, RetentionEntry>(entries.map((entry) => [entry.key, entry]));

/**
 * Resolve a retained item's entry, throwing when it has none. Every durable write
 * path calls this before writing, so a new persisted item cannot reach production
 * without a recorded reason: the failure is at first use, not at review time.
 */
export function requireRetention(key: string): RetentionEntry {
	const entry = byKey.get(key);
	if (entry === undefined) {
		throw new Error(
			`Nothing may be retained without a reason: '${key}' has no entry in the retention registry (src/domain/retention.ts).`,
		);
	}
	return entry;
}

/** The registry as a list, in declaration order: run-scoped first, then audit, then history. */
export function retentionManifest(): RetentionEntry[] {
	return entries.map((entry) => ({ ...entry }));
}
