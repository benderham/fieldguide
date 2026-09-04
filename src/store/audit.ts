import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { claimHash, contradictionHash, questionHash } from '../domain/identity.ts';
import type { Claim, Contradiction, OpenQuestion } from '../domain/operating-map.ts';
import { requireRetention, SEEDED_CLAIM_CAP } from '../domain/retention.ts';

/**
 * The application store: the audit's memory, kept apart from Flue's conversation
 * record on purpose.
 *
 * Flue owns the run — one instance, one transcript, one set of budgets, all of it
 * discarded when the run ends. This store owns the audit: the investigation that
 * outlives any single run. Only two kinds of thing accumulate here, evidence and
 * unresolved questions, because only those stay true after the run that found
 * them. A run's conclusions are kept as history and never fed back, so a resumed
 * audit re-derives its findings from evidence rather than inheriting a story.
 *
 * Every write path resolves its retention entry first, so nothing lands here
 * without a recorded reason.
 */

const defaultPath = fileURLToPath(new URL('../../data/audit.db', import.meta.url));

export type AuditRecord = {
	auditId: string;
	/** The objective the audit was founded on. Each run also stamps its own; drift between them is recorded, never enforced. */
	objective: string;
	createdAt: string;
};

export type RunStanding = 'running' | 'complete' | 'incomplete';

/** A claim as the audit holds it: content-addressed, with the runs that independently found it. */
export type StoredClaim = {
	claimHash: string;
	type: Claim['type'];
	quote: string;
	evidenceId: string;
	actor?: string;
	/** Every run that recorded this same span, with the run-local id it used. More than one is corroboration. */
	sightings: Array<{ runId: string; claimId: string }>;
};

export type StoredQuestion = {
	questionHash: string;
	question: string;
	whyItMatters: string;
	blocking: boolean;
	status: 'open' | 'answered';
	/** The evidence a human's answer arrived as. An answer is evidence like any other, citable only once a run has read it. */
	answeredByEvidenceId?: string;
};

export type StoredContradiction = {
	contradictionHash: string;
	topic: string;
	nature: string;
	status: Contradiction['status'];
	claimHashes: string[];
};

/** Everything a fresh run is seeded with. Canonical records only: no prior prose, no prior conclusions. */
export type AuditState = {
	audit: AuditRecord;
	readSet: string[];
	claims: StoredClaim[];
	questions: StoredQuestion[];
	contradictions: StoredContradiction[];
};

export type AccumulationSummary = {
	claims: number;
	questions: number;
	contradictions: number;
	/** Contradictions dropped because fewer than two of their refs resolved to recorded claims, which an incomplete run can produce. */
	unresolvedContradictions: number;
};

export type AuditCounts = {
	runs: number;
	/** Distinct documents this audit has opened. */
	documentsRead: number;
	/** Reads spent across every run, including re-reads by a later run. */
	readsSpent: number;
	turnsSpent: number;
	claims: number;
	openQuestions: number;
	answeredQuestions: number;
	contradictions: number;
};

