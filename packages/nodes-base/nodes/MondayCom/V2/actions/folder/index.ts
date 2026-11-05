import type { INodeProperties } from 'n8n-workflow';

import * as createFolder from './createFolder.operation';
import * as deleteFolder from './deleteFolder.operation';
import * as getFolders from './getFolders.operation';
import * as getWorkspaceObjects from './getWorkspaceObjects.operation';
import * as moveObject from './moveObject.operation';
import * as updateFolder from './updateFolder.operation';

export { createFolder, deleteFolder, getFolders, getWorkspaceObjects, moveObject, updateFolder };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['folder'] } },
		options: [
			{
				name: 'Create Folder',
				value: 'createFolder',
				action: 'Create a folder',
				description:
					'Create a folder in a workspace, optionally inside another folder, to organize boards, docs and dashboards',
			},
			{
				name: 'Delete Folder',
				value: 'deleteFolder',
				action: 'Delete a folder',
				description:
					'Permanently delete a folder and everything inside it, including its boards and sub-folders',
			},
			{
				name: 'Get Many Folders',
				value: 'getFolders',
				action: 'Get many folders',
				description:
					'Return the folders of one or more workspaces, with sub-folders as their own items',
			},
			{
				name: 'Get Many Objects',
				value: 'getWorkspaceObjects',
				action: 'Get many workspace objects',
				description:
					'Return the boards, docs, workflows and folders in the left pane of a workspace, as a list or a folder tree',
			},
			{
				name: 'Move Object',
				value: 'moveObject',
				action: 'Move a workspace object',
				description:
					'Move a board, dashboard, doc or folder in the left pane, into a folder, or to another workspace',
			},
			{
				name: 'Update Folder',
				value: 'updateFolder',
				action: 'Update a folder',
				description:
					'Rename, restyle, re-nest or move a folder to another workspace. Attributes you do not change stay the same.',
			},
		],
		default: 'getFolders',
	},
	...createFolder.description,
	...deleteFolder.description,
	...getFolders.description,
	...getWorkspaceObjects.description,
	...moveObject.description,
	...updateFolder.description,
];
