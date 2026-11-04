import { Readable } from 'stream';

import type FormData from 'form-data';
import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as addFileToColumn } from '../actions/file/addFileToColumn.operation';
import { execute as downloadFile } from '../actions/file/downloadFile.operation';
import { execute as getAssets } from '../actions/file/getAssets.operation';
import { ALL_COLUMN_FILES, getItemColumnFiles } from '../helpers/assets';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

const STORAGE_URL =
	'https://prod-euc1-files-monday-com.s3.eu-central-1.amazonaws.com/1/resources/7/a.txt?sig=1';

function makeContext(params: Record<string, unknown>) {
	const httpRequest = vi.fn(async () => Readable.from(['file body']));
	const prepareBinaryData = vi.fn(async (_body: unknown, fileName?: string) => ({
		data: '',
		mimeType: 'text/plain',
		fileName,
	}));
	const context = {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
		helpers: {
			assertBinaryData: () => ({
				data: Buffer.from('hello').toString('base64'),
				fileName: 'hello.txt',
				mimeType: 'text/plain',
			}),
			httpRequest,
			prepareBinaryData,
		},
	} as unknown as IExecuteFunctions;
	return { context, httpRequest, prepareBinaryData };
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	const uploadFile = vi.fn(async () => ({ add_file_to_column: { id: '7', name: 'hello.txt' } }));
	return {
		client: { execute, uploadFile } as unknown as MondayGraphQLClient,
		execute,
		uploadFile,
	};
}

const call = (mock: ReturnType<typeof vi.fn>, index: number) =>
	mock.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const asset = (id: string, extra: IDataObject = {}) => ({
	id,
	name: `file-${id}.txt`,
	public_url: STORAGE_URL,
	...extra,
});

describe('File: Add to File Column', () => {
	const params = { itemId: '11', fileColumnId: 'files', binaryPropertyName: 'data' };
	const fileColumn = { items: [{ board: { columns: [{ title: 'Files', type: 'file' }] } }] };

	it('checks the column, then sends the item and column IDs as variables', async () => {
		const { context } = makeContext(params);
		const { client, execute, uploadFile } = makeClient(fileColumn);
		const result = await addFileToColumn.call(context, client, 0);

		expect(call(execute, 0)[2]).toEqual({ ids: ['11'], columnIds: ['files'] });
		const [query, body, fileName, mimeType, length, variables] = uploadFile.mock
			.calls[0] as unknown as [string, Buffer, string, string, number, IDataObject];
		expect(query).toContain('add_file_to_column(item_id: $itemId, column_id: $columnId');
		expect(body.toString()).toBe('hello');
		expect([fileName, mimeType, length]).toEqual(['hello.txt', 'text/plain', 5]);
		expect(variables).toEqual({ itemId: '11', columnId: 'files' });
		expect(result).toMatchObject({ id: '7', itemId: '11', columnId: 'files' });
	});

	it('throws a not found error for an unknown item and does not upload', async () => {
		const { context } = makeContext(params);
		const { client, uploadFile } = makeClient({ items: [] });
		await expect(addFileToColumn.call(context, client, 0)).rejects.toThrow('Item 11 was not found');
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it('rejects a column that is not a file column', async () => {
		const { context } = makeContext(params);
		const { client, uploadFile } = makeClient({
			items: [{ board: { columns: [{ title: 'Name', type: 'name' }] } }],
		});
		await expect(addFileToColumn.call(context, client, 0)).rejects.toThrow(
			'Column "Name" (files) is a name column, not a file column',
		);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it('throws when the column is not on the board', async () => {
		const { context } = makeContext(params);
		const { client } = makeClient({ items: [{ board: { columns: [] } }] });
		await expect(addFileToColumn.call(context, client, 0)).rejects.toThrow(
			'Column files was not found on the board of item 11',
		);
	});
});

describe('MondayGraphQLClient.uploadFile', () => {
	it('sends extra variables as variables[name] form fields', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({ data: { ok: true } }));
		const context = {
			getNode: () => ({ name: 'monday.com' }),
			getNodeParameter: () => 'accessToken',
			helpers: { httpRequestWithAuthentication },
		} as unknown as IExecuteFunctions;
		await new MondayGraphQLClient(context).uploadFile(
			'mutation ($file: File!, $itemId: ID!) { x }',
			Buffer.from('hi'),
			'hi.txt',
			'text/plain',
			2,
			{ itemId: '11' },
		);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ body: FormData },
		];
		const form = options.body.getBuffer().toString();
		expect(form).toContain('name="variables[itemId]"\r\n\r\n11');
		expect(form.indexOf('variables[itemId]')).toBeLessThan(form.indexOf('variables[file]'));
	});
});

