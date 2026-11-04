import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { DOC_URL_REGEX, docResourceLocator, searchDocs } from '../helpers/docLocator';
import { getFolderList, getUpdateFolderParentList } from '../helpers/filterOptions';
import { FOLDER_ROOT_PARENT } from '../helpers/folders';

function makeLoadContext(responses: IDataObject[], params: Record<string, unknown> = {}) {
	const httpRequestWithAuthentication = vi.fn();
	for (const data of responses) httpRequestWithAuthentication.mockResolvedValueOnce({ data });
	const context = {
		getNode: () => ({ name: 'monday.com' }),
		getNodeParameter: () => 'accessToken',
		getCurrentNodeParameter: (name: string) => params[name],
		helpers: { httpRequestWithAuthentication },
	} as unknown as ILoadOptionsFunctions;
	return { context, httpRequestWithAuthentication };
}

const sentVariables = (mock: ReturnType<typeof vi.fn>, index: number) =>
	(mock.mock.calls[index] as unknown as [unknown, { body: { variables: IDataObject } }])[1].body
		.variables;

describe('doc picker', () => {
	it('offers list, ID and URL modes, and the URL regex reads the object ID', () => {
		expect(docResourceLocator.modes?.map((mode) => mode.name)).toEqual(['list', 'id', 'url']);
		expect('https://acme.monday.com/docs/18422738203'.match(DOC_URL_REGEX)?.[1]).toBe(
			'18422738203',
		);
	});

	it('returns search results with their internal ID and drops results without live data', async () => {
		const { context } = makeLoadContext([
			{
				search: {
					docs: {
						results: [
							{ id: '900', live_data: { id: '10', name: 'Spec', workspace: { name: 'Main' } } },
							{ id: '901', live_data: null },
						],
					},
				},
			},
		]);

		const result = await searchDocs.call(context, 'spec');
		expect(result.results).toEqual([{ name: 'Spec (Main)', value: '10', url: undefined }]);
	});

	it('falls back to a name match on recent docs when the search finds nothing', async () => {
		const { context, httpRequestWithAuthentication } = makeLoadContext([
			{ search: { docs: { results: [] } } },
			{
				docs: [
					{ id: '1', name: 'Welcome guide' },
					{ id: '2', name: 'Roadmap' },
				],
			},
		]);

		const result = await searchDocs.call(context, 'WELCOME');
		expect(result.results.map((doc) => doc.value)).toEqual(['1']);
		expect(sentVariables(httpRequestWithAuthentication, 1)).toEqual({ limit: 100, page: 1 });
	});

	it('pages through recent docs without a filter', async () => {
		const docs = Array.from({ length: 50 }, (_, index) => ({ id: String(index), name: 'Doc' }));
		const { context, httpRequestWithAuthentication } = makeLoadContext([{ docs }]);

		const result = await searchDocs.call(context, undefined, '2');
		expect(sentVariables(httpRequestWithAuthentication, 0)).toEqual({ limit: 50, page: 2 });
		expect(result.paginationToken).toBe('3');
	});
});

describe('folder pickers', () => {
	const folders = {
		folders: [
			{ id: '2', name: 'Child', parent: { id: '1', name: 'Parent' } },
			{ id: '1', name: 'Parent', parent: null },
		],
	};

	it('lists the Main workspace folders when no workspace is set, with parent labels', async () => {
		const { context, httpRequestWithAuthentication } = makeLoadContext([folders]);

		expect(await getFolderList.call(context)).toEqual([
			{ name: 'Parent', value: '1' },
			{ name: 'Parent / Child', value: '2' },
		]);
		expect(sentVariables(httpRequestWithAuthentication, 0)).toMatchObject({
			workspaceIds: [null],
		});
	});

	it('adds the root choice to the parent picker and leaves out the folder itself', async () => {
		const { context } = makeLoadContext([folders], { folderId: '2' });

		expect(await getUpdateFolderParentList.call(context)).toEqual([
			{ name: 'No Parent (Workspace Root)', value: FOLDER_ROOT_PARENT },
			{ name: 'Parent', value: '1' },
		]);
	});
});
