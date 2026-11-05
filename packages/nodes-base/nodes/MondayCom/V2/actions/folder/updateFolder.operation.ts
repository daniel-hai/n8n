import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertFolderStyleValues,
	buildUpdateFolderArgs,
	buildUpdateFolderMutation,
	fetchFolderState,
	type FolderUpdateChanges,
} from '../../helpers/folders';
import { extractWorkspaceId, workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import {
	folderIdProperty,
	folderStyleOptions,
	folderWorkspaceProperty,
} from '../common.description';

const properties: INodeProperties[] = [
	folderWorkspaceProperty,
	folderIdProperty,
	{
		displayName: 'Update Fields',
		name: 'updateFolderFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		options: [
			...folderStyleOptions,
			{
				...workspaceResourceLocator,
				displayName: 'Move to Workspace',
				description:
					'Move the folder and its contents to this workspace. Unless you also set a parent folder, the folder goes to the root of that workspace.',
			},
			{
				displayName: 'New Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The new name of the folder',
			},
			{
				displayName: 'Parent Folder Name or ID',
				name: 'parentFolderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getUpdateFolderParentList',
					loadOptionsDependsOn: ['folderWorkspaceId.value', 'folderId'],
				},
				default: '',
				description:
					'Put the folder inside this folder, or choose "No Parent (Workspace Root)" to take it out. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['updateFolder'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Folder: Update — update_folder resets the style attributes it does not
 * receive, so the current state is read first and sent again.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const folderId = String(this.getNodeParameter('folderId', itemIndex));
	const fields = this.getNodeParameter('updateFolderFields', itemIndex, {}) as IDataObject;
	if (Object.keys(fields).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to Update Fields', {
			itemIndex,
		});
	}
	assertFolderStyleValues.call(this, fields, itemIndex);

	const changes: FolderUpdateChanges = {
		name: fields.name as string | undefined,
		color: fields.color as string | undefined,
		customIcon: fields.customIcon as string | undefined,
		fontWeight: fields.fontWeight as string | undefined,
		parentFolderId: fields.parentFolderId as string | undefined,
		workspaceId:
			fields.workspaceId === undefined ? undefined : extractWorkspaceId(fields.workspaceId),
	};
	const current = await fetchFolderState.call(this, client, folderId, itemIndex);
	const { query, variables } = buildUpdateFolderMutation(
		folderId,
		buildUpdateFolderArgs(current, changes),
	);
	const data = await client.execute(query, itemIndex, variables);
	return (data.update_folder ?? {}) as IDataObject;
}