describe('File: Download', () => {
	it('streams the file without redirects and drops the expiring URL', async () => {
		const { context, httpRequest, prepareBinaryData } = makeContext({
			downloadSource: 'assetId',
			assetId: '7',
			downloadBinaryPropertyName: 'file',
		});
		const { client, execute } = makeClient({ assets: [asset('7')] });
		const [row] = await downloadFile.call(context, client, 0);

		expect(call(execute, 0)[2]).toEqual({ ids: ['7'] });
		expect(httpRequest).toHaveBeenCalledWith({
			url: STORAGE_URL,
			encoding: 'stream',
			disableFollowRedirect: true,
		});
		expect(prepareBinaryData.mock.calls[0][1]).toBe('file-7.txt');
		expect(row.json).toEqual({ id: '7', name: 'file-7.txt' });
		expect(row.binary?.file?.fileName).toBe('file-7.txt');
	});

	it('refuses a download URL outside the storage hosts', async () => {
		const { context, httpRequest } = makeContext({
			downloadSource: 'assetId',
			assetId: '7',
			downloadBinaryPropertyName: 'data',
		});
		const { client } = makeClient({
			assets: [asset('7', { public_url: 'https://files.example.com/a.txt' })],
		});
		await expect(downloadFile.call(context, client, 0)).rejects.toThrow(
			'unexpected file download URL',
		);
		expect(httpRequest).not.toHaveBeenCalled();
	});

	it('throws a not found error for an unknown asset', async () => {
		const { context } = makeContext({ downloadSource: 'assetId', assetId: '404' });
		const { client } = makeClient({ assets: [] });
		await expect(downloadFile.call(context, client, 0)).rejects.toThrow('File 404 was not found');
	});

	it('downloads every file of a column, or only the picked file', async () => {
		const columnParams = {
			downloadSource: 'fileColumn',
			itemId: '11',
			fileColumnId: 'files',
			downloadBinaryPropertyName: 'data',
		};
		const assets = { items: [{ assets: [asset('1'), asset('2')] }] };

		const all = makeClient(assets);
		const allRows = await downloadFile.call(
			makeContext({ ...columnParams, columnFileId: ALL_COLUMN_FILES }).context,
			all.client,
			0,
		);
		expect(allRows.map((row) => row.json.id)).toEqual(['1', '2']);
		expect(call(all.execute, 0)[2]).toEqual({ ids: ['11'], columnIds: ['files'] });

		const one = makeClient(assets);
		const oneRows = await downloadFile.call(
			makeContext({ ...columnParams, columnFileId: '2' }).context,
			one.client,
			0,
		);
		expect(oneRows.map((row) => row.json.id)).toEqual(['2']);

		const missing = makeClient(assets);
		await expect(
			downloadFile.call(
				makeContext({ ...columnParams, columnFileId: '9' }).context,
				missing.client,
				0,
			),
		).rejects.toThrow('File 9 is not in column files of item 11');
	});
});

