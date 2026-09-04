import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requireRetention, retentionManifest } from './retention.ts';

const agentSource = readFileSync(
	fileURLToPath(new URL('../agents/fieldguide.ts', import.meta.url)),
	'utf8',
);

describe('the retention registry', () => {
	it('gives every retained item a scope and a reason', () => {
		for (const entry of retentionManifest()) {
			expect(entry.reason.length, `${entry.key} has no reason`).toBeGreaterThan(0);
			expect(['run', 'audit', 'history']).toContain(entry.scope);
		}
	});

	it('refuses a retained item it has no entry for', () => {
		expect(() => requireRetention('somethingNew')).toThrow(/no entry in the retention registry/);
	});

	it('covers every durable key the agent persists', () => {
		// The point of the registry is that a durable write cannot be added without
		// a recorded reason, so this reads the agent rather than trusting a list.
		const keys = [...agentSource.matchAll(/usePersistentState(?:<[^>]*>)?\(\s*'([^']+)'/g)].map(
			(match) => match[1] as string,
		);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect(() => requireRetention(key), `${key} is persisted but unregistered`).not.toThrow();
		}
	});

	it('keeps only evidence and unresolved questions at audit scope', () => {
		const accumulating = retentionManifest()
			.filter((entry) => entry.scope === 'audit')
			.map((entry) => entry.key)
			.sort();
		expect(accumulating).toEqual(['claims', 'contradictions', 'openQuestions', 'readSet']);
	});

	it("holds the run's conclusions and the transcript as history, never as an input", () => {
		const history = retentionManifest()
			.filter((entry) => entry.scope === 'history')
			.map((entry) => entry.key)
			.sort();
		expect(history).toEqual(['snapshots', 'transcript']);
	});
});
