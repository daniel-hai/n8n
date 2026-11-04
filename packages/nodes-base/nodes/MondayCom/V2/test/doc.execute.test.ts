import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as addDocContent } from '../actions/doc/addDocContent.operation';
import { execute as createDoc } from '../actions/doc/createDoc.operation';
import { execute as createDocBlock } from '../actions/doc/createDocBlock.operation';
import { execute as deleteDoc } from '../actions/doc/deleteDoc.operation';
import { execute as deleteDocBlocks } from '../actions/doc/deleteDocBlocks.operation';
import { execute as duplicateDoc } from '../actions/doc/duplicateDoc.operation';
import { execute as exportDocAsMarkdown } from '../actions/doc/exportDocAsMarkdown.operation';
import { execute as getDoc } from '../actions/doc/getDoc.operation';
import { execute as getDocBlocks } from '../actions/doc/getDocBlocks.operation';
import { execute as getDocs } from '../actions/doc/getDocs.operation';
import { execute as importDocFromHtml } from '../actions/doc/importDocFromHtml.operation';
import { execute as renameDoc } from '../actions/doc/renameDoc.operation';
import { execute as searchDocsAccount } from '../actions/doc/searchDocsAccount.operation';
import { execute as updateDocBlock } from '../actions/doc/updateDocBlock.operation';
import {
	buildTextBlockContent,
	formatDocRow,
	normalizeBlockContentJson,
	resolveDocId,
} from '../helpers/docs';
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

const listDoc = { mode: 'list', value: '10' };
const blockA = '1983bc9f-70c4-43ff-9d57-c0dcd6431769';
const blockB = 'e594e13c-2142-41c3-a9f3-f7dfef63dbbc';

describe('block content helpers', () => {
	it('builds a text payload for text blocks and an empty one for dividers', () => {
		expect(buildTextBlockContent('quote', 'Hi')).toBe('{"deltaFormat":[{"insert":"Hi"}]}');
		expect(buildTextBlockContent('divider', 'ignored')).toBe('{}');
		expect(buildTextBlockContent('table', 'x')).toBeNull();
	});

	it('accepts a JSON object or a JSON string, and rejects other JSON', () => {
		expect(normalizeBlockContentJson({ row_count: 1 })).toBe('{"row_count":1}');
		expect(normalizeBlockContentJson(' {"a": 1} ')).toBe('{"a":1}');
		expect(normalizeBlockContentJson('')).toBe('{}');
		expect(normalizeBlockContentJson('[1]')).toBeNull();
		expect(normalizeBlockContentJson('{bad')).toBeNull();
	});
});

