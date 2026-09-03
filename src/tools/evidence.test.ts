import { describe, expect, it } from 'vitest';
import type { OperatingMap, OperatingMapDraft } from '../domain/operating-map.ts';
import {
	createOperatingMapTools,
	evidence,
	type IncompleteOperatingMap,
	listEvidence,
} from './evidence.ts';

// The tools only read `data`; the rest of the run() context is not exercised here.
const ctx = <T>(data: T) => ({ data }) as never;

/** A live in-memory stand-in for the agent's persistent draft, so tool writes accumulate across calls. */
function harness(
	isKnownId: (id: string) => boolean = () => true,
	provenance: 'fixture' | 'live' = 'fixture',
) {
	let state: OperatingMapDraft = {};
	let saved: OperatingMap | undefined;
	let savedIncomplete: IncompleteOperatingMap | undefined;
	let turns = 0;
	const tools = createOperatingMapTools({
		isKnownId,
		getState: () => state,
		patch: (partial) => {
			state = { ...state, ...partial };
		},
		save: (map) => {
			saved = map;
		},
		saveIncomplete: (map) => {
			savedIncomplete = map;
		},
		provenance,
		spendTurn: () => {
			turns += 1;
		},
	});
	return {
		tools,
		getState: () => state,
		getSaved: () => saved,
		getSavedIncomplete: () => savedIncomplete,
		getTurns: () => turns,
	};
}

/** Record every section of a complete, self-consistent map through the tools. */
async function recordFullMap(tools: ReturnType<typeof harness>['tools']) {
	await tools.recordClaims.run(
		ctx({
			claims: [
				{
					claimId: 'c1',
					type: 'documented-policy',
					quote: 'MUST receive written compliance sign-off before distribution',
					evidenceId: 'procedure-approvals',
				},
				{
					claimId: 'c2',
					type: 'observed-practice',
					quote: 'the written sign-off step is more of a formality',
					evidenceId: 'interview-editor',
				},
			],
		}),
	);
	await tools.recordWorkflow.run(
		ctx({
			objective: 'Audit approvals',
			steps: [
				{
					seq: 1,
					actor: 'Duty editor',
					action: 'approves',
					documented: 'c1',
					observed: 'c2',
					diverges: true,
					claimRefs: ['c1', 'c2'],
					isException: false,
				},
			],
		}),
	);
	await tools.recordContradictions.run(
		ctx({
			contradictions: [
				{
					topic: 'sign-off',
					claimRefs: ['c1', 'c2'],
					nature: 'policy vs practice',
					status: 'needs-human',
				},
			],
		}),
	);
	await tools.recordOpenQuestions.run(
		ctx({
			openQuestions: [
				{
					question: 'How often verbal?',
					whyItMatters: 'control or formality',
					refs: ['c1'],
					blocking: true,
				},
			],
		}),
	);
	await tools.recordFrictions.run(
		ctx({
			frictions: [
				{
					id: 'f1',
					kind: 'risk',
					description: 'unsigned distribution',
					stepRef: '1',
					claimRefs: ['c1'],
					severity: 'high',
					complianceSensitive: true,
				},
			],
		}),
	);
	await tools.recordResponsibility.run(
		ctx({
			responsibility: [
				{
					stepRef: '1',
					current: 'manual-human',
					target: 'agent',
					rationale: { frictionRef: 'f1', text: 'flag missing sign-off' },
				},
			],
		}),
	);
	await tools.recordOpportunities.run(
		ctx({
			opportunities: [
				{
					id: 'o1',
					description: 'check sign-off before push',
					frictionRefs: ['f1'],
					responsibilityTarget: 'agent',
					impact: 'high',
					effort: 'low',
					reversibility: 'reversible',
					complianceSensitive: true,
				},
			],
		}),
	);
	await tools.recordRecommendation.run(
		ctx({
			recommendation: {
				opportunityRef: 'o1',
				scope: 'financial',
				whatAgentDoes: 'warns editor',
				aiRole: 'assist-only',
				decisionClass: 'advisory',
				supportRefs: ['c1'],
				whatStaysHuman: ['sign-off'],
				boundaries: ['never approves'],
				whyBounded: 'irreversible publish',
			},
		}),
	);
	await tools.recordValue.run(
		ctx({
			expectedValue: {
				statements: [{ text: 'catches unsigned releases', unquantified: true }],
				assumptions: ['editors act on the warning'],
			},
		}),
	);
}

describe('loadEvidence', () => {
	it('loads the SignalWire fixtures with ids and titles', () => {
		const ids = evidence.map((item) => item.id);
		expect(ids).toContain('procedure-approvals');
		expect(ids).toContain('submission-thread-4821');
		expect(evidence.every((item) => item.title.length > 0 && item.body.length > 0)).toBe(true);
	});
});

