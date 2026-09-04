import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEnvelope } from '../domain/envelope.ts';
import { questionHash } from '../domain/identity.ts';
import { OperatingMap } from '../domain/operating-map.ts';
import { auditStore } from '../store/audit.ts';
import { envelopePath } from '../store/persist.ts';
import * as v from 'valibot';
import { gradeResumption } from './resumption.ts';

// Live-model resumption eval: two runs of one audit, with a human answering a
// blocking question between them. It is the only part of the retention design
// that a deterministic test cannot reach, because whether a run *uses* what it
// inherited is behaviour, not structure. Gated like the other behavioural eval.
const enabled = Boolean(process.env.RUN_LIVE_EVALS) && loadFireworksKey();
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MS ?? 300_000);

const OBJECTIVE =
	'Audit how SignalWire receives, reviews, approves, and distributes client press releases. Reconstruct how the work actually happens and produce the full operating map.';
const SECOND_OBJECTIVE =
	'Continue the audit of SignalWire press-release approvals, using what is already known and resolving what is still open.';

/** Read FIREWORKS_API_KEY from .env into the environment; drop NOTION_TOKEN so the agent uses fixtures, not live Notion. */
function loadFireworksKey(): boolean {
	delete process.env.NOTION_TOKEN;
	if (process.env.FIREWORKS_API_KEY) return true;
	const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
	if (!existsSync(envPath)) return false;
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const match = line.match(/^\s*FIREWORKS_API_KEY\s*=\s*"?([^"\n]+)"?/);
		if (match) process.env.FIREWORKS_API_KEY = match[1];
	}
	return Boolean(process.env.FIREWORKS_API_KEY);
}

describe.skipIf(!enabled)('resuming an audit (live model)', () => {
	let flue: Awaited<ReturnType<typeof start>>;
	let Fieldguide: (typeof import('../agents/fieldguide.ts'))['Fieldguide'];

	beforeAll(async () => {
		process.env.FIELDGUIDE_AUDIT_DB = join(
			mkdtempSync(join(tmpdir(), 'fieldguide-resume-')),
			'audit.db',
		);
		({ Fieldguide } = await import('../agents/fieldguide.ts'));
		flue = await start({ agents: [Fieldguide] });
	});

	afterAll(async () => {
		await flue?.stop();
	});

	async function runOnce(auditId: string, runId: string, objective: string) {
		const agent = init(Fieldguide, { id: runId });
		const receipt = await agent.dispatch({ message: objective, initialData: { auditId } });
		await agent.read(receipt, { signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
		const path = envelopePath(auditId, runId);
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, 'utf8')) as RunEnvelope;
	}

	it(
		'uses the answer and the evidence it inherited',
		{ timeout: RUN_TIMEOUT_MS * 2 + 30_000 },
		async () => {
			const store = auditStore();
			const auditId = `resume-audit-${Date.now()}`;
			store.createAudit({ auditId, objective: OBJECTIVE });

			const first = await runOnce(auditId, `${auditId}-run-1`, OBJECTIVE);
			expect(first, 'the first run produced no record').toBeDefined();

			const afterFirst = store.auditState(auditId);
			const blocking = afterFirst.questions.find((q) => q.blocking && q.status === 'open');
			// The first run must escalate something for there to be an answer to carry
			// back; the fixtures plant a verbal-approval exception that should.
			expect(blocking, 'the first run raised no blocking question').toBeDefined();
			const firstRunReads = afterFirst.readSet;

			// A human answers. On the fixtures path an existing document the first run
			// did not open stands in for the answer: what is under test is that the
			// second run is told to read it and does, not where the text came from.
			const { evidenceIds } = await import('../tools/evidence.ts');
			const answerEvidenceId = [...evidenceIds].find((id) => !firstRunReads.includes(id));
			expect(answerEvidenceId, 'the first run read every fixture').toBeDefined();
			store.answerQuestion({
				auditId,
				questionHash: questionHash(blocking?.question ?? ''),
				evidenceId: answerEvidenceId ?? '',
			});

			const second = await runOnce(auditId, `${auditId}-run-2`, SECOND_OBJECTIVE);
			expect(second, 'the second run produced no record').toBeDefined();
			const parsed = v.safeParse(OperatingMap, second?.map);
			expect(parsed.success, 'the second run produced no valid map').toBe(true);

			// Per-run reads, not the audit's set: a document the second run re-read was
			// read by it, not inherited, and the grader must tell those apart.
			const secondRunReads = store.runReads(auditId, `${auditId}-run-2`);

			const results = gradeResumption({
				answeredQuestion: blocking?.question ?? '',
				answerEvidenceId: answerEvidenceId ?? '',
				firstRunReads,
				secondRunReads,
				secondMap: parsed.success ? parsed.output : ({} as never),
			});

			// The rate is the honesty signal, recorded whether it meets the bar or not.
			console.log(
				`Resumption:\n${results.map((r) => `  ${r.pass ? 'pass' : 'FAIL'} ${r.id}: ${r.note}`).join('\n')}`,
			);
			expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
		},
	);
});