describe('Doc: Create', () => {
	it('creates a doc in a workspace with the kind and folder', async () => {
		const { client, execute } = makeClient({ create_doc: { id: '10', name: 'Plan' } });
		await createDoc.call(
			makeContext({
				docLocation: 'workspace',
				docName: 'Plan',
				docWorkspaceId: '7',
				createDocOptions: { kind: 'share', folderId: '3' },
			}),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({
			location: { workspace: { workspace_id: '7', name: 'Plan', kind: 'share', folder_id: '3' } },
		});
	});

	it('rejects a kind that is not in the list', async () => {
		const { client, execute } = makeClient();
		await expect(
			createDoc.call(
				makeContext({ docName: 'Plan', docWorkspaceId: '7', createDocOptions: { kind: 'team' } }),
				client,
				0,
			),
		).rejects.toThrow('Kind "team" is not supported');
		expect(execute).not.toHaveBeenCalled();
	});

	it('creates a doc in an item and renames it', async () => {
		const { client, execute } = makeClient(
			{ create_doc: { id: '10', name: 'Untitled' } },
			{ update_doc_name: { success: true, name: 'Spec' } },
		);
		const result = await createDoc.call(
			makeContext({
				docLocation: 'board',
				itemId: '5',
				docColumnId: 'doc_1',
				boardDocName: 'Spec',
			}),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({
			location: { board: { item_id: '5', column_id: 'doc_1' } },
		});
		expect(call(execute, 1)[2]).toEqual({ docId: '10', name: 'Spec' });
		expect(result.name).toBe('Spec');
	});

	it('names the new doc when the rename fails', async () => {
		const { client } = makeClient(
			{ create_doc: { id: '10', name: 'Untitled' } },
			{ update_doc_name: { success: false, error: 'Nope' } },
		);
		await expect(
			createDoc.call(
				makeContext({ docLocation: 'board', itemId: '5', docColumnId: 'doc_1', boardDocName: 'X' }),
				client,
				0,
			),
		).rejects.toThrow('The node created doc 10, but monday.com could not rename it');
	});
});

describe('Doc: Rename, Duplicate and Delete', () => {
	it('throws the reason when monday.com reports a failure in the result', async () => {
		const { client } = makeClient({
			update_doc_name: { success: false, error: 'Doc not found, please check the document id' },
		});
		const failure = renameDoc.call(makeContext({ docId: listDoc, docNewName: 'X' }), client, 0);
		await expect(failure).rejects.toThrow('monday.com could not rename doc 10');
		await expect(failure).rejects.toMatchObject({
			description: 'Doc not found, please check the document id',
		});
	});

	it('always sends a duplicate type and reads the copy by its object ID', async () => {
		const { client, execute } = makeClient(
			{ duplicate_doc: { success: true, id: '600' } },
			{ docs: [{ id: '11', object_id: '600' }] },
		);
		const result = await duplicateDoc.call(makeContext({ docId: listDoc }), client, 0);
		expect(call(execute, 0)[2]).toEqual({
			docId: '10',
			duplicateType: 'duplicate_doc_with_content',
		});
		expect(call(execute, 1)[0]).toContain('docs(object_ids: $ids)');
		expect(result).toEqual({ id: '11', object_id: '600' });
	});

	it('returns the deleted state', async () => {
		const { client } = makeClient({ delete_doc: { success: true, id: '10' } });
		expect(await deleteDoc.call(makeContext({ docId: listDoc }), client, 0)).toEqual({
			id: '10',
			deleted: true,
			action: 'delete',
		});
	});
});

describe('Doc: Add Content', () => {
	it('returns the IDs of the new blocks', async () => {
		const { client, execute } = makeClient({
			add_content_to_doc_from_markdown: { success: true, block_ids: [blockA] },
		});
		const result = await addDocContent.call(
			makeContext({
				docId: listDoc,
				docMarkdown: '# Hi',
				addDocContentOptions: { afterBlockId: blockB },
			}),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({ docId: '10', markdown: '# Hi', afterBlockId: blockB });
		expect(result).toEqual({ docId: '10', blockIds: [blockA] });
	});

	it('explains the HTTP 500 for an After Block ID that is not in the doc', async () => {
		const execute = vi.fn().mockRejectedValue(new Error('Internal server error'));
		const client = { execute } as unknown as MondayGraphQLClient;
		await expect(
			addDocContent.call(
				makeContext({
					docId: listDoc,
					docMarkdown: 'x',
					addDocContentOptions: { afterBlockId: blockB },
				}),
				client,
				0,
			),
		).rejects.toThrow(`monday.com could not add the content after block ${blockB}`);
	});

	it('rejects an After Block ID that is not a UUID before any request', async () => {
		const { client, execute } = makeClient();
		await expect(
			addDocContent.call(
				makeContext({
					docId: listDoc,
					docMarkdown: 'x',
					addDocContentOptions: { afterBlockId: '1' },
				}),
				client,
				0,
			),
		).rejects.toThrow('After Block ID: "1" is not a block ID');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Doc: Import From HTML', () => {
	it('sends the options as variables and reads the new doc', async () => {
		const { client, execute } = makeClient(
			{ import_doc_from_html: { success: true, doc_id: '12' } },
			{ docs: [{ id: '12', name: 'Imported' }] },
		);
		const result = await importDocFromHtml.call(
			makeContext({
				docHtml: '<h1>Hi</h1>',
				docWorkspaceId: '7',
				importDocOptions: { title: 'Imported', kind: 'public', folderId: '3' },
			}),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({
			html: '<h1>Hi</h1>',
			workspaceId: '7',
			title: 'Imported',
			kind: 'public',
			folderId: '3',
		});
		expect(result).toEqual({ id: '12', name: 'Imported' });
	});
});

describe('Doc: Create Block and Update Block', () => {
	it('sends the content as a JSON string, with the placement options', async () => {
		const { client, execute } = makeClient({ create_doc_block: { id: blockA, content: '{}' } });
		await createDocBlock.call(
			makeContext({
				docId: listDoc,
				docBlockType: 'quote',
				docBlockText: 'Hi',
				createDocBlockOptions: { afterBlockId: blockB, parentBlockId: blockA },
			}),
			client,
			0,
		);
		const [query, , variables] = call(execute, 0);
		expect(query).toContain('after_block_id: $afterBlockId, parent_block_id: $parentBlockId');
		expect(variables).toEqual({
			docId: '10',
			type: 'quote',
			content: '{"deltaFormat":[{"insert":"Hi"}]}',
			afterBlockId: blockB,
			parentBlockId: blockA,
		});
	});

	it('asks for Raw JSON for a table in Text mode', async () => {
		const { client, execute } = makeClient();
		await expect(
			createDocBlock.call(makeContext({ docId: listDoc, docBlockType: 'table' }), client, 0),
		).rejects.toThrow('A "table" block needs structured content');
		expect(execute).not.toHaveBeenCalled();
	});

	it('rejects a block type that is not in the list', async () => {
		const { client } = makeClient();
		await expect(
			createDocBlock.call(makeContext({ docId: listDoc, docBlockType: 'chart' }), client, 0),
		).rejects.toThrow('Block type "chart" is not supported');
	});

	it('leaves the numeric type and the editor state out of an updated block', async () => {
		const { client, execute } = makeClient({
			update_doc_block: {
				id: blockA,
				content: '{"deltaFormat":[{"insert":"New"}],"base64Encoded":"AgL="}',
			},
		});
		const result = await updateDocBlock.call(
			makeContext({ docBlockId: blockA, docBlockText: 'New' }),
			client,
			0,
		);
		expect(call(execute, 0)[0]).not.toMatch(/^\s*type$/m);
		expect(result).toEqual({ id: blockA, content: { deltaFormat: [{ insert: 'New' }] } });
	});
});

describe('Doc: Delete Blocks', () => {
	it('returns one row for each deleted block', async () => {
		const { client, execute } = makeClient({ delete_doc_blocks: [] });
		const rows = await deleteDocBlocks.call(
			makeContext({ docBlockIds: `${blockA}, ${blockB}, ${blockA}` }),
			client,
			0,
		);
		expect(call(execute, 0)[2]).toEqual({ blockIds: [blockA, blockB] });
		expect(rows).toEqual([
			{ id: blockA, deleted: true, action: 'delete' },
			{ id: blockB, deleted: true, action: 'delete' },
		]);
	});

	it('names each ID that is not a UUID', async () => {
		const { client } = makeClient();
		await expect(
			deleteDocBlocks.call(makeContext({ docBlockIds: `${blockA}, a, b` }), client, 0),
		).rejects.toThrow('Block IDs: "a", "b" are not block IDs');
	});
});
