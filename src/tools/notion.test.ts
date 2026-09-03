import { describe, expect, it, vi } from 'vitest';
import { stepGate } from '../domain/workflow-map.ts';
import { createNotionDelegates, readDocumentRun, searchRun } from './notion.ts';

const ctx = { toolCallId: 't1', log: { info() {}, warn() {}, error() {}, debug() {} } };

const okResponse = (json: unknown) =>
	({ ok: true, status: 200, json: async () => json, text: async () => '' }) as Response;

const errorResponse = (status: number, text: string) =>
	({ ok: false, status, json: async () => ({}), text: async () => text }) as Response;

describe('readDocumentRun', () => {
	it('blocks with the gate message when the budget is spent, without fetching or spending', async () => {
		const fetchDelegate = vi.fn();
		const onSpend = vi.fn();

		const result = await readDocumentRun({
			gate: stepGate(4, 4),
			data: { id: 'page-1' },
			ctx,
			fetchDelegate,
			onSpend,
		});

		expect(fetchDelegate).not.toHaveBeenCalled();
		expect(onSpend).not.toHaveBeenCalled();
		expect(result).toContain('finish_operating_map');
	});

	it('fetches the document, spends one step, and returns the delegate output when allowed', async () => {
		const fetchDelegate = vi.fn().mockResolvedValue({ output: { text: 'body' } });
		const onSpend = vi.fn();

		const result = await readDocumentRun({
			gate: stepGate(0, 4),
			data: { id: 'page-1' },
			ctx,
			fetchDelegate,
			onSpend,
		});

		expect(fetchDelegate).toHaveBeenCalledWith(
			expect.objectContaining({ data: { id: 'page-1' }, toolCallId: 't1' }),
		);
		expect(onSpend).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ output: { text: 'body' } });
	});

	it('does not spend a step when the fetch fails', async () => {
		const fetchDelegate = vi.fn().mockRejectedValue(new Error('notion down'));
		const onSpend = vi.fn();

		await expect(
			readDocumentRun({ gate: stepGate(0, 4), data: { id: 'x' }, ctx, fetchDelegate, onSpend }),
		).rejects.toThrow('notion down');
		expect(onSpend).not.toHaveBeenCalled();
	});
});

describe('searchRun', () => {
	it('delegates the query and never spends a step', async () => {
		const searchDelegate = vi.fn().mockResolvedValue({ output: [{ id: 'a', title: 'A' }] });

		const result = await searchRun({
			data: { query: 'press release approval' },
			ctx,
			searchDelegate,
		});

		expect(searchDelegate).toHaveBeenCalledWith(
			expect.objectContaining({ data: { query: 'press release approval' } }),
		);
		expect(result).toEqual({ output: [{ id: 'a', title: 'A' }] });
	});
});

describe('createNotionDelegates', () => {
	it('searchDelegate posts the query to /search with auth and maps results to id/url/title', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			okResponse({
				results: [
					{
						id: 'page-1',
						url: 'https://notion.so/page-1',
						properties: { Name: { type: 'title', title: [{ plain_text: 'Approval policy' }] } },
					},
				],
			}),
		);
		const { searchDelegate } = createNotionDelegates({
			token: 'secret',
			fetchImpl,
			apiBase: 'https://api.notion.test/v1',
		});

		const result = await searchDelegate({ ...ctx, data: { query: 'approvals' } });

		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://api.notion.test/v1/search');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer secret');
		expect(JSON.parse(init.body)).toEqual({ query: 'approvals' });
		expect(result).toEqual({
			output: [{ id: 'page-1', url: 'https://notion.so/page-1', title: 'Approval policy' }],
		});
	});

	it('fetchDelegate reads a document body from its block children and flattens the text', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			okResponse({
				results: [
					{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'First line.' }] } },
					{ type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'A heading' }] } },
					{ type: 'divider', divider: {} },
				],
			}),
		);
		const { fetchDelegate } = createNotionDelegates({
			token: 'secret',
			fetchImpl,
			apiBase: 'https://api.notion.test/v1',
		});

		const result = await fetchDelegate({ ...ctx, data: { id: 'page-1' } });

		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://api.notion.test/v1/blocks/page-1/children?page_size=100');
		expect(init.method).toBe('GET');
		expect(result).toEqual({ output: { id: 'page-1', text: 'First line.\nA heading' } });
	});

	it('throws (spending nothing) when Notion returns a non-ok status', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(errorResponse(404, 'object_not_found'));
		const { fetchDelegate } = createNotionDelegates({ token: 'secret', fetchImpl });

		await expect(fetchDelegate({ ...ctx, data: { id: 'missing' } })).rejects.toThrow(
			'object_not_found',
		);
	});
});
