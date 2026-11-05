import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { boardResourceLocator } from '../../helpers/boardLocator';
import { assertDocKind, DOC_FIELDS, DOC_KIND_OPTIONS, formatDocRow } from '../../helpers/docs';
import { itemResourceLocator } from '../../helpers/itemLocator';
import { workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const inWorkspace = { show: { docLocation: ['workspace'] } };
const inBoardItem = { show: { docLocation: ['board'] } };

const properties: INodeProperties[] = [
	{
		displayName: 'Create In',
		name: 'docLocation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Board Item',
				value: 'board',
				description: 'A doc in the doc column of an item',
			},
			{
				name: 'Workspace',
				value: 'workspace',
				description: 'A doc in a workspace, or in a folder of the workspace',
			},
		],
		default: 'workspace',
		description: 'Where to create the doc',
	},
	{
		displayName: 'Doc Name',
		name: 'docName',
		type: 'string',
		default: '',
		required: true,
		description: 'The name of the new doc',
		displayOptions: inWorkspace,
	},
	{
		...workspaceResourceLocator,
		name: 'docWorkspaceId',
		required: true,
		description: 'The workspace to create the doc in',
		displayOptions: inWorkspace,
	},
	{ ...boardResourceLocator, displayOptions: inBoardItem },
	{ ...itemResourceLocator, displayOptions: inBoardItem },
	{
		displayName: 'Doc Column Name or ID',
		name: 'docColumnId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getBoardDocColumns',
			loadOptionsDependsOn: ['boardId.value'],
		},
		default: '',
		required: true,
		description:
			'The doc column to create the doc in. A cell holds one doc. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: inBoardItem,
	},
	{
		displayName: 'Doc Name',
		name: 'boardDocName',
		type: 'string',
		default: '',
		description:
			'The name of the new doc. monday.com creates a doc in an item as Untitled, so the node renames it.',
		displayOptions: inBoardItem,
	},
	{
		displayName: 'Options',
		name: 'createDocOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: inWorkspace,
		options: [
			{
				displayName: 'Folder Name or ID',
				name: 'folderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDocWorkspaceFolders',
					loadOptionsDependsOn: ['docWorkspaceId.value'],
				},
				default: '',
				description:
					'The folder to create the doc in. Select a workspace first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				options: DOC_KIND_OPTIONS,
				default: 'private',
				description: 'Who can see the doc',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['createDoc'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Create — create_doc in a workspace, or in the doc column of an item. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const location = this.getNodeParameter('docLocation', itemIndex, 'workspace') as string;

	let locationInput: IDataObject;
	let boardDocName = '';
	if (location === 'board') {
		const itemId = String(
			this.getNodeParameter('itemId', itemIndex, '', { extractValue: true }),
		).trim();
		const columnId = String(this.getNodeParameter('docColumnId', itemIndex, '')).trim();
		boardDocName = String(this.getNodeParameter('boardDocName', itemIndex, '')).trim();
		locationInput = { board: { item_id: itemId, column_id: columnId } };
	} else {
		const workspaceId = String(
			this.getNodeParameter('docWorkspaceId', itemIndex, '', { extractValue: true }),
		).trim();
		const options = this.getNodeParameter('createDocOptions', itemIndex, {}) as IDataObject;
		const workspace: IDataObject = {
			workspace_id: workspaceId,
			name: this.getNodeParameter('docName', itemIndex) as string,
		};
		if (options.kind) workspace.kind = assertDocKind.call(this, options.kind, itemIndex);
		if (options.folderId) workspace.folder_id = String(options.folderId);
		locationInput = { workspace };
	}

	const data = await client.execute(
		`mutation ($location: CreateDocInput!) { create_doc(location: $location) { ${DOC_FIELDS} } }`,
		itemIndex,
		{ location: locationInput },
	);
	const doc = formatDocRow((data.create_doc ?? {}) as IDataObject);
	if (!boardDocName) return doc;

	const renamed = await client.execute(
		'mutation ($docId: ID!, $name: String!) { update_doc_name(docId: $docId, name: $name) }',
		itemIndex,
		{ docId: doc.id, name: boardDocName },
	);
	const result = (renamed.update_doc_name ?? {}) as IDataObject;
	if (result.success !== true) {
		throw new NodeOperationError(
			this.getNode(),
			`The node created doc ${String(doc.id)}, but monday.com could not rename it`,
			{ itemIndex, description: String(result.error ?? 'Use the Rename operation to try again.') },
		);
	}
	return { ...doc, name: result.name ?? boardDocName };
}