describe('File: Get Many', () => {
	it('returns files by ID and names the IDs that were not found', async () => {
		const ok = makeClient({ assets: [asset('1'), asset('2')] });
		const rows = await getAssets.call(
			makeContext({ assetsSource: 'assetIds', assetIds: '1, 2' }).context,
			ok.client,
			0,
		);
		expect(rows).toHaveLength(2);

		const partial = makeClient({ assets: [asset('1')] });
		await expect(
			getAssets.call(
				makeContext({ assetsSource: 'assetIds', assetIds: '1, 8, 9' }).context,
				partial.client,
				0,
			),
		).rejects.toThrow('Files 8, 9 were not found');
	});

	it('reads only the chosen file columns of an item', async () => {
		const { client, execute } = makeClient({ items: [{ assets: [asset('1')] }] });
		const rows = await getAssets.call(
			makeContext({
				assetsSource: 'boardItem',
				itemId: '11',
				itemAssetsScope: 'columns',
				itemFileColumnIds: ['files'],
			}).context,
			client,
			0,
		);
		const [query, , variables] = call(execute, 0);
		expect(query).toContain('assets(assets_source: columns, column_ids: $columnIds)');
		expect(variables).toEqual({ ids: ['11'], columnIds: ['files'] });
		expect(rows[0]).toMatchObject({ id: '1', itemId: '11', source: 'columns' });
	});

	it('reads update attachments once each, up to the limit', async () => {
		const { client } = makeClient({
			items: [
				{
					updates: [
						{ id: 'u1', assets: [asset('1'), asset('2')] },
						{ id: 'u2', assets: [asset('1'), asset('3')] },
					],
				},
			],
		});
		const rows = await getAssets.call(
			makeContext({
				assetsSource: 'boardItem',
				itemId: '11',
				itemAssetsScope: 'updates',
				getAssetsOptions: { limit: 10 },
			}).context,
			client,
			0,
		);
		expect(rows.map((row) => [row.id, row.updateId])).toEqual([
			['1', 'u1'],
			['2', 'u1'],
			['3', 'u2'],
		]);
	});

	it('rejects a scope that is not in the list', async () => {
		const { client } = makeClient();
		await expect(
			getAssets.call(
				makeContext({ assetsSource: 'boardItem', itemId: '11', itemAssetsScope: 'other' }).context,
				client,
				0,
			),
		).rejects.toThrow('Return Files From "other" is not supported');
	});

	it('reads a column on the whole board page by page until the limit', async () => {
		const page = (cursor: string | null, ids: string[]) => ({
			cursor,
			items: [{ id: 'i1', name: 'Item', assets: ids.map((id) => asset(id)) }],
		});
		const { client, execute } = makeClient(
			{ boards: [{ items_page: page('c1', ['1']) }] },
			{ next_items_page: page('c2', ['2', '3']) },
		);
		const rows = await getAssets.call(
			makeContext({
				assetsSource: 'boardColumn',
				boardId: '5',
				fileColumnId: 'files',
				itemId: '',
				getAssetsOptions: { limit: 2 },
			}).context,
			client,
			0,
		);

		expect(rows.map((row) => row.id)).toEqual(['1', '2']);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(call(execute, 1)[2]).toEqual({ cursor: 'c1', limit: 100, columnIds: ['files'] });
	});

	it('throws a not found error for an unknown board', async () => {
		const { client } = makeClient({ boards: [] });
		await expect(
			getAssets.call(
				makeContext({ assetsSource: 'boardColumn', boardId: '404', fileColumnId: 'files' }).context,
				client,
				0,
			),
		).rejects.toThrow('Board 404 was not found');
	});
});

describe('file picker', () => {
	it('lists the files of the column after the All Files choice', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			data: { items: [{ assets: [{ id: '1', name: 'a.txt' }] }] },
		}));
		const params: Record<string, unknown> = { itemId: '11', fileColumnId: 'files' };
		const context = {
			getNode: () => ({ name: 'monday.com' }),
			getNodeParameter: () => 'accessToken',
			getCurrentNodeParameter: (name: string) => params[name],
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;

		expect(await getItemColumnFiles.call(context)).toEqual([
			{ name: 'All Files in Column', value: ALL_COLUMN_FILES },
			{ name: 'a.txt', value: '1' },
		]);
	});
});
