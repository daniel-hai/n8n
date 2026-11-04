import type { IDataObject, IExecuteFunctions, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as createArticle } from '../actions/article/createArticle.operation';
import { execute as deleteArticle } from '../actions/article/deleteArticle.operation';
import { execute as getArticleBlocks } from '../actions/article/getArticleBlocks.operation';
import { execute as getArticles } from '../actions/article/getArticles.operation';
import { execute as publishArticle } from '../actions/article/publishArticle.operation';
import { execute as searchKnowledgeBase } from '../actions/article/searchKnowledgeBase.operation';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

const node: INode = {
	id: '1',
	name: 'monday.com',
	type: 'n8n-nodes-base.mondayCom',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => node,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: Array<IDataObject | Error>) {
	const execute = vi.fn();
	for (const response of responses) {
		if (response instanceof Error) execute.mockRejectedValueOnce(response);
		else execute.mockResolvedValueOnce(response);
	}
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const serverError = () =>
	new NodeApiError(
		node,
		{
			message: 'Internal server error',
			extensions: { code: 'INTERNAL_SERVER_ERROR' },
		} as unknown as JsonObject,
		{ message: 'Internal server error' },
	);

describe('Article: Create', () => {
	it('sends the name and folder, and returns the draft', async () => {
		const { client, execute } = makeClient({ create_article: { object_id: '9', state: 'draft' } });
		const ctx = makeContext({
			articleWorkspaceId: '7',
			articleName: ' Onboarding ',
			createArticleOptions: { folderId: '3' },
		});

		expect(await createArticle.call(ctx, client, 0)).toEqual({ object_id: '9', state: 'draft' });
		expect(call(execute, 0)[2]).toEqual({ workspaceId: '7', name: 'Onboarding', folderId: '3' });
	});

	it('explains the server error of an account without a Knowledge Base', async () => {
		const { client } = makeClient(serverError());

		await expect(
			createArticle.call(makeContext({ articleWorkspaceId: '7' }), client, 0),
		).rejects.toThrow('monday.com could not run the Knowledge Base request');
	});
});

describe('Article: Publish', () => {
	it('splits the subscribers of a private article into users and teams', async () => {
		const { client, execute } = makeClient({ publish_article: { object_id: '9' } });
		const ctx = makeContext({
			articleObjectId: '9',
			articlePrivacyKind: 'PRIVATE',
			articleAddSubscribers: 'user:1,team:2',
			articleRemoveSubscribers: '3',
			publishArticleOptions: { folderId: '4' },
		});

		await publishArticle.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toEqual({
			objectId: '9',
			privacyKind: 'PRIVATE',
			folderId: '4',
			addSubscriberIds: ['1'],
			addSubscriberTeamIds: ['2'],
			removeSubscriberIds: ['3'],
			removeSubscriberTeamIds: null,
		});
	});

	it('ignores stored subscribers for a public article', async () => {
		const { client, execute } = makeClient({ publish_article: { object_id: '9' } });
		const ctx = makeContext({
			articleObjectId: '9',
			articlePrivacyKind: 'PUBLIC',
			articleAddSubscribers: '1',
		});

		await publishArticle.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toMatchObject({ addSubscriberIds: null, folderId: null });
	});

	it.each([
		[{ articleObjectId: 'abc' }, 'Article ID "abc" is not a number'],
		[{ articleObjectId: '9', articlePrivacyKind: 'SECRET' }, 'Privacy "SECRET" is not supported'],
	])('rejects %j before it sends a request', async (params, message) => {
		const { client, execute } = makeClient();

		await expect(publishArticle.call(makeContext(params), client, 0)).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Article: Delete', () => {
	it('returns a delete outcome', async () => {
		const { client } = makeClient({ delete_article: { object_id: '9', name: 'Old' } });

		expect(await deleteArticle.call(makeContext({ articleObjectId: '9' }), client, 0)).toEqual({
			object_id: '9',
			name: 'Old',
			deleted: true,
			action: 'delete',
		});
	});
});

describe('Article: Get Many', () => {
	it('returns one row for each article, with its blocks if requested', async () => {
		const { client, execute } = makeClient({
			articles: [
				{ metadata: { object_id: '1', name: 'A' }, blocks: [{ id: 'b1' }] },
				{ metadata: { object_id: '2', name: 'B' }, blocks: null },
			],
		});
		const ctx = makeContext({
			articleObjectIds: '1, 2, 1',
			getArticlesOptions: { includeBlocks: true },
		});

		expect(await getArticles.call(ctx, client, 0)).toEqual([
			{ object_id: '1', name: 'A', blocks: [{ id: 'b1' }] },
			{ object_id: '2', name: 'B', blocks: [] },
		]);
		expect(call(execute, 0)[0]).toContain('blocks {');
		expect(call(execute, 0)[2]).toEqual({ objectIds: ['1', '2'], workspaceIds: null, limit: 2 });
	});

	it('names the IDs that monday.com did not return', async () => {
		const { client } = makeClient({ articles: [{ metadata: { object_id: '1' } }] });

		await expect(
			getArticles.call(makeContext({ articleObjectIds: '1,2,3' }), client, 0),
		).rejects.toThrow('Articles 2, 3 were not found');
	});

	it('does not report missing IDs when a workspace filter is set', async () => {
		const { client } = makeClient({ articles: [] });
		const ctx = makeContext({ articleObjectIds: '1', getArticlesOptions: { workspaceIds: ['7'] } });

		expect(await getArticles.call(ctx, client, 0)).toEqual([]);
	});

	it.each([
		['', 'Article IDs is empty'],
		['1, x', 'Article IDs: "x" is not a number'],
		[Array.from({ length: 101 }, (_, i) => String(i + 1)).join(','), 'more than 100 IDs'],
	])('rejects "%s" before it sends a request', async (ids, message) => {
		const { client, execute } = makeClient();

		await expect(
			getArticles.call(makeContext({ articleObjectIds: ids }), client, 0),
		).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Article: Get Blocks', () => {
	it('pages through the blocks up to the limit', async () => {
		const page = (start: number, count: number) => ({
			article_blocks: Array.from({ length: count }, (_, i) => ({ id: `b${start + i}` })),
		});
		const { client, execute } = makeClient(page(0, 100), page(100, 100));
		const ctx = makeContext({ articleObjectId: '9', getArticleBlocksOptions: { limit: 150 } });

		const rows = await getArticleBlocks.call(ctx, client, 0);

		expect(rows).toHaveLength(150);
		expect(call(execute, 1)[2]).toEqual({ objectId: '9', limit: 100, page: 2 });
	});

	it('explains the server error', async () => {
		const { client } = makeClient(serverError());

		await expect(
			getArticleBlocks.call(makeContext({ articleObjectId: '9' }), client, 0),
		).rejects.toThrow('monday.com could not run the Knowledge Base request');
	});
});

describe('Article: Search Knowledge Base', () => {
	it('returns the answer and the snippets', async () => {
		const { client, execute } = makeClient({
			knowledge_base_search: { answer: 'Click +', raw_snippets: [{ id: 's1' }] },
		});
		const ctx = makeContext({ kbSearchQuery: ' How? ', kbSearchOptions: { snippetLimit: 2 } });

		expect(await searchKnowledgeBase.call(ctx, client, 0)).toEqual({
			query: 'How?',
			answer: 'Click +',
			snippets: [{ id: 's1' }],
		});
		expect(call(execute, 0)[2]).toEqual({ query: 'How?', limit: 2 });
	});

	it('rejects an empty question', async () => {
		const { client, execute } = makeClient();

		await expect(
			searchKnowledgeBase.call(makeContext({ kbSearchQuery: ' ' }), client, 0),
		).rejects.toThrow('Question is empty');
		expect(execute).not.toHaveBeenCalled();
	});
});
