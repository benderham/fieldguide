import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkflowMap } from '../domain/workflow-map.ts';
import { evidence, listEvidence, produceWorkflowMap, saveWorkflowMap } from './evidence.ts';

// The tools only read `data`; the rest of the run() context is not exercised here.
const ctx = <T>(data: T) => ({ data }) as never;

const validMap: WorkflowMap = {
	steps: [
		{ actor: 'Duty editor', action: 'approves the release', evidenceId: 'procedure-approvals' },
	],
	gaps: ['no compliance log entry for #4821'],
};

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

describe('saveWorkflowMap', () => {
	it('writes the map to the given path as JSON', () => {
		const path = join(tmpdir(), `fieldguide-map-${process.pid}.json`);
		try {
			saveWorkflowMap(validMap, path);
			expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(validMap);
		} finally {
			if (existsSync(path)) rmSync(path);
		}
	});
});

describe('produceWorkflowMap', () => {
	it('accepts a map that cites real excerpt ids and terminates the run', async () => {
		const result = (await produceWorkflowMap.run(ctx(validMap))) as {
			output: { map: WorkflowMap };
			terminate: boolean;
		};
		expect(result.terminate).toBe(true);
		expect(result.output.map).toEqual(validMap);
	});

	it('rejects a citation to an unknown excerpt id without terminating', async () => {
		const badMap: WorkflowMap = {
			steps: [{ actor: 'Editor', action: 'approves', evidenceId: 'not-a-real-id' }],
			gaps: [],
		};
		const result = await produceWorkflowMap.run(ctx(badMap));
		expect(typeof result).toBe('string');
		expect(result).toContain('not-a-real-id');
	});
});