describe('listEvidence', () => {
	it('returns id and title only, never the body', async () => {
		const result = (await listEvidence.run(ctx({}))) as { output: Array<Record<string, unknown>> };
		expect(result.output[0]).toHaveProperty('id');
		expect(result.output[0]).toHaveProperty('title');
		expect(result.output[0]).not.toHaveProperty('body');
	});
});

describe('finish_operating_map', () => {
	it('saves and terminates once a complete, consistent map is recorded', async () => {
		const h = harness();
		await recordFullMap(h.tools);
		const result = (await h.tools.finish.run(ctx({}))) as {
			output: { map: OperatingMap };
			terminate: boolean;
		};
		expect(result.terminate).toBe(true);
		expect(h.getSaved()).toEqual(result.output.map);
	});

	it('refuses to finish while a required section is missing', async () => {
		const h = harness();
		await h.tools.recordClaims.run(
			ctx({
				claims: [
					{
						claimId: 'c1',
						type: 'system-fact',
						quote: 'WirePush has no integration',
						evidenceId: 'system-distribution',
					},
				],
			}),
		);
		const result = await h.tools.finish.run(ctx({}));
		expect(typeof result).toBe('string');
		expect(result).toContain('Still needed');
	});
});

describe('provenance and status stamping', () => {
	it('stamps a fixture run final', async () => {
		const h = harness(() => true, 'fixture');
		await recordFullMap(h.tools);
		const result = (await h.tools.finish.run(ctx({}))) as { output: { map: OperatingMap } };
		expect(result.output.map.provenance).toBe('fixture');
		expect(result.output.map.status).toBe('final');
	});

	it('stamps a live run provisional, never final', async () => {
		const h = harness(() => true, 'live');
		await recordFullMap(h.tools);
		const result = (await h.tools.finish.run(ctx({}))) as { output: { map: OperatingMap } };
		expect(result.output.map.provenance).toBe('live');
		expect(result.output.map.status).toBe('provisional');
	});
});

describe('finish_incomplete', () => {
	it('saves a provisional partial map and terminates', async () => {
		const h = harness();
		await h.tools.recordClaims.run(
			ctx({
				claims: [
					{
						claimId: 'c1',
						type: 'system-fact',
						quote: 'WirePush has no integration',
						evidenceId: 'system-distribution',
					},
				],
			}),
		);
		const result = (await h.tools.finishIncomplete.run(ctx({}))) as {
			output: { map: IncompleteOperatingMap };
			terminate: boolean;
		};
		expect(result.terminate).toBe(true);
		const saved = h.getSavedIncomplete();
		expect(saved?.incomplete).toBe(true);
		expect(saved?.status).toBe('provisional');
		expect(saved?.draft.claims).toHaveLength(1);
		expect(saved?.draft.recommendation).toBeUndefined();
	});
});

describe('turn counting', () => {
	it('counts one turn per record call', async () => {
		const h = harness();
		await recordFullMap(h.tools);
		expect(h.getTurns()).toBe(9);
	});
});

describe('record_claims evidence guard', () => {
	it('rejects a claim citing evidence the run did not read', async () => {
		const h = harness((id) => id === 'procedure-approvals');
		const result = await h.tools.recordClaims.run(
			ctx({
				claims: [
					{ claimId: 'c9', type: 'inference', quote: 'guesswork', evidenceId: 'never-read' },
				],
			}),
		);
		expect(typeof result).toBe('string');
		expect(result).toContain('never-read');
		expect(h.getState().claims).toBeUndefined();
	});
});

describe('finish cross-reference checks', () => {
	it('reports a dangling claimRef and does not terminate', async () => {
		const h = harness();
		await recordFullMap(h.tools);
		await h.tools.recordWorkflow.run(
			ctx({
				objective: 'Audit approvals',
				steps: [
					{
						seq: 1,
						actor: 'Editor',
						action: 'approves',
						diverges: false,
						claimRefs: ['ghost'],
						isException: false,
					},
				],
			}),
		);
		const result = await h.tools.finish.run(ctx({}));
		expect(typeof result).toBe('string');
		expect(result).toContain('ghost');
		expect(h.getSaved()).toBeUndefined();
	});

	it('rejects a compliance-sensitive recommendation with an autonomous AI part', async () => {
		const h = harness();
		await recordFullMap(h.tools);
		await h.tools.recordRecommendation.run(
			ctx({
				recommendation: {
					opportunityRef: 'o1',
					scope: 'financial',
					whatAgentDoes: 'approves automatically',
					aiRole: 'autonomous',
					decisionClass: 'advisory',
					supportRefs: ['c1'],
					whatStaysHuman: ['nothing really'],
					boundaries: [],
					whyBounded: 'n/a',
				},
			}),
		);
		const result = await h.tools.finish.run(ctx({}));
		expect(typeof result).toBe('string');
		expect(result).toContain('does not validate');
		expect(h.getSaved()).toBeUndefined();
	});
});
