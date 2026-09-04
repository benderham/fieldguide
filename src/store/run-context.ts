import { type AuditStore, auditStore } from './audit.ts';

/**
 * A run's working knowledge of its audit: which documents it may cite.
 *
 * This is a cache in process memory, deliberately not durable state. Two facts
 * force it there. A render cannot read the store — renders are pure synchronous
 * reads — and a durable write made at the intake seam is not visible until the
 * next render, which happens *after* the first model turn, so a mirror written
 * at intake would be empty exactly when the first turn's tools run.
 *
 * The store is synchronous, so a tool reads it directly and the citation guards
 * stay pure functions over data. Nothing is retained here: the audit read set in
 * the store is the record, and this is rebuilt from it whenever it is missing —
 * after a restart, or in a new process resuming the same run.
 */

export type RunKnowledge = {
	auditId: string;
	/** Every document this audit has opened, in this run or an earlier one. What makes a citation checkable. */
	knownIds: Set<string>;
};

const runs = new Map<string, RunKnowledge>();

/**
 * The run's knowledge, loaded from the store on first use. Call only from a tool
 * or an intake callback: it touches the database, which a render must not do.
 */
export function runKnowledge(runId: string, auditId: string, store?: AuditStore): RunKnowledge {
	const existing = runs.get(runId);
	if (existing !== undefined && existing.auditId === auditId) return existing;
	const knowledge: RunKnowledge = {
		auditId,
		knownIds: new Set((store ?? auditStore()).readSet(auditId)),
	};
	runs.set(runId, knowledge);
	return knowledge;
}

/** Note a document this run just opened, so a claim recorded later in the same run can cite it. */
export function noteRead(
	runId: string,
	auditId: string,
	evidenceId: string,
	store?: AuditStore,
): void {
	runKnowledge(runId, auditId, store).knownIds.add(evidenceId);
}

/** Drop a finished run's cache. Only frees memory; the record is in the store. */
export function forgetRun(runId: string): void {
	runs.delete(runId);
}
