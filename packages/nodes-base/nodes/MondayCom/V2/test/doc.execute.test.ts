import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as exportDocAsMarkdown } from '../actions/doc/exportDocAsMarkdown.operation';
import { execute as getDoc } from '../actions/doc/getDoc.operation';
import { execute as getDocBlocks } from '../actions/doc/getDocBlocks.operation';
import { execute as getDocs } from '../actions/doc/getDocs.operation';
import { execute as searchDocsAccount } from '../actions/doc/searchDocsAccount.operation';
import { formatDocRow, resolveDocId } from '../helpers/docs';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const welcomeDoc = {
	id: '10',
	object_id: '500',
	name: 'Welcome',
	settings: '{"fontSize":"small"}',
};

describe('resolveDocId', () => {
	it('uses a From List value as it is', async () => {
		const { client, execute } = makeClient();
		expect(await resolveDocId(client, 0, { mode: 'list', value: '10' })).toBe('10');
		expect(execute).not.toHaveBeenCalled();
	});

	it('tries an ID as an internal ID first, then as an object ID', async () => {
		const { client, execute } = makeClient({ docs: [] }, { docs: [{ id: '10' }] });
		expect(await resolveDocId(client, 0, { mode: 'id', value: '500' })).toBe('10');
		expect(call(execute, 0)[2]).toEqual({ ids: ['500'] });
		expect(call(execute, 1)[2]).toEqual({ objectIds: ['500'] });
	});

	it('looks up a URL by object ID only', async () => {
		const { client, execute } = makeClient({ docs: [{ id: '10' }] });
		const url = 'https://acme.monday.com/docs/500';
		expect(await resolveDocId(client, 0, { mode: 'url', value: url })).toBe('10');
		expect(execute).toHaveBeenCalledTimes(1);
		expect(call(execute, 0)[2]).toEqual({ objectIds: ['500'] });
	});

	it('returns null when no doc matches', async () => {
		const { client } = makeClient({ docs: [] }, { docs: [] });
		expect(await resolveDocId(client, 0, '7')).toBeNull();
	});
});

describe('formatDocRow', () => {
	it('parses the JSON string fields of the doc and its blocks', () => {
		expect(
			formatDocRow({ ...welcomeDoc, blocks: [{ id: 'b1', content: '{"deltaFormat":[]}' }] }),
		).toEqual({
			...welcomeDoc,
			settings: { fontSize: 'small' },
			blocks: [{ id: 'b1', content: { deltaFormat: [] } }],
		});
	});

	it('keeps a value that is not valid JSON', () => {
		expect(formatDocRow({ id: '1', settings: 'not json' }).settings).toBe('not json');
	});
});

describe('Doc: Get', () => {
	it('reads the doc with its first blocks', async () => {
		const { client, execute } = makeClient({ docs: [welcomeDoc] });
		const result = await getDoc.call(
			makeContext({
				docId: { mode: 'list', value: '10' },
				getDocOptions: { includeBlocks: true },
			}),
			client,
			0,
		);
		expect(call(execute, 0)[0]).toContain('blocks(limit: 100)');
		expect(result.settings).toEqual({ fontSize: 'small' });
	});

	it('names the doc that was not found', async () => {
		const { client } = makeClient({ docs: [] }, { docs: [] });
		await expect(
			getDoc.call(makeContext({ docId: { mode: 'id', value: '7' } }), client, 0),
		).rejects.toThrow('Doc 7 was not found');
	});
});

describe('Doc: Get Many', () => {
	it('looks up the IDs as both kinds in one request and removes duplicates', async () => {
		const { client, execute } = makeClient({ byId: [welcomeDoc], byObjectId: [welcomeDoc] });
		const rows = await getDocs.call(
			makeContext({ getDocsOptions: { docIds: '10, 500' } }),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({ ids: ['10', '500'], limit: 2 });
		expect(rows).toHaveLength(1);
	});

	it('names the IDs that were not found', async () => {
		const { client } = makeClient({ byId: [welcomeDoc], byObjectId: [] });
		await expect(
			getDocs.call(makeContext({ getDocsOptions: { docIds: '10, 8, 9' } }), client, 0),
		).rejects.toThrow('Docs 8, 9 were not found');
	});

	it('pages through the docs with the workspace and order filters', async () => {
		const { client, execute } = makeClient({ docs: [welcomeDoc] });
		await getDocs.call(
			makeContext({
				getDocsOptions: { workspaceIds: ['7'], orderBy: 'used_at', limit: 5 },
			}),
			client,
			0,
		);
		const [query, , variables] = call(execute, 0);
		expect(query).toContain('docs(limit: $limit, page: $page, workspace_ids: $workspaceIds');
		expect(variables).toEqual({ workspaceIds: ['7'], orderBy: 'used_at', limit: 5, page: 1 });
	});

	it('rejects an order that is not in the list', async () => {
		const { client, execute } = makeClient();
		await expect(
			getDocs.call(makeContext({ getDocsOptions: { orderBy: 'name' } }), client, 0),
		).rejects.toThrow('Order By "name" is not supported');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Doc: Get Blocks', () => {
	it('returns one row for each block, with parsed content', async () => {
		const { client, execute } = makeClient({
			docs: [{ blocks: [{ id: 'b1', type: 'normal text', content: '{"deltaFormat":[]}' }] }],
		});
		const rows = await getDocBlocks.call(
			makeContext({ docId: { mode: 'list', value: '10' }, getDocBlocksOptions: { limit: 10 } }),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({ ids: ['10'], limit: 10, page: 1 });
		expect(rows).toEqual([{ id: 'b1', type: 'normal text', content: { deltaFormat: [] } }]);
	});
});

describe('Doc: Export as Markdown', () => {
	it('sends the block IDs as a variable', async () => {
		const { client, execute } = makeClient({
			export_markdown_from_doc: { success: true, markdown: '# Hi' },
		});
		const result = await exportDocAsMarkdown.call(
			makeContext({
				docId: { mode: 'list', value: '10' },
				exportDocOptions: { blockIds: 'b1, b2' },
			}),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({ docId: '10', blockIds: ['b1', 'b2'] });
		expect(result).toEqual({ docId: '10', markdown: '# Hi' });
	});

	it('explains the raw HTTP 500 text from monday.com', async () => {
		const { client } = makeClient({
			export_markdown_from_doc: {
				success: false,
				error: 'Fetcher response returned NON-OK status=500',
			},
		});
		const failure = exportDocAsMarkdown.call(
			makeContext({ docId: { mode: 'list', value: '10' } }),
			client,
			0,
		);
		await expect(failure).rejects.toThrow('monday.com could not export doc 10 as markdown');
		await expect(failure).rejects.toMatchObject({
			description: expect.stringContaining('could not read the doc'),
		});
	});
});

describe('Doc: Search', () => {
	it('searches docs with the workspace filter', async () => {
		const { client, execute } = makeClient({
			search: { docs: { results: [{ id: '500', indexed_data: { name: 'Welcome' } }] } },
		});
		const rows = await searchDocsAccount.call(
			makeContext({ searchQuery: 'welcome', searchOptions: { workspaceIds: ['7'] } }),
			client,
			0,
		);
		expect(call(execute, 0)[0]).toContain('docs(query: $q, limit: $limit, workspace_ids:');
		expect(rows).toEqual([{ entityType: 'doc', id: '500', name: 'Welcome' }]);
	});
});
