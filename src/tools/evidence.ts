import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@flue/runtime';
import { type Excerpt, parseExcerpt } from '../domain/excerpt.ts';
import { type WorkflowMap as WorkflowMapType, WorkflowMap } from '../domain/workflow-map.ts';

const evidenceDir = fileURLToPath(new URL('../../evidence/', import.meta.url));

// Stand-in for the durable evidence store described in the README. For this
// slice the deliverable is written to a file so a run produces something a
// reviewer can open.
const mapPath = fileURLToPath(new URL('../../data/last-workflow-map.json', import.meta.url));

/** Load every `.md` excerpt from the evidence directory, sorted by filename. */
export function loadEvidence(dir: string = evidenceDir): Excerpt[] {
	return readdirSync(dir)
		.filter((file) => file.endsWith('.md'))
		.sort()
		.map((file) => parseExcerpt(file, readFileSync(join(dir, file), 'utf8')));
}

export const evidence = loadEvidence();
const evidenceIds = new Set(evidence.map((item) => item.id));

/** Write a workflow map to disk as JSON, creating the target directory. */
export function saveWorkflowMap(map: WorkflowMapType, path: string = mapPath): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(map, null, 2));
}

export const listEvidence = defineTool({
	name: 'list_evidence',
	description:
		'List every available evidence excerpt as id and title. Free to call and does not count as an investigative step. Use it to decide what to read next.',
	async run() {
		return { output: evidence.map(({ id, title }) => ({ id, title })) };
	},
});

export const produceWorkflowMap = defineTool({
	name: 'produce_workflow_map',
	description:
		'Finish the audit by returning the preliminary workflow map. Call this once the workflow is reconstructed, or when told the step limit is reached. Each step must cite the id of an evidence excerpt it came from; use gaps for anything the evidence could not establish.',
	input: WorkflowMap,
	async run({ data }) {
		const unknown = data.steps.map((step) => step.evidenceId).filter((id) => !evidenceIds.has(id));
		if (unknown.length > 0) {
			return `These evidenceId values are not real excerpts: ${unknown.join(', ')}. Cite only ids returned by list_evidence, then call produce_workflow_map again.`;
		}
		saveWorkflowMap(data);
		return { output: { map: data, saved: 'data/last-workflow-map.json' }, terminate: true };
	},
});
