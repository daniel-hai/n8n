import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { normalizeIdList } from '../../helpers/filterOptions';
import { FOLDERS_API_MAX_PAGE_SIZE } from '../../helpers/folders';
import { fetchAllPaged } from '../../helpers/pagination';
import { workspaceResourceLocator } from '../../helpers/workspaceLocator';
import {
	buildWorkspaceObjectRows,
	buildWorkspaceObjectTree,
	type LeftPaneBoardRow,
	type LeftPaneFolderRow,
	mapLeftPaneBoardRow,
	mapLeftPaneFolderRow,
	type WorkspaceObjectRow,
} from '../../helpers/workspaceObjects';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const OBJECT_TYPE_OPTIONS = [
	{ name: 'Boards', value: 'board' },
	{ name: 'Docs', value: 'doc' },
	{ name: 'Folders', value: 'folder' },
	{ name: 'Workflows & Custom Objects', value: 'customObject' },
];

const properties: INodeProperties[] = [
	{
		...workspaceResourceLocator,
		name: 'objectsWorkspaceId',
		description:
			'The workspace to return the objects of. Leave it empty for the Main workspace of the account, which the workspace list does not show.',
	},
	{
		displayName: 'Output Structure',
		name: 'objectsOutputStructure',
		type: 'options',
		options: [
			{
				name: 'List',
				value: 'list',
				description: 'One item per object, with the folder that holds it in folderId',
			},
			{
				name: 'Tree',
				value: 'tree',
				description: 'One item per root-level object, with folder contents in children',
			},
		],
		default: 'list',
		description:
			'How to shape the output. The API does not return the left-pane order, so items are sorted by name, folders first. The API cannot list dashboards.',
	},
	{
		displayName: 'Options',
		name: 'getObjectsOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Applies to boards, docs and workflows. Folders are always listed in full, up to 1,000.',
			},
			{
				displayName: 'Object Types',
				name: 'objectTypes',
				type: 'multiOptions',
				options: OBJECT_TYPE_OPTIONS,
				default: [],
				description:
					'Only return these object types. Leave it empty for all types. The Tree output always includes folders, because they make the tree.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['getWorkspaceObjects'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

const OBJECT_TYPES = new Set(OBJECT_TYPE_OPTIONS.map((option) => option.value));
/** Folders are always listed in full, up to this bound. */
const MAX_FOLDERS = 1000;

/**
 * Folder: Get Many Objects — the left pane of one workspace. Folders come
 * from the folders query. Boards, docs and workflows come from the boards
 * query.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const workspaceId = this.getNodeParameter('objectsWorkspaceId', itemIndex, '', {
		extractValue: true,
	}) as string;
	const structure = this.getNodeParameter('objectsOutputStructure', itemIndex, 'list') as string;
	const options = this.getNodeParameter('getObjectsOptions', itemIndex, {}) as IDataObject;
	const includeTypes = normalizeIdList(options.objectTypes);
	const unknownType = includeTypes.find((type) => !OBJECT_TYPES.has(type));
	if (unknownType !== undefined || (structure !== 'list' && structure !== 'tree')) {
		throw new NodeOperationError(
			this.getNode(),
			unknownType !== undefined
				? `Object type "${unknownType}" is not supported`
				: `Output structure "${structure}" is not supported`,
			{ itemIndex, description: 'Choose a value from the list.' },
		);
	}

	const isTree = structure === 'tree';
	const wantsType = (type: string) => includeTypes.length === 0 || includeTypes.includes(type);
	// [null] is the only handle for the Main workspace.
	const workspaceIds = [workspaceId || null];

	let folderRows: WorkspaceObjectRow[] = [];
	if (isTree || wantsType('folder')) {
		const rows = await fetchAllPaged({
			client,
			itemIndex,
			query: `query ($workspaceIds: [ID], $limit: Int!, $page: Int!) {
				folders(workspace_ids: $workspaceIds, limit: $limit, page: $page) { id name parent { id } workspace { id } }
			}`,
			variables: { workspaceIds },
			extractRows: (data) => (data.folders ?? []) as IDataObject[],
			limit: MAX_FOLDERS,
			pageSize: FOLDERS_API_MAX_PAGE_SIZE,
		});
		folderRows = (rows as unknown as LeftPaneFolderRow[]).map(mapLeftPaneFolderRow);
	}

	let boardRows: WorkspaceObjectRow[] = [];
	if (wantsType('board') || wantsType('doc') || wantsType('customObject')) {
		const rows = await fetchAllPaged({
			client,
			itemIndex,
			query: `query ($workspaceIds: [ID], $limit: Int!, $page: Int!) {
				boards(workspace_ids: $workspaceIds, limit: $limit, page: $page, state: active) {
					id name type board_folder_id url workspace { id }
				}
			}`,
			variables: { workspaceIds },
			extractRows: (data) => (data.boards ?? []) as IDataObject[],
			limit: (options.limit as number) ?? DEFAULT_LIMIT,
		});
		boardRows = (rows as unknown as LeftPaneBoardRow[]).flatMap((row) => {
			const mapped = mapLeftPaneBoardRow(row);
			return mapped ? [mapped] : [];
		});
	}

	if (isTree) {
		return buildWorkspaceObjectTree(
			folderRows,
			boardRows.filter((row) => wantsType(row.objectType)),
		);
	}
	return buildWorkspaceObjectRows(folderRows, boardRows, includeTypes);
}
