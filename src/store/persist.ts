import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvelope, type RunEnvelope, type RunOutcome } from '../domain/envelope.ts';
import { type AuditStore, auditStore } from './audit.ts';
import { forgetRun } from './run-context.ts';

/**
 * The promotion seam: the one place a run's work crosses from scratch into the
 * record.
 *
 * Two different things happen here, and the difference is the whole retention
 * discipline. Evidence and unresolved questions *accumulate* into the audit,
 * because they stay true after this run ends. The run's conclusions are saved as
 * an immutable snapshot that supersedes without merging, because they are what
 * one run reasoned its way to on the evidence it had — a later run re-derives
 * them rather than inheriting them.
 *
 * Everything crossing has already passed the section guards and, for a complete
 * map, the whole-object and cross-reference checks in `finish_operating_map`.
 */

const auditsDir = fileURLToPath(new URL('../../data/audits/', import.meta.url));

export type PersistDeps = {
	store?: AuditStore;
	/** Where run artifacts are written. One file per run, under the audit that owns it. */
	dir?: string;
	now?: () => string;
};

/** Where a run's envelope is written: one file per run, so no run's record overwrites another's. */
export function envelopePath(auditId: string, runId: string, dir: string = auditsDir): string {
	return join(dir, auditId, `${runId}.json`);
}

/**
 * Accumulate the run's evidence and questions into the audit, save its
 * conclusions as history, and write the envelope for a reviewer to open.
 * Returns the path written.
 */
export function persistRun(outcome: RunOutcome, deps: PersistDeps = {}): string {
	const store = deps.store ?? auditStore();
	const now = deps.now ?? (() => new Date().toISOString());
	const audit = store.requireAudit(outcome.auditId);

	// A partial map's sections passed the same per-section validation a complete
	// map's did, so an incomplete run accumulates exactly as a complete one does:
	// running out of turns does not make a claim less true, and the questions a
	// capped run raised are the best signal of what the next run should spend its
	// budget on.
	const recorded = outcome.map ?? outcome.draft ?? {};
	store.accumulate({
		auditId: outcome.auditId,
		runId: outcome.runId,
		claims: recorded.claims,
		questions: recorded.openQuestions,
		contradictions: recorded.contradictions,
	});

	const envelope = buildEnvelope(outcome, audit.objective, now());
	store.saveSnapshot({
		auditId: outcome.auditId,
		runId: outcome.runId,
		envelope,
		incomplete: outcome.incomplete,
	});

	const path = envelopePath(outcome.auditId, outcome.runId, deps.dir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(envelope, null, 2));

	// The run is over; its cached knowledge is derived data and the store holds
	// the record.
	forgetRun(outcome.runId);
	return path;
}

export type { RunEnvelope, RunOutcome };
