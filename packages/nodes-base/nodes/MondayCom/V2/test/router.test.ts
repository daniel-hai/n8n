/* eslint-disable @typescript-eslint/no-explicit-any */
import { Readable } from 'stream';

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import * as agent from '../actions/agent';
import * as article from '../actions/article';
import * as board from '../actions/board';
import * as column from '../actions/column';
import * as doc from '../actions/doc';
import * as emailsActivities from '../actions/emailsActivities';
import * as file from '../actions/file';
import * as folder from '../actions/folder';
import * as form from '../actions/form';
import * as graphql from '../actions/graphql';
import * as group from '../actions/group';
import * as item from '../actions/item';
import * as meeting from '../actions/meeting';
import * as notification from '../actions/notification';
import * as portfolio from '../actions/portfolio';
import { router } from '../actions/router';
import * as team from '../actions/team';
import * as update from '../actions/update';
import * as user from '../actions/user';
import { versionDescription } from '../actions/versionDescription';
import * as workspace from '../actions/workspace';

/**
 * Minimal execute context for the router: three input items, Get Item on
 * each, with per-item parameters resolved from the input item's json.
 */
function makeContext(options: {
	continueOnFail: boolean;
	itemIds: string[];
	resource?: string;
	operation?: string;
}) {
	const httpRequestWithAuthentication = vi.fn();
	const context = {
		getInputData: () => options.itemIds.map((id) => ({ json: { id } })),
		getNode: () => ({ name: 'monday.com', type: 'CUSTOM.monday', typeVersion: 2 }),
		continueOnFail: () => options.continueOnFail,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			switch (name) {
				case 'resource':
					return options.resource ?? 'item';
				case 'operation':
					return options.operation ?? 'getItem';
				case 'authentication':
					return 'accessToken';
				case 'itemId':
				case 'notificationUserIds':
				case 'assetId':
				case 'assetIds':
				case 'folderId':
				case 'articleObjectId':
				case 'formTagId':
				case 'formToken':
				case 'timelineItemId':
				case 'meetingId':
				case 'projectBoardId':
				case 'query':
				case 'searchQuery':
				case 'teamId':
				case 'userId':
					return options.itemIds[itemIndex];
				case 'docId':
					return { mode: 'list', value: options.itemIds[itemIndex] };
				case 'getDocsOptions':
					return { docIds: options.itemIds[itemIndex] };
				case 'simplify':
					return false;
				case 'downloadBinaryPropertyName':
					return 'data';
				default:
					return fallback;
			}
		},
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { context, httpRequestWithAuthentication };
}

const itemResponse = (id: string) => ({ data: { items: [{ id, name: `Item ${id}` }] } });
const columnError = {
	errors: [
		{
			message: 'Invalid column value provided',
			extensions: { code: 'ColumnValueException', status_code: 200 },
		},
	],
};