const schema = `
CREATE TABLE IF NOT EXISTS audits (
	auditId TEXT PRIMARY KEY,
	objective TEXT NOT NULL,
	createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
	runId TEXT PRIMARY KEY,
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	objective TEXT NOT NULL,
	startedAt TEXT NOT NULL,
	finishedAt TEXT,
	standing TEXT NOT NULL DEFAULT 'running',
	readsUsed INTEGER,
	turnsUsed INTEGER
);
CREATE TABLE IF NOT EXISTS reads (
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	evidenceId TEXT NOT NULL,
	runId TEXT NOT NULL REFERENCES runs(runId),
	readAt TEXT NOT NULL,
	PRIMARY KEY (auditId, evidenceId, runId)
);
CREATE TABLE IF NOT EXISTS claims (
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	claimHash TEXT NOT NULL,
	type TEXT NOT NULL,
	quote TEXT NOT NULL,
	evidenceId TEXT NOT NULL,
	actor TEXT,
	firstSeenAt TEXT NOT NULL,
	PRIMARY KEY (auditId, claimHash)
);
CREATE TABLE IF NOT EXISTS claim_sightings (
	auditId TEXT NOT NULL,
	claimHash TEXT NOT NULL,
	runId TEXT NOT NULL REFERENCES runs(runId),
	claimId TEXT NOT NULL,
	PRIMARY KEY (auditId, claimHash, runId)
);
CREATE TABLE IF NOT EXISTS open_questions (
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	questionHash TEXT NOT NULL,
	question TEXT NOT NULL,
	whyItMatters TEXT NOT NULL,
	blocking INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'open',
	answeredByEvidenceId TEXT,
	answeredAt TEXT,
	firstSeenAt TEXT NOT NULL,
	PRIMARY KEY (auditId, questionHash)
);
CREATE TABLE IF NOT EXISTS question_sightings (
	auditId TEXT NOT NULL,
	questionHash TEXT NOT NULL,
	runId TEXT NOT NULL REFERENCES runs(runId),
	refsJson TEXT NOT NULL,
	PRIMARY KEY (auditId, questionHash, runId)
);
CREATE TABLE IF NOT EXISTS contradictions (
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	contradictionHash TEXT NOT NULL,
	topic TEXT NOT NULL,
	nature TEXT NOT NULL,
	status TEXT NOT NULL,
	claimHashesJson TEXT NOT NULL,
	firstSeenAt TEXT NOT NULL,
	PRIMARY KEY (auditId, contradictionHash)
);
CREATE TABLE IF NOT EXISTS contradiction_sightings (
	auditId TEXT NOT NULL,
	contradictionHash TEXT NOT NULL,
	runId TEXT NOT NULL REFERENCES runs(runId),
	PRIMARY KEY (auditId, contradictionHash, runId)
);
CREATE TABLE IF NOT EXISTS snapshots (
	auditId TEXT NOT NULL REFERENCES audits(auditId),
	runId TEXT NOT NULL REFERENCES runs(runId),
	incomplete INTEGER NOT NULL,
	envelopeJson TEXT NOT NULL,
	savedAt TEXT NOT NULL,
	PRIMARY KEY (auditId, runId)
);
`;

export type AuditStoreOptions = {
	/** Where the database lives. `:memory:` gives a throwaway store, which is what the tests use. */
	path?: string;
	/** Injected so tests can pin timestamps. */
	now?: () => string;
};

/**
 * Open (creating if needed) the audit store. Foreign keys are on, so a read or a
 * claim can only be written against an audit and run that exist: a typo in an
 * audit id fails loudly rather than founding a silent second audit.
 */
