import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperatingMap } from '../domain/operating-map.ts';
import { auditStore } from '../store/audit.ts';
import * as v from 'valibot';

// Live-model behavioural eval. It drives the real Fieldguide agent against the
// fixtures and grades the produced map against the seven gold cases, k-of-n.
// Gated: it spends model tokens, so it runs only when RUN_LIVE_EVALS is set and
// a Fireworks key is available. The deterministic grader in gold-cases.test.ts
// covers the scoring logic without a model.
const enabled = Boolean(process.env.RUN_LIVE_EVALS) && loadFireworksKey();
const RUNS = Number(process.env.EVAL_RUNS ?? 5);
const TARGET = Number(process.env.EVAL_TARGET ?? 3);
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MS ?? 300_000);

const mapPath = fileURLToPath(new URL('../../data/last-operating-map.json', import.meta.url));
const OBJECTIVE =
	'Audit how SignalWire receives, reviews, approves, and distributes client press releases. Reconstruct how the work actually happens and produce the full operating map.';

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

describe.skipIf(!enabled)('behavioural gold cases (live model)', () => {
	let flue: Awaited<ReturnType<typeof start>>;
	let Fieldguide: (typeof import('../agents/fieldguide.ts'))['Fieldguide'];
	let knownIds: Set<string>;

	beforeAll(async () => {
		// Each eval run is a run of its own audit, against a throwaway store: the
		// agent resolves its audit before the first model turn, so one has to exist.
		process.env.FIELDGUIDE_AUDIT_DB = join(
			mkdtempSync(join(tmpdir(), 'fieldguide-eval-')),
			'audit.db',
		);
		({ Fieldguide } = await import('../agents/fieldguide.ts'));
		const { evidenceIds } = await import('../tools/evidence.ts');
		knownIds = evidenceIds;
		flue = await start({ agents: [Fieldguide] });
	});

	afterAll(async () => {
		await flue?.stop();
	});

	it(
		`passes all gold cases in at least ${TARGET} of ${RUNS} runs`,
		{ timeout: RUN_TIMEOUT_MS * RUNS + 30_000 },
		async () => {
			const { gradeGoldCases, allPassed } = await import('./gold-cases.ts');
			let clean = 0;
			const summary: string[] = [];

			for (let run = 0; run < RUNS; run++) {
				if (existsSync(mapPath)) rmSync(mapPath);
				let produced: v.InferOutput<typeof OperatingMap> | undefined;
				try {
					const auditId = `eval-audit-${Date.now()}-${run}`;
					auditStore().createAudit({ auditId, objective: OBJECTIVE });
					const agent = init(Fieldguide, { id: `eval-run-${Date.now()}-${run}` });
					const receipt = await agent.dispatch({ message: OBJECTIVE, initialData: { auditId } });
					await agent.read(receipt, { signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
					if (existsSync(mapPath)) {
						const parsed = v.safeParse(OperatingMap, JSON.parse(readFileSync(mapPath, 'utf8')));
						if (parsed.success) produced = parsed.output;
					}
				} catch (error) {
					summary.push(`run ${run}: errored (${(error as Error).message})`);
					continue;
				}

				if (produced === undefined) {
					summary.push(`run ${run}: no valid map produced`);
					continue;
				}
				const results = gradeGoldCases(produced, knownIds);
				const failed = results.filter((r) => !r.pass);
				if (allPassed(results)) {
					clean++;
					summary.push(`run ${run}: all ${results.length} gold cases passed`);
				} else {
					summary.push(`run ${run}: failed ${failed.map((f) => f.id).join(', ')}`);
				}
			}

			// The rate is the deliverable's honesty signal, recorded whether it meets the bar or not.
			console.log(`Behavioural pass rate: ${clean}/${RUNS}\n${summary.join('\n')}`);
			expect(clean).toBeGreaterThanOrEqual(TARGET);
		},
	);
});