describe('router', () => {
	it('with Continue On Fail, keeps the other items and pairs the error row to the failing item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: true,
			itemIds: ['1', '2', '3'],
		});
		httpRequestWithAuthentication
			.mockResolvedValueOnce(itemResponse('1'))
			.mockResolvedValueOnce(columnError)
			.mockResolvedValueOnce(itemResponse('3'));

		const [output] = await router.call(context);

		expect(output).toHaveLength(3);
		expect(output[0]).toEqual({
			json: { id: '1', name: 'Item 1' },
			pairedItem: { item: 0 },
		});
		expect(output[1].pairedItem).toEqual({ item: 1 });
		expect(output[1].json).toEqual({ error: expect.stringContaining('Invalid column value') });
		expect(output[2]).toEqual({
			json: { id: '3', name: 'Item 3' },
			pairedItem: { item: 2 },
		});
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(3);
	});

	it('without Continue On Fail, rethrows the mapped error and stops at the failing item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: false,
			itemIds: ['1', '2', '3'],
		});
		httpRequestWithAuthentication
			.mockResolvedValueOnce(itemResponse('1'))
			.mockResolvedValueOnce(columnError)
			.mockResolvedValueOnce(itemResponse('3'));

		await expect(router.call(context)).rejects.toBeInstanceOf(NodeApiError);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('pairs every row of a multi-row result to its input item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: false,
			itemIds: ['7'],
			operation: 'getItemSubscribers',
		});
		httpRequestWithAuthentication.mockResolvedValueOnce({
			data: {
				items: [{ id: '7', name: 'Item 7', subscribers: [{ id: 'u1' }, { id: 'u2' }] }],
			},
		});

		const [output] = await router.call(context);

		expect(output).toEqual([
			{ json: { id: 'u1', itemId: '7', itemName: 'Item 7' }, pairedItem: { item: 0 } },
			{ json: { id: 'u2', itemId: '7', itemName: 'Item 7' }, pairedItem: { item: 0 } },
		]);
	});

	it('rejects an operation that the resource does not have', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: false,
			itemIds: ['1'],
			resource: 'board',
			operation: 'getItem',
		});

		await expect(router.call(context)).rejects.toThrow('The operation "getItem" is not supported');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it.each([
		{
			resource: 'user',
			operation: 'getUser',
			ok: (id: string) => ({ data: { users: [{ id }] } }),
			failure: { data: { users: [] } },
			error: 'User 2 was not found',
		},
		{
			resource: 'team',
			operation: 'getTeam',
			ok: (id: string) => ({ data: { teams: [{ id, name: `Team ${id}` }] } }),
			failure: columnError,
			error: 'Invalid column value',
		},
		{
			resource: 'file',
			operation: 'getAssets',
			ok: (id: string) => ({ data: { assets: [{ id, name: `File ${id}` }] } }),
			failure: { data: { assets: [] } },
			error: 'File 2 was not found',
		},
		{
			resource: 'folder',
			operation: 'deleteFolder',
			ok: (id: string) => ({ data: { delete_folder: { id, name: `Folder ${id}` } } }),
			failure: {
				errors: [
					{
						message: 'The folder does not exist. Please check your folder ID and try again',
						extensions: { code: 'InvalidFolderIdException', status_code: 200 },
					},
				],
			},
			error: 'The folder does not exist',
		},
		{
			resource: 'workspace',
			operation: 'searchWorkspacesAccount',
			ok: (id: string) => ({
				data: { search: { workspaces: { results: [{ id, indexed_data: { name: `WS ${id}` } }] } } },
			}),
			failure: columnError,
			error: 'Invalid column value',
		},
		{
			resource: 'doc',
			operation: 'getDocs',
			ok: (id: string) => ({ data: { byId: [{ id, object_id: id }], byObjectId: [] } }),
			failure: { data: { byId: [], byObjectId: [] } },
			error: 'Doc 2 was not found',
		},
		{
			resource: 'doc',
			operation: 'deleteDoc',
			ok: (id: string) => ({ data: { delete_doc: { success: true, id } } }),
			failure: { data: { delete_doc: { success: false, error: 'Doc not found' } } },
			error: 'monday.com could not delete doc 2',
		},
		{
			resource: 'article',
			operation: 'getArticleBlocks',
			ok: (id: string) => ({ data: { article_blocks: [{ id }] } }),
			failure: {
				errors: [
					{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
				],
			},
			error: 'monday.com could not run the Knowledge Base request',
		},
		{
			resource: 'emailsActivities',
			operation: 'getTimelineItem',
			ok: (id: string) => ({ data: { timeline_item: { id } } }),
			failure: {
				errors: [{ message: 'Timeline item not found.', extensions: { code: 'NOT_FOUND' } }],
			},
			error: 'Timeline item 2 was not found',
		},
		{
			resource: 'meeting',
			operation: 'getMeeting',
			ok: (id: string) => ({
				data: { notetaker: { meetings: { meetings: [{ id }], page_info: null } } },
			}),
			failure: { data: { notetaker: { meetings: { meetings: [], page_info: null } } } },
			error: 'Meeting 2 was not found',
		},
		{
			resource: 'form',
			operation: 'getForm',
			ok: (id: string) => ({ data: { form: { id, token: id } } }),
			failure: {
				errors: [
					{
						message: 'User unauthorized to perform action',
						extensions: { code: 'USER_UNAUTHORIZED' },
					},
				],
			},
			error: 'Form 2 was not found, or you have no access to it',
		},
		{
			resource: 'graphql',
			operation: 'graphql',
			ok: (id: string) => ({ data: { id } }),
			failure: columnError,
			error: 'Invalid column value',
		},
	])(
		'$resource: with Continue On Fail, pairs the error row to the failing middle item',
		async ({ resource, operation, ok, failure, error }) => {
			const { context, httpRequestWithAuthentication } = makeContext({
				continueOnFail: true,
				itemIds: ['1', '2', '3'],
				resource,
				operation,
			});
			httpRequestWithAuthentication
				.mockResolvedValueOnce(ok('1'))
				.mockResolvedValueOnce(failure)
				.mockResolvedValueOnce(ok('3'));

			const [output] = await router.call(context);

			expect(output.map((row) => row.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
			expect(output[0].json.id).toBe('1');
			expect(output[1].json).toEqual({ error: expect.stringContaining(error) });
			expect(output[2].json.id).toBe('3');
		},
	);

	it('notification: with Continue On Fail, pairs the error row to the failing middle item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: true,
			itemIds: ['1', '2', '3'],
			resource: 'notification',
			operation: 'createNotification',
		});
		const check = (userId: string, found: boolean) => ({
			data: { users: found ? [{ id: userId }] : [], target: [{ id: userId }] },
		});
		const sent = { data: { notify0: { text: 'Hello' } } };
		httpRequestWithAuthentication
			.mockResolvedValueOnce(check('1', true))
			.mockResolvedValueOnce(sent)
			.mockResolvedValueOnce(check('2', false))
			.mockResolvedValueOnce(check('3', true))
			.mockResolvedValueOnce(sent);

		const [output] = await router.call(context);

		expect(output.map((row) => row.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
		expect(output[0].json).toMatchObject({ userId: '1', success: true });
		expect(output[1].json).toEqual({ error: expect.stringContaining('User 2 was not found') });
		expect(output[2].json).toMatchObject({ userId: '3', success: true });
	});

	it('form tag: with Continue On Fail, pairs the error row to the failing middle item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: true,
			itemIds: ['1', '2', '3'],
			resource: 'form',
			operation: 'deleteFormTag',
		});
		const tags = (id: string, found: boolean) => ({
			data: { form: { tags: found ? [{ id, name: `tag ${id}` }] : [] } },
		});
		const deleted = { data: { delete_form_tag: true } };
		httpRequestWithAuthentication
			.mockResolvedValueOnce(tags('1', true))
			.mockResolvedValueOnce(deleted)
			.mockResolvedValueOnce(tags('2', false))
			.mockResolvedValueOnce(tags('3', true))
			.mockResolvedValueOnce(deleted);

		const [output] = await router.call(context);

		expect(output.map((row) => row.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
		expect(output[0].json).toMatchObject({ tagId: '1', deleted: true });
		expect(output[1].json).toEqual({ error: expect.stringContaining('Tag 2 was not found') });
		expect(output[2].json).toMatchObject({ tagId: '3', deleted: true });
	});

	it('portfolio: with Continue On Fail, pairs the error row to the failing middle item', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: true,
			itemIds: ['1', '2', '3'],
			resource: 'portfolio',
			operation: 'connectProjectToPortfolio',
		});
		const getNodeParameter = context.getNodeParameter.bind(context);
		context.getNodeParameter = ((name: string, itemIndex: number, fallback?: unknown) =>
			name === 'portfolioBoardId'
				? '500'
				: getNodeParameter(name, itemIndex, fallback)) as typeof context.getNodeParameter;
		const result = (success: boolean) => ({
			data: { connect_project_to_portfolio: { success, portfolio_item_id: success ? '9' : null } },
		});
		httpRequestWithAuthentication
			.mockResolvedValueOnce(result(true))
			.mockResolvedValueOnce(result(false))
			.mockResolvedValueOnce(result(true));

		const [output] = await router.call(context);

		expect(output.map((row) => row.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
		expect(output[0].json).toMatchObject({ projectBoardId: '1', success: true });
		expect(output[1].json).toEqual({
			error: 'monday.com could not connect project board 2 to portfolio board 500',
		});
		expect(output[2].json).toMatchObject({ projectBoardId: '3', success: true });
	});

	it('file download: pairs binary rows and the error row to their input items', async () => {
		const { context, httpRequestWithAuthentication } = makeContext({
			continueOnFail: true,
			itemIds: ['1', '2', '3'],
			resource: 'file',
			operation: 'downloadFile',
		});
		const storageUrl = (id: string) =>
			`https://prod-euc1-files-monday-com.s3.eu-central-1.amazonaws.com/1/resources/${id}/f.txt`;
		Object.assign(context.helpers, {
			httpRequest: vi.fn(async () => Readable.from(['body'])),
			prepareBinaryData: vi.fn(async (_body: unknown, fileName?: string) => ({
				data: '',
				mimeType: 'text/plain',
				fileName,
			})),
		});
		const ok = (id: string) => ({
			data: { assets: [{ id, name: `f${id}.txt`, public_url: storageUrl(id) }] },
		});
		httpRequestWithAuthentication
			.mockResolvedValueOnce(ok('1'))
			.mockResolvedValueOnce({ data: { assets: [] } })
			.mockResolvedValueOnce(ok('3'));

		const [output] = await router.call(context);

		expect(output.map((row) => row.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
		expect(output[0].binary?.data?.fileName).toBe('f1.txt');
		expect(output[1].json).toEqual({ error: 'File 2 was not found' });
		expect(output[2].json).toEqual({ id: '3', name: 'f3.txt' });
	});

	it('has an operation module with fields and an execute function for every dropdown option', () => {
		const resources = {
			agent,
			article,
			board,
			column,
			doc,
			emailsActivities,
			file,
			folder,
			form,
			graphql,
			group,
			item,
			meeting,
			notification,
			portfolio,
			team,
			update,
			user,
			workspace,
		};
		const resourceOptions = versionDescription.properties.find((p) => p.name === 'resource');
		expect(
			(resourceOptions?.options ?? []).map((o) => ('value' in o ? String(o.value) : '')).sort(),
		).toEqual(Object.keys(resources).sort());
		for (const [resource, module] of Object.entries(resources)) {
			const dropdown = module.description.find((p) => p.name === 'operation');
			const values = (dropdown?.options ?? []).map((o) => ('value' in o ? String(o.value) : ''));
			expect(values.length).toBeGreaterThan(0);
			for (const value of values) {
				const operation = (module as Record<string, unknown>)[value] as
					| { execute?: unknown; description?: unknown }
					| undefined;
				expect(typeof operation?.execute, `${resource}.${value}`).toBe('function');
				expect(Array.isArray(operation?.description), `${resource}.${value}`).toBe(true);
			}
		}
	});
});
