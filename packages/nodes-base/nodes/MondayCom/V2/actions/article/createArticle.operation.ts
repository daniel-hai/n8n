import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { ARTICLE_METADATA_FIELDS, withArticleErrors } from '../../helpers/articles';
import { workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		...workspaceResourceLocator,
		name: 'articleWorkspaceId',
		required: true,
		description: 'The workspace to create the article in',
	},
	{
		displayName: 'Article Name',
		name: 'articleName',
		type: 'string',
		default: '',
		description: 'The name of the new article. Without a name, the draft has no title.',
	},
	{
		displayName: 'Options',
		name: 'createArticleOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Folder Name or ID',
				name: 'folderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getArticleWorkspaceFolders',
					loadOptionsDependsOn: ['articleWorkspaceId.value'],
				},
				default: '',
				description:
					'The folder to create the article in. Select a workspace first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['createArticle'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Article: Create — create_article. The new article is a draft. Use Publish to publish it. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const workspaceId = String(
		this.getNodeParameter('articleWorkspaceId', itemIndex, '', { extractValue: true }),
	).trim();
	const name = String(this.getNodeParameter('articleName', itemIndex, '')).trim();
	const options = this.getNodeParameter('createArticleOptions', itemIndex, {}) as IDataObject;
	const folderId = String(options.folderId ?? '').trim();

	const data = await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await client.execute(
				`mutation ($name: String, $workspaceId: ID!, $folderId: ID) {
				create_article(name: $name, workspace_id: $workspaceId, folder_id: $folderId) { ${ARTICLE_METADATA_FIELDS} }
			}`,
				itemIndex,
				{ workspaceId, name: name || null, folderId: folderId || null },
			),
	);
	return (data.create_article ?? {}) as IDataObject;
}
