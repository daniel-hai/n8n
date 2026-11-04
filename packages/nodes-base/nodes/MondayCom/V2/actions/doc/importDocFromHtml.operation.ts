import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertDocKind,
	assertDocMutationSucceeded,
	DOC_KIND_OPTIONS,
	readDoc,
} from '../../helpers/docs';
import { workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'HTML',
		name: 'docHtml',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		description:
			'The HTML to convert. monday.com supports text styles, titles, lists, tables, quotes, code, dividers and emoji.',
	},
	{
		...workspaceResourceLocator,
		name: 'docWorkspaceId',
		required: true,
		description: 'The workspace to create the doc in',
	},
	{
		displayName: 'Options',
		name: 'importDocOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
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
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'The name of the new doc. If empty, monday.com takes it from the HTML.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['importDocFromHtml'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Doc: Import From HTML — import_doc_from_html creates a new doc. The
 * mutation returns only the doc ID, so the node reads the new doc.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const html = this.getNodeParameter('docHtml', itemIndex) as string;
	const workspaceId = String(
		this.getNodeParameter('docWorkspaceId', itemIndex, '', { extractValue: true }),
	).trim();
	const options = this.getNodeParameter('importDocOptions', itemIndex, {}) as IDataObject;

	const varDefs = ['$html: String!', '$workspaceId: ID!'];
	const args = ['html: $html', 'workspaceId: $workspaceId'];
	const variables: Record<string, unknown> = { html, workspaceId };
	if (options.title) {
		varDefs.push('$title: String');
		args.push('title: $title');
		variables.title = String(options.title);
	}
	if (options.kind) {
		varDefs.push('$kind: DocKind');
		args.push('kind: $kind');
		variables.kind = assertDocKind.call(this, options.kind, itemIndex);
	}
	if (options.folderId) {
		varDefs.push('$folderId: ID');
		args.push('folderId: $folderId');
		variables.folderId = String(options.folderId);
	}

	const data = await client.execute(
		`mutation (${varDefs.join(', ')}) {
			import_doc_from_html(${args.join(', ')}) { success doc_id error }
		}`,
		itemIndex,
		variables,
	);
	const result = (data.import_doc_from_html ?? {}) as IDataObject;
	assertDocMutationSucceeded.call(this, result, 'import the HTML', itemIndex);

	const docId = String(result.doc_id);
	return (await readDoc(client, itemIndex, docId, 'id')) ?? { id: docId };
}
