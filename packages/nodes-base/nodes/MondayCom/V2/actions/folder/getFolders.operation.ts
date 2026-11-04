import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { isRealBoard } from '../../helpers/boardLocator';
import { normalizeIdList } from '../../helpers/filterOptions';
import { FOLDER_FIELDS, FOLDERS_API_MAX_PAGE_SIZE } from '../../helpers/folders';
import { fetchAllPaged } from '../../helpers/pagination';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'getFoldersOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Folder IDs',
				name: 'folderIds',
				type: 'string',
				default: '',
				description: 'Only return these folders (comma-separated IDs)',
			},
			{
				displayName: 'Include Boards',
				name: 'includeBoards',
				type: 'boolean',
				default: false,
				description:
					'Whether to include the boards of each folder in children. Dashboards and sub-folders are not included.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'The API returns at most 100 folders per request. Each additional 100 folders takes one more request.',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Workspaces',
				name: 'workspaceIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getWorkspaces' },
				default: [],
				description:
					'Only return the folders of these workspaces. Leave it empty for all folders that your API token can access. The list does not show the Main workspace. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['getFolders'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Folder: Get Many Folders — a flat list. Sub-folders are their own rows with `parent` set. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const options = this.getNodeParameter('getFoldersOptions', itemIndex, {}) as IDataObject;

	const varDefs = ['$limit: Int!', '$page: Int!'];
	const args = ['limit: $limit', 'page: $page'];
	const variables: Record<string, unknown> = {};
	const folderIds = normalizeIdList(options.folderIds);
	if (folderIds.length > 0) {
		varDefs.push('$ids: [ID!]');
		args.push('ids: $ids');
		variables.ids = folderIds;
	}
	const workspaceIds = normalizeIdList(options.workspaceIds);
	if (workspaceIds.length > 0) {
		varDefs.push('$workspaceIds: [ID]');
		args.push('workspace_ids: $workspaceIds');
		variables.workspaceIds = workspaceIds;
	}

	// Boards only on request: they increase the complexity cost of the query.
	const includeBoards = options.includeBoards === true;
	const rows = await fetchAllPaged({
		client,
		itemIndex,
		query: `query (${varDefs.join(', ')}) {
			folders(${args.join(', ')}) { ${FOLDER_FIELDS} ${includeBoards ? 'children { id name type }' : ''} }
		}`,
		variables,
		extractRows: (data) => (data.folders ?? []) as IDataObject[],
		limit: (options.limit as number) ?? DEFAULT_LIMIT,
		pageSize: FOLDERS_API_MAX_PAGE_SIZE,
	});
	if (!includeBoards) return rows;

	// children can also hold docs and subitem boards, like the boards query.
	return rows.map((row) => ({
		...row,
		children: ((row.children ?? []) as Array<IDataObject & { type?: string }>).filter(isRealBoard),
	}));
}
