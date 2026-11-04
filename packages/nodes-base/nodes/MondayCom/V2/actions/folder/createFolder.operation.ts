import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertFolderStyleValues,
	FOLDER_ATTRIBUTE_NONE,
	FOLDER_FIELDS,
} from '../../helpers/folders';
import { extractWorkspaceId, workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { folderStyleOptions } from '../common.description';

const properties: INodeProperties[] = [
	{
		displayName: 'Folder Name',
		name: 'folderName',
		type: 'string',
		default: '',
		required: true,
		description: 'The name of the new folder',
	},
	{
		displayName: 'Options',
		name: 'createFolderOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			...folderStyleOptions,
			{
				displayName: 'Parent Folder Name or ID',
				name: 'parentFolderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getCreateFolderParentList',
					loadOptionsDependsOn: ['createFolderOptions.workspaceId.value'],
				},
				default: '',
				description:
					'Put the new folder inside this folder. The list shows the folders of the selected workspace, or of the Main workspace when no workspace is selected. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				...workspaceResourceLocator,
				description:
					'The workspace to create the folder in. Leave it empty for the Main workspace of the account, which the workspace list does not show.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['createFolder'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const name = this.getNodeParameter('folderName', itemIndex) as string;
	const options = this.getNodeParameter('createFolderOptions', itemIndex, {}) as IDataObject;
	assertFolderStyleValues.call(this, options, itemIndex);
	const parentFolderId = String(options.parentFolderId ?? '').trim();

	const varDefs = ['$name: String!'];
	const args = ['name: $name'];
	const variables: Record<string, unknown> = { name };
	const add = (variable: string, type: string, argument: string, value: unknown) => {
		varDefs.push(`$${variable}: ${type}`);
		args.push(`${argument}: $${variable}`);
		variables[variable] = value;
	};

	// With a parent but no workspace, the API rejects the call, also for the
	// Main workspace. So the workspace of the parent is sent explicitly.
	let workspaceId = extractWorkspaceId(options.workspaceId);
	if (parentFolderId && !workspaceId) {
		const parentData = await client.execute(
			'query ($ids: [ID!]) { folders(ids: $ids) { workspace { id } } }',
			itemIndex,
			{ ids: [parentFolderId] },
		);
		const parent = ((parentData.folders ?? []) as Array<{ workspace?: { id?: string } | null }>)[0];
		workspaceId = parent?.workspace?.id ?? '';
	}

	if (workspaceId) add('workspaceId', 'ID', 'workspace_id', workspaceId);
	if (parentFolderId) add('parentFolderId', 'ID', 'parent_folder_id', parentFolderId);
	if (options.color && options.color !== FOLDER_ATTRIBUTE_NONE) {
		add('color', 'FolderColor', 'color', options.color);
	}
	if (options.customIcon && options.customIcon !== FOLDER_ATTRIBUTE_NONE) {
		add('customIcon', 'FolderCustomIcon', 'custom_icon', options.customIcon);
	}
	if (options.fontWeight && options.fontWeight !== FOLDER_ATTRIBUTE_NONE) {
		add('fontWeight', 'FolderFontWeight', 'font_weight', options.fontWeight);
	}

	const data = await client.execute(
		`mutation (${varDefs.join(', ')}) {
			create_folder(${args.join(', ')}) { ${FOLDER_FIELDS} }
		}`,
		itemIndex,
		variables,
	);
	return (data.create_folder ?? {}) as IDataObject;
}
