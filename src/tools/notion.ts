import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { type StepGate, stepGate } from '../domain/workflow-map.ts';

// Notion's REST API. The MCP route is unavailable to us: Flue only executes
// MCP tools when the model calls them, so a tool that must gate the read
// against the step budget has to reach Notion itself. Override the base URL
// for a proxy or a test double; the token is read per call from the environment.
const NOTION_API_BASE = process.env.NOTION_API_URL ?? 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** True when a Notion credential is present, i.e. the agent should run against live Notion rather than eval fixtures. */
export function notionEnabled(): boolean {
	return Boolean(process.env.NOTION_TOKEN);
}

/** The subset of a Flue tool-run context the Notion tools forward to a delegate. */
export type ToolCallContext = {
	toolCallId: string;
	log: unknown;
	signal?: AbortSignal;
};

/** Performs one Notion operation for a tool call and returns its run envelope (or a bare string). */
export type ToolDelegate = (
	args: ToolCallContext & { data: Record<string, unknown> },
) => Promise<unknown>;

type RichText = { plain_text?: string };
type NotionBlock = { type: string } & Record<string, unknown>;
type NotionSearchResult = {
	id: string;
	url?: string;
	title?: RichText[];
	properties?: Record<string, { type?: string; title?: RichText[] }>;
};

function richText(spans: RichText[]): string {
	return spans.map((span) => span.plain_text ?? '').join('');
}

function extractTitle(result: NotionSearchResult): string {
	if (Array.isArray(result.title)) return richText(result.title);
	for (const property of Object.values(result.properties ?? {})) {
		if (property.type === 'title' && Array.isArray(property.title)) return richText(property.title);
	}
	return '';
}

function extractText(blocks: NotionBlock[]): string {
	return blocks
		.map((block) => {
			const detail = block[block.type] as { rich_text?: RichText[] } | undefined;
			return detail?.rich_text ? richText(detail.rich_text) : '';
		})
		.filter((line) => line.length > 0)
		.join('\n');
}

async function notionRequest(options: {
	fetchImpl: typeof fetch;
	token: string;
	apiBase: string;
	method: string;
	path: string;
	body?: unknown;
	signal?: AbortSignal;
}): Promise<unknown> {
	const response = await options.fetchImpl(`${options.apiBase}${options.path}`, {
		method: options.method,
		headers: {
			Authorization: `Bearer ${options.token}`,
			'Notion-Version': NOTION_VERSION,
			'Content-Type': 'application/json',
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		signal: options.signal,
	});
	if (!response.ok) {
		throw new Error(
			`Notion ${options.method} ${options.path} failed: ${response.status} ${await response.text()}`,
		);
	}
	return response.json();
}

/**
 * The live Notion delegates: `searchDelegate` queries the workspace,
 * `fetchDelegate` reads one document's text. A non-ok response throws, so a
 * failed read never reaches `onSpend` in `readDocumentRun` and never records an id.
 */
export function createNotionDelegates(options: {
	token: string;
	fetchImpl?: typeof fetch;
	apiBase?: string;
}): { fetchDelegate: ToolDelegate; searchDelegate: ToolDelegate } {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBase = options.apiBase ?? NOTION_API_BASE;

	const searchDelegate: ToolDelegate = async ({ data, signal }) => {
		const body = await notionRequest({
			fetchImpl,
			token: options.token,
			apiBase,
			method: 'POST',
			path: '/search',
			body: { query: String(data.query ?? '') },
			signal,
		});
		const results = (body as { results?: NotionSearchResult[] }).results ?? [];
		return { output: results.map((r) => ({ id: r.id, url: r.url, title: extractTitle(r) })) };
	};

	const fetchDelegate: ToolDelegate = async ({ data, signal }) => {
		const id = String(data.id);
		const body = await notionRequest({
			fetchImpl,
			token: options.token,
			apiBase,
			method: 'GET',
			path: `/blocks/${encodeURIComponent(id)}/children?page_size=100`,
			signal,
		});
		const blocks = (body as { results?: NotionBlock[] }).results ?? [];
		return { output: { id, text: extractText(blocks) } };
	};

	return { fetchDelegate, searchDelegate };
}

/**
 * Read one Notion document, but only if the step budget allows it. A successful
 * read spends one step via `onSpend`; a blocked read returns the gate message
 * and spends nothing, so live Notion reads share the same budget as eval reads.
 */
export async function readDocumentRun(params: {
	gate: StepGate;
	data: { id: string };
	ctx: ToolCallContext;
	fetchDelegate: ToolDelegate;
	onSpend: () => void;
}): Promise<unknown> {
	if (!params.gate.allowed) return params.gate.message;
	const result = await params.fetchDelegate({ ...params.ctx, data: { id: params.data.id } });
	params.onSpend();
	return result;
}

/** Search Notion with a natural-language query. Free: it never touches the step budget, mirroring `list_evidence`. */
export async function searchRun(params: {
	data: { query: string };
	ctx: ToolCallContext;
	searchDelegate: ToolDelegate;
}): Promise<unknown> {
	return params.searchDelegate({ ...params.ctx, data: { query: params.data.query } });
}

/**
 * Build the live-Notion tool pair. `stepsUsed`/`spend` come from the agent's
 * persistent state so the read budget is shared with eval reads; `onRead`
 * records each fetched id so the finish tool can verify citations against it.
 */
export function notionTools(deps: {
	stepsUsed: number;
	spend: () => void;
	onRead: (id: string) => void;
	fetchDelegate?: ToolDelegate;
	searchDelegate?: ToolDelegate;
}) {
	const defaults = createNotionDelegates({ token: process.env.NOTION_TOKEN ?? '' });
	const fetchDelegate = deps.fetchDelegate ?? defaults.fetchDelegate;
	const searchDelegate = deps.searchDelegate ?? defaults.searchDelegate;

	const searchDocuments = defineTool({
		name: 'search_documents',
		description:
			'Search Notion for documents with a natural-language query. Free to call and does not count as a step. Use it to find which documents are worth reading before you spend a read.',
		input: v.object({ query: v.string() }),
		run: ({ data, toolCallId, log, signal }) =>
			searchRun({ data, ctx: { toolCallId, log, signal }, searchDelegate }) as never,
	});

	const readDocument = defineTool({
		name: 'read_document',
		description:
			'Read the full text of one Notion document by id. Each successful call is one investigative step and counts against the step budget. Read one document at a time, then decide the next.',
		input: v.object({ id: v.string() }),
		run: ({ data, toolCallId, log, signal }) =>
			readDocumentRun({
				gate: stepGate(deps.stepsUsed),
				data,
				ctx: { toolCallId, log, signal },
				fetchDelegate,
				onSpend: () => {
					deps.spend();
					deps.onRead(data.id);
				},
			}) as never,
	});

	return { searchDocuments, readDocument };
}
