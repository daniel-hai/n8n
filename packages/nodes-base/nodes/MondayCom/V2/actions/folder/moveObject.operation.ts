import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { boardResourceLocator } from '../../helpers/boardLocator';
import { docResourceLocator } from '../../helpers/docLocator';
import {
	buildUpdateFolderArgs,
	buildUpdateFolderMutation,
	fetchFolderState,
} from '../../helpers/folders';
import { extractWorkspaceId, workspaceResourceLocator } from '../../helpers/workspaceLocator';
import {
	buildHierarchyAttributes,
	describePositionReferenceError,
	type HierarchyPosition,
	POSITION_REFERENCE_TYPE_OPTIONS,
	resolveDocObjectId,
	toDynamicPosition,
} from '../../helpers/workspaceObjects';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { folderIdProperty, folderWorkspaceProperty } from '../common.description';

const MOVE_OBJECT_TYPE_OPTIONS = [
	{ name: 'Board', value: 'board' },
	{ name: 'Dashboard (Overview)', value: 'dashboard' },
	{ name: 'Doc', value: 'doc' },
	{ name: 'Folder', value: 'folder' },
];

const properties: INodeProperties[] = [
	{
		displayName: 'Object Type',
		name: 'moveObjectType',
		type: 'options',
		options: MOVE_OBJECT_TYPE_OPTIONS,
		default: 'board',
		description: 'The type of object to move',
	},
	{
		...boardResourceLocator,
		description: 'The board to move',
		displayOptions: { show: { moveObjectType: ['board'] } },
	},
	{
		...docResourceLocator,
		description: 'The doc to move',
		displayOptions: { show: { moveObjectType: ['doc'] } },
	},
	{
		displayName: 'Dashboard ID',
		name: 'dashboardId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 12345678',
		description:
			'The dashboard (overview) ID, the number in the dashboard URL. The API cannot list dashboards, so you must enter the ID.',
		displayOptions: { show: { moveObjectType: ['dashboard'] } },
	},
	{ ...folderWorkspaceProperty, displayOptions: { show: { moveObjectType: ['folder'] } } },
	{
		...folderIdProperty,
		description:
			'The folder to move. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { moveObjectType: ['folder'] } },
	},
	{
		displayName: 'New Position',
		name: 'movePosition',
		type: 'collection',
		placeholder: 'Add position',
		default: {},
		description:
			'Where to put the object in the left pane, next to a reference object. A position next to a root-level object also takes the object out of its folder. To put the object in a folder, also set the destination folder.',
		options: [
			{
				displayName: 'Placement',
				name: 'placement',
				type: 'options',
				options: [
					{ name: 'After Reference Object', value: 'after' },
					{ name: 'Before Reference Object', value: 'before' },
				],
				default: 'after',
				description: 'Whether to put the object after or before the reference object',
			},
			{
				displayName: 'Reference Object ID',
				name: 'objectId',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1234567890',
				description:
					'The ID of the reference object: a board or doc object ID, a folder ID, or a dashboard ID',
			},
			{
				displayName: 'Reference Object Type',
				name: 'objectType',
				type: 'options',
				options: POSITION_REFERENCE_TYPE_OPTIONS,
				default: 'Board',
				description: 'The type of the reference object',
			},
		],
	},
	{
		displayName: 'Destination',
		name: 'moveDestination',
		type: 'collection',
		placeholder: 'Add destination',
		default: {},
		description:
			'The folder or workspace to move the object to. For a folder, the destination folder becomes its new parent.',
		options: [
			{
				displayName: 'Folder Name or ID',
				name: 'folderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getMoveDestinationFolderList',
					loadOptionsDependsOn: ['moveDestination.workspaceId.value'],
				},
				default: '',
				description:
					'Move the object into this folder. The list shows the folders of the destination workspace, or of the Main workspace when no workspace is selected. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				...workspaceResourceLocator,
				description:
					'Move the object to this workspace. A board or doc in the same workspace stays in its folder. To take it out of the folder, use New Position.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['moveObject'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

const OBJECT_TYPES = new Set(MOVE_OBJECT_TYPE_OPTIONS.map((option) => option.value));
const REFERENCE_TYPES = new Set(POSITION_REFERENCE_TYPE_OPTIONS.map((option) => option.value));

const BOARD_HIERARCHY_MUTATION = `mutation ($boardId: ID!, $attributes: UpdateBoardHierarchyAttributesInput!) {
	update_board_hierarchy(board_id: $boardId, attributes: $attributes) {
		success
		message
		board { id name type board_folder_id workspace_id url }
	}
}`;

// folder_id is not selected: selecting it fails with an internal server error.
const OVERVIEW_HIERARCHY_MUTATION = `mutation ($overviewId: ID!, $attributes: UpdateOverviewHierarchyAttributesInput!) {
	update_overview_hierarchy(overview_id: $overviewId, attributes: $attributes) {
		success
		message
		overview { id name kind workspace_id }
	}
}`;

/**
 * Folder: Move Object — update_board_hierarchy moves boards and docs,
 * update_overview_hierarchy moves dashboards, and update_folder with a
 * position moves folders.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const objectType = String(this.getNodeParameter('moveObjectType', itemIndex));
	const positionInput = this.getNodeParameter('movePosition', itemIndex, {}) as IDataObject;
	const destination = this.getNodeParameter('moveDestination', itemIndex, {}) as IDataObject;
	const referenceType = String(positionInput.objectType || 'Board');
	if (!OBJECT_TYPES.has(objectType) || !REFERENCE_TYPES.has(referenceType)) {
		throw new NodeOperationError(
			this.getNode(),
			OBJECT_TYPES.has(objectType)
				? `Reference Object Type "${referenceType}" is not supported`
				: `Object Type "${objectType}" is not supported`,
			{ itemIndex, description: 'Choose a value from the list.' },
		);
	}

	const referenceId = String(positionInput.objectId ?? '').trim();
	if (!referenceId && Object.keys(positionInput).length > 0) {
		throw new NodeOperationError(this.getNode(), 'New Position needs a Reference Object ID', {
			itemIndex,
			description: 'Enter the ID of the object to put this object next to.',
		});
	}
	const destinationFolderId = String(destination.folderId ?? '').trim();
	const destinationWorkspaceId = extractWorkspaceId(destination.workspaceId).trim();
	if (!referenceId && !destinationFolderId && !destinationWorkspaceId) {
		throw new NodeOperationError(this.getNode(), 'Set a New Position or a Destination', {
			itemIndex,
			description: 'Without one of them, there is nothing to move.',
		});
	}

	const position: HierarchyPosition | undefined = referenceId
		? {
				objectId: referenceId,
				objectType: referenceType,
				isAfter: positionInput.placement !== 'before',
			}
		: undefined;
	const attributes = buildHierarchyAttributes({
		folderId: destinationFolderId || undefined,
		workspaceId: destinationWorkspaceId || undefined,
		position,
	});

	const executeMove = async (query: string, variables: Record<string, unknown>) => {
		try {
			return await client.execute(query, itemIndex, variables);
		} catch (error) {
			const hint = describePositionReferenceError(
				error instanceof Error ? error.message : String(error),
				position !== undefined,
			);
			if (hint) throw new NodeOperationError(this.getNode(), hint, { itemIndex });
			throw error;
		}
	};

	if (objectType === 'board') {
		const boardId = this.getNodeParameter('boardId', itemIndex, undefined, {
			extractValue: true,
		}) as string;
		const data = await executeMove(BOARD_HIERARCHY_MUTATION, { boardId, attributes });
		return { objectType, ...((data.update_board_hierarchy ?? {}) as IDataObject) };
	}

	if (objectType === 'doc') {
		const locator = this.getNodeParameter('docId', itemIndex) as IDataObject;
		const docObjectId = await resolveDocObjectId(client, itemIndex, locator);
		if (!docObjectId) {
			throw new NodeOperationError(this.getNode(), 'The doc was not found', {
				itemIndex,
				description: 'Check the doc ID or URL, and that your API token can access the doc.',
			});
		}
		const data = await executeMove(BOARD_HIERARCHY_MUTATION, {
			boardId: docObjectId,
			attributes,
		});
		return { objectType, ...((data.update_board_hierarchy ?? {}) as IDataObject) };
	}

	if (objectType === 'dashboard') {
		const overviewId = String(this.getNodeParameter('dashboardId', itemIndex)).trim();
		const data = await executeMove(OVERVIEW_HIERARCHY_MUTATION, { overviewId, attributes });
		return { objectType, ...((data.update_overview_hierarchy ?? {}) as IDataObject) };
	}

	// update_folder resets the style attributes it does not receive, so the current values are sent again.
	const folderId = String(this.getNodeParameter('folderId', itemIndex));
	const current = await fetchFolderState.call(this, client, folderId, itemIndex);
	const merged = buildUpdateFolderArgs(current, {
		parentFolderId: destinationFolderId || undefined,
		workspaceId: destinationWorkspaceId || undefined,
	});
	// A parent folder ID overrides the position, so the position alone decides the new parent.
	if (position && !destinationFolderId) merged.parentFolderId = undefined;
	const { query, variables } = buildUpdateFolderMutation(
		folderId,
		merged,
		position ? toDynamicPosition(position) : undefined,
	);
	const data = await executeMove(query, variables);
	return { objectType, moved: true, ...((data.update_folder ?? {}) as IDataObject) };
}