export function openAuditStore(options: AuditStoreOptions = {}) {
	const path = options.path ?? defaultPath;
	const now = options.now ?? (() => new Date().toISOString());
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

	const db = new DatabaseSync(path);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(schema);

	const transaction = <T>(work: () => T): T => {
		db.exec('BEGIN');
		try {
			const result = work();
			db.exec('COMMIT');
			return result;
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	};

	/**
	 * Found an audit. Explicit rather than lazy: a run whose audit id does not
	 * resolve is rejected at the intake seam, so a mistyped id cannot quietly start
	 * a second audit that inherits nothing while looking perfectly healthy.
	 */
	function createAudit(input: { auditId: string; objective: string }): AuditRecord {
		if (getAudit(input.auditId) !== undefined) {
			throw new Error(`Audit '${input.auditId}' already exists.`);
		}
		const record: AuditRecord = {
			auditId: input.auditId,
			objective: input.objective,
			createdAt: now(),
		};
		db.prepare('INSERT INTO audits (auditId, objective, createdAt) VALUES (?, ?, ?)').run(
			record.auditId,
			record.objective,
			record.createdAt,
		);
		return record;
	}

	function getAudit(auditId: string): AuditRecord | undefined {
		const row = db
			.prepare('SELECT auditId, objective, createdAt FROM audits WHERE auditId = ?')
			.get(auditId) as AuditRecord | undefined;
		return row;
	}

	/** Resolve an audit or throw. The guard a run's intake seam uses, where a throw fails the submission before any model turn. */
	function requireAudit(auditId: string): AuditRecord {
		const audit = getAudit(auditId);
		if (audit === undefined) {
			throw new Error(
				`Unknown audit '${auditId}'. Found an audit before running against it; a run never creates one.`,
			);
		}
		return audit;
	}

	/**
	 * Open a run against an audit, stamping the objective this run was given.
	 *
	 * Idempotent: the intake seam fires once per delivered message, so a second
	 * message to a live run calls this again. The first objective stands, because
	 * the objective a run is judged against is the one it started on.
	 */
	function beginRun(input: { auditId: string; runId: string; objective: string }): void {
		requireAudit(input.auditId);
		db.prepare(
			'INSERT OR IGNORE INTO runs (runId, auditId, objective, startedAt, standing) VALUES (?, ?, ?, ?, ?)',
		).run(input.runId, input.auditId, input.objective, now(), 'running');
	}

	/**
	 * Record that a run opened a document. Reads write through as they happen
	 * rather than waiting for the finish seam: a read is an event that occurred,
	 * not a judgement awaiting validation, so a run that crashes still leaves the
	 * audit knowing what was looked at.
	 */
	function recordRead(input: { auditId: string; runId: string; evidenceId: string }): void {
		requireRetention('readSet');
		db.prepare(
			'INSERT OR IGNORE INTO reads (auditId, evidenceId, runId, readAt) VALUES (?, ?, ?, ?)',
		).run(input.auditId, input.evidenceId, input.runId, now());
	}

	/** Every document one run opened, including re-reads of what an earlier run had already seen. */
	function runReads(auditId: string, runId: string): string[] {
		const rows = db
			.prepare(
				'SELECT evidenceId FROM reads WHERE auditId = ? AND runId = ? ORDER BY readAt, rowid',
			)
			.all(auditId, runId) as Array<{ evidenceId: string }>;
		return rows.map((row) => row.evidenceId);
	}

	/** Every document this audit has opened, in any run. What makes an inherited citation checkable. */
	function readSet(auditId: string): string[] {
		const rows = db
			.prepare('SELECT DISTINCT evidenceId FROM reads WHERE auditId = ? ORDER BY evidenceId')
			.all(auditId) as Array<{ evidenceId: string }>;
		return rows.map((row) => row.evidenceId);
	}

	/**
	 * Promote a run's evidence and unresolved questions into the audit. This is the
	 * one seam scratch crosses into the record, and everything crossing it has
	 * already passed the section guards.
	 *
	 * Identity is content-addressed, so a re-recorded claim corroborates rather
	 * than duplicates, and the first version of a record is never overwritten by a
	 * later sighting: canonical data accumulates, it does not mutate.
	 */
	function accumulate(input: {
		auditId: string;
		runId: string;
		claims?: Claim[];
		questions?: OpenQuestion[];
		contradictions?: Contradiction[];
	}): AccumulationSummary {
		requireRetention('claims');
		requireRetention('openQuestions');
		requireRetention('contradictions');
		requireAudit(input.auditId);

		const claims = input.claims ?? [];
		const questions = input.questions ?? [];
		const contradictions = input.contradictions ?? [];
		const timestamp = now();

		return transaction(() => {
			// Run-local claim id to audit-stable hash, used to translate the refs a
			// contradiction carries into identities that outlive this run.
			const hashByClaimId = new Map<string, string>();

			const insertClaim = db.prepare(
				'INSERT OR IGNORE INTO claims (auditId, claimHash, type, quote, evidenceId, actor, firstSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
			);
			const insertClaimSighting = db.prepare(
				'INSERT OR IGNORE INTO claim_sightings (auditId, claimHash, runId, claimId) VALUES (?, ?, ?, ?)',
			);
			for (const claim of claims) {
				const hash = claimHash(claim);
				hashByClaimId.set(claim.claimId, hash);
				insertClaim.run(
					input.auditId,
					hash,
					claim.type,
					claim.quote,
					claim.evidenceId,
					claim.actor ?? null,
					timestamp,
				);
				insertClaimSighting.run(input.auditId, hash, input.runId, claim.claimId);
			}

			const insertQuestion = db.prepare(
				'INSERT OR IGNORE INTO open_questions (auditId, questionHash, question, whyItMatters, blocking, status, firstSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
			);
			const insertQuestionSighting = db.prepare(
				'INSERT OR IGNORE INTO question_sightings (auditId, questionHash, runId, refsJson) VALUES (?, ?, ?, ?)',
			);
			for (const question of questions) {
				const hash = questionHash(question.question);
				insertQuestion.run(
					input.auditId,
					hash,
					question.question,
					question.whyItMatters,
					question.blocking ? 1 : 0,
					'open',
					timestamp,
				);
				insertQuestionSighting.run(input.auditId, hash, input.runId, JSON.stringify(question.refs));
			}

			const insertContradiction = db.prepare(
				'INSERT OR IGNORE INTO contradictions (auditId, contradictionHash, topic, nature, status, claimHashesJson, firstSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
			);
			const insertContradictionSighting = db.prepare(
				'INSERT OR IGNORE INTO contradiction_sightings (auditId, contradictionHash, runId) VALUES (?, ?, ?)',
			);
			let unresolvedContradictions = 0;
			for (const contradiction of contradictions) {
				const hashes = contradiction.claimRefs
					.map((ref) => hashByClaimId.get(ref))
					.filter((hash): hash is string => hash !== undefined);
				// A contradiction is identified by the claims it holds in conflict, so
				// one whose refs do not resolve to recorded claims has no identity to
				// store under. An incomplete run can produce this; it is dropped and
				// counted rather than stored under a guess.
				if (hashes.length < 2) {
					unresolvedContradictions += 1;
					continue;
				}
				const hash = contradictionHash(hashes);
				insertContradiction.run(
					input.auditId,
					hash,
					contradiction.topic,
					contradiction.nature,
					contradiction.status,
					JSON.stringify([...hashes].sort()),
					timestamp,
				);
				insertContradictionSighting.run(input.auditId, hash, input.runId);
			}

			return {
				claims: claims.length,
				questions: questions.length,
				contradictions: contradictions.length - unresolvedContradictions,
				unresolvedContradictions,
			};
		});
	}

	/**
	 * Mark a question answered by the evidence a human's answer arrived as. Question
	 * status is the store's to set, never the model's: the copilot escalates, a
	 * human decides, and the decision comes back as evidence that a later run must
	 * read before it can cite it.
	 */
	function answerQuestion(input: {
		auditId: string;
		questionHash: string;
		evidenceId: string;
	}): void {
		const result = db
			.prepare(
				"UPDATE open_questions SET status = 'answered', answeredByEvidenceId = ?, answeredAt = ? WHERE auditId = ? AND questionHash = ?",
			)
			.run(input.evidenceId, now(), input.auditId, input.questionHash);
		if (result.changes === 0) {
			throw new Error(`No open question '${input.questionHash}' on audit '${input.auditId}'.`);
		}
	}

	/**
	 * Save a run's conclusions as history. Immutable and never seeded back into a
	 * later run: conclusions are what a run reasoned its way to on the evidence it
	 * had, and a resumed audit re-derives them rather than treating them as
	 * established.
	 */
	function saveSnapshot(input: {
		auditId: string;
		runId: string;
		envelope: unknown;
		incomplete: boolean;
		readsUsed?: number;
		turnsUsed?: number;
	}): void {
		requireRetention('snapshots');
		transaction(() => {
			db.prepare(
				'INSERT OR REPLACE INTO snapshots (auditId, runId, incomplete, envelopeJson, savedAt) VALUES (?, ?, ?, ?, ?)',
			).run(
				input.auditId,
				input.runId,
				input.incomplete ? 1 : 0,
				JSON.stringify(input.envelope),
				now(),
			);
			db.prepare(
				'UPDATE runs SET standing = ?, finishedAt = ?, readsUsed = ?, turnsUsed = ? WHERE runId = ?',
			).run(
				input.incomplete ? 'incomplete' : 'complete',
				now(),
				input.readsUsed ?? null,
				input.turnsUsed ?? null,
				input.runId,
			);
		});
	}

	/** The most recent snapshot, complete ones preferred: an incomplete run never displaces a finished map as the audit's current view. */
	function currentSnapshot(
		auditId: string,
	): { runId: string; incomplete: boolean; envelope: unknown } | undefined {
		const row = db
			.prepare(
				'SELECT runId, incomplete, envelopeJson FROM snapshots WHERE auditId = ? ORDER BY incomplete ASC, savedAt DESC LIMIT 1',
			)
			.get(auditId) as { runId: string; incomplete: number; envelopeJson: string } | undefined;
		if (row === undefined) return undefined;
		return {
			runId: row.runId,
			incomplete: row.incomplete === 1,
			envelope: JSON.parse(row.envelopeJson),
		};
	}

	/**
	 * The canonical state a fresh run is seeded with. Evidence and unresolved
	 * questions only; no conclusions, and nothing derived from a prior run's prose.
	 *
	 * The register is seeded whole or not at all. Past the cap a partial seed would
	 * leave the model reasoning over an incomplete register while believing it had
	 * the audit, so this refuses instead of truncating.
	 */
	function auditState(auditId: string): AuditState {
		const audit = requireAudit(auditId);
		const cap = requireRetention('claims').cap ?? SEEDED_CLAIM_CAP;

		const claimRows = db
			.prepare(
				'SELECT claimHash, type, quote, evidenceId, actor FROM claims WHERE auditId = ? ORDER BY firstSeenAt, rowid',
			)
			.all(auditId) as Array<{
			claimHash: string;
			type: Claim['type'];
			quote: string;
			evidenceId: string;
			actor: string | null;
		}>;
		if (claimRows.length > cap) {
			throw new Error(
				`Audit '${auditId}' holds ${claimRows.length} claims, past the seeding cap of ${cap}. A run seeds the register whole or not at all; split the audit or add retrieval over the register.`,
			);
		}

		const sightingRows = db
			.prepare(
				'SELECT claimHash, runId, claimId FROM claim_sightings WHERE auditId = ? ORDER BY runId',
			)
			.all(auditId) as Array<{ claimHash: string; runId: string; claimId: string }>;
		const sightings = new Map<string, Array<{ runId: string; claimId: string }>>();
		for (const row of sightingRows) {
			const list = sightings.get(row.claimHash) ?? [];
			list.push({ runId: row.runId, claimId: row.claimId });
			sightings.set(row.claimHash, list);
		}

		const claims: StoredClaim[] = claimRows.map((row) => ({
			claimHash: row.claimHash,
			type: row.type,
			quote: row.quote,
			evidenceId: row.evidenceId,
			...(row.actor === null ? {} : { actor: row.actor }),
			sightings: sightings.get(row.claimHash) ?? [],
		}));

		const questionRows = db
			.prepare(
				'SELECT questionHash, question, whyItMatters, blocking, status, answeredByEvidenceId FROM open_questions WHERE auditId = ? ORDER BY blocking DESC, rowid',
			)
			.all(auditId) as Array<{
			questionHash: string;
			question: string;
			whyItMatters: string;
			blocking: number;
			status: 'open' | 'answered';
			answeredByEvidenceId: string | null;
		}>;
		const questions: StoredQuestion[] = questionRows.map((row) => ({
			questionHash: row.questionHash,
			question: row.question,
			whyItMatters: row.whyItMatters,
			blocking: row.blocking === 1,
			status: row.status,
			...(row.answeredByEvidenceId === null
				? {}
				: { answeredByEvidenceId: row.answeredByEvidenceId }),
		}));

		const contradictionRows = db
			.prepare(
				'SELECT contradictionHash, topic, nature, status, claimHashesJson FROM contradictions WHERE auditId = ? ORDER BY rowid',
			)
			.all(auditId) as Array<{
			contradictionHash: string;
			topic: string;
			nature: string;
			status: Contradiction['status'];
			claimHashesJson: string;
		}>;
		const contradictions: StoredContradiction[] = contradictionRows.map((row) => ({
			contradictionHash: row.contradictionHash,
			topic: row.topic,
			nature: row.nature,
			status: row.status,
			claimHashes: JSON.parse(row.claimHashesJson) as string[],
		}));

		return { audit, readSet: readSet(auditId), claims, questions, contradictions };
	}

	/**
	 * What the audit has spent and holds. No audit-level budget is enforced — a
	 * human starts each run, which is a stronger bound than a number — but the
	 * counts are recorded so that decision can later be revisited on evidence.
	 */
	function counts(auditId: string): AuditCounts {
		const one = <T>(sql: string) => db.prepare(sql).get(auditId) as T;
		const runs = one<{ n: number; reads: number | null; turns: number | null }>(
			'SELECT COUNT(*) AS n, SUM(readsUsed) AS reads, SUM(turnsUsed) AS turns FROM runs WHERE auditId = ?',
		);
		const reads = one<{ documents: number; total: number }>(
			'SELECT COUNT(DISTINCT evidenceId) AS documents, COUNT(*) AS total FROM reads WHERE auditId = ?',
		);
		const claims = one<{ n: number }>('SELECT COUNT(*) AS n FROM claims WHERE auditId = ?');
		const questions = one<{ open: number; answered: number }>(
			"SELECT SUM(status = 'open') AS open, SUM(status = 'answered') AS answered FROM open_questions WHERE auditId = ?",
		);
		const contradictions = one<{ n: number }>(
			'SELECT COUNT(*) AS n FROM contradictions WHERE auditId = ?',
		);
		return {
			runs: runs.n,
			documentsRead: reads.documents,
			readsSpent: reads.total,
			turnsSpent: runs.turns ?? 0,
			claims: claims.n,
			openQuestions: questions.open ?? 0,
			answeredQuestions: questions.answered ?? 0,
			contradictions: contradictions.n,
		};
	}

	function close(): void {
		db.close();
	}

	return {
		createAudit,
		getAudit,
		requireAudit,
		beginRun,
		recordRead,
		readSet,
		runReads,
		accumulate,
		answerQuestion,
		saveSnapshot,
		currentSnapshot,
		auditState,
		counts,
		close,
	};
}

export type AuditStore = ReturnType<typeof openAuditStore>;

let shared: AuditStore | undefined;

/**
 * The process-wide store handle, opened on first use. Agent code reaches the
 * store through this, never by opening its own: the handle is only ever taken
 * from an async seam (a tool, or the intake callback), because a render must not
 * do I/O.
 *
 * `FIELDGUIDE_AUDIT_DB` points it elsewhere, which is how a test or an eval runs
 * against a throwaway database instead of the project's.
 */
export function auditStore(): AuditStore {
	if (shared === undefined) {
		shared = openAuditStore({ path: process.env.FIELDGUIDE_AUDIT_DB ?? defaultPath });
	}
	return shared;
}

/** Drop the shared handle, so the next caller opens the database named by the environment. Tests use this; nothing else should. */
export function resetAuditStore(): void {
	shared?.close();
	shared = undefined;
}
