import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { questionHash } from '../domain/identity.ts';
import { retentionManifest } from '../domain/retention.ts';
import { type AuditStore, auditStore } from '../store/audit.ts';

/**
 * The human side of an audit: founding one, and answering the questions a run
 * escalated.
 *
 * Both exist because the copilot escalates and never decides. An audit is
 * founded deliberately so a mistyped id fails a run instead of quietly starting
 * a second investigation, and an answer arrives as evidence — with an id a run
 * must read before it can cite it — so a human's decision stays as traceable as
 * anything else in the record.
 */

const usage = `Usage:
  npm run audit -- new    --id <auditId> --objective "<text>"
  npm run audit -- answer --id <auditId> --question "<the question, verbatim>" --evidence <evidenceId>
  npm run audit -- show   --id <auditId>
  npm run audit -- retention`;

export type AuditCliDeps = {
	store?: AuditStore;
	log?: (line: string) => void;
};

/** Run one CLI command. The store and the output sink are injected so the commands are testable without a process. */
export function runAuditCli(argv: string[], deps: AuditCliDeps = {}): void {
	const log = deps.log ?? ((line: string) => console.log(line));
	const [command, ...rest] = argv;
	const { values } = parseArgs({
		args: rest,
		options: {
			id: { type: 'string' },
			objective: { type: 'string' },
			question: { type: 'string' },
			evidence: { type: 'string' },
		},
		allowPositionals: false,
	});

	const requireOption = (name: string, value: string | undefined): string => {
		if (value === undefined || value.trim() === '') {
			throw new Error(`--${name} is required.\n\n${usage}`);
		}
		return value;
	};

	const store = deps.store ?? auditStore();

	switch (command) {
		case 'new': {
			const audit = store.createAudit({
				auditId: requireOption('id', values.id),
				objective: requireOption('objective', values.objective),
			});
			log(`Founded audit '${audit.auditId}'.`);
			log(`Run against it with: npx flue run src/agents/fieldguide.ts \\`);
			log(`  --new --id <a fresh run id> --data '{"auditId":"${audit.auditId}"}' \\`);
			log(`  --message "<this run's objective>"`);
			return;
		}

		case 'answer': {
			const auditId = requireOption('id', values.id);
			const question = requireOption('question', values.question);
			// The answer is evidence, so it needs a document the run can read. The id
			// is the human's to supply: on the fixtures path a file in evidence/, on
			// the live path a page in the workspace.
			const evidenceId = requireOption('evidence', values.evidence);
			store.answerQuestion({ auditId, questionHash: questionHash(question), evidenceId });
			log(`Answered on audit '${auditId}', by evidence '${evidenceId}'.`);
			log('The next run will be told to read it; it stays uncitable until one does.');
			return;
		}

		case 'show': {
			const auditId = requireOption('id', values.id);
			const state = store.auditState(auditId);
			const counts = store.counts(auditId);
			log(`${state.audit.auditId} — ${state.audit.objective}`);
			log(
				`${counts.runs} runs, ${counts.documentsRead} documents read, ${counts.claims} claims, ` +
					`${counts.openQuestions} open questions (${counts.answeredQuestions} answered), ` +
					`${counts.contradictions} contradictions.`,
			);
			for (const question of state.questions) {
				const standing =
					question.status === 'answered'
						? `answered by ${question.answeredByEvidenceId}`
						: question.blocking
							? 'BLOCKING'
							: 'open';
				log(`  [${standing}] ${question.question}`);
			}
			return;
		}

		case 'retention': {
			// What this system keeps and why, in one place. The same table that ships
			// with every run's map.
			for (const entry of retentionManifest()) {
				log(`${entry.scope.padEnd(7)} ${entry.key}`);
				log(`        ${entry.reason}`);
			}
			return;
		}

		default:
			throw new Error(usage);
	}
}

// Only act when this module is the process entry point, so importing it for a
// test does not run a command.
if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
	try {
		runAuditCli(process.argv.slice(2));
	} catch (error) {
		console.error((error as Error).message);
		process.exitCode = 1;
	}
}
