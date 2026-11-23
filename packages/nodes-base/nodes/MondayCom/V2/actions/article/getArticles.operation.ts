import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	ARTICLE_BLOCK_FIELDS,
	ARTICLE_METADATA_FIELDS,
	withArticleErrors,
} from '../../helpers/articles';
import { normalizeIdList } from '../../helpers/filterOptions';
import { isPlainJsonObject } from '../../helpers/json';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

/** One request reads all IDs, so the node caps the count to keep the request small. */
const MAX_ARTICLE_IDS = 100;

const properties: INodeProperties[] = [
	{
		displayName: 'Article IDs',
		name: 'articleObjectIds',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 1234567890, 1234567891',
		description:
			'Comma-separated object IDs of the articles. Get Many returns only published articles.',
	},
	{
		displayName: 'Options',
		name: 'getArticlesOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Include Blocks',
				name: 'includeBlocks',
				type: 'boolean',
				default: false,
				description:
					'Whether to add the content blocks of each article. Use Get Blocks to read more blocks of one article.',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Workspaces',
				name: 'workspaceIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getWorkspaces' },
				default: [],
				description:
					'Only return articles in these workspaces. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['getArticles'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Article: Get Many — articles by object ID, one output item for each
 * article. Without a workspace filter, a missing ID fails the item.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const objectIds = [
		...new Set(normalizeIdList(this.getNodeParameter('articleObjectIds', itemIndex))),
	];
	const options = this.getNodeParameter('getArticlesOptions', itemIndex, {}) as IDataObject;
	const bad = objectIds.filter((id) => !/^\d+$/.test(id));
	if (objectIds.length === 0 || bad.length > 0) {
		throw new NodeOperationError(
			this.getNode(),
			objectIds.length === 0
				? 'Article IDs is empty'
				: `Article IDs: "${bad.join('", "')}" ${bad.length === 1 ? 'is' : 'are'} not a number`,
			{ itemIndex, description: 'Use comma-separated article object IDs, for example 1234567890.' },
		);
	}
	if (objectIds.length > MAX_ARTICLE_IDS) {
		throw new NodeOperationError(
			this.getNode(),
			`Article IDs has more than ${MAX_ARTICLE_IDS} IDs`,
			{
				itemIndex,
				description: `Received ${objectIds.length} IDs. Split them over more input items.`,
			},
		);
	}

	const workspaceIds = normalizeIdList(options.workspaceIds);
	const includeBlocks = options.includeBlocks === true;
	const data = await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await client.execute(
				`query ($objectIds: [ID!]!, $workspaceIds: [ID!], $limit: Int) {
				articles(object_ids: $objectIds, workspace_ids: $workspaceIds, limit: $limit) {
					metadata { ${ARTICLE_METADATA_FIELDS} }
					${includeBlocks ? `blocks { ${ARTICLE_BLOCK_FIELDS} }` : ''}
				}
			}`,
				itemIndex,
				{
					objectIds,
					workspaceIds: workspaceIds.length > 0 ? workspaceIds : null,
					limit: objectIds.length,
				},
			),
	);

	const rows = (Array.isArray(data.articles) ? data.articles : [])
		.filter(isPlainJsonObject)
		.map((article) => {
			const row: IDataObject = isPlainJsonObject(article.metadata) ? { ...article.metadata } : {};
			if (includeBlocks) row.blocks = Array.isArray(article.blocks) ? article.blocks : [];
			return row;
		});

	if (workspaceIds.length === 0) {
		const found = new Set(rows.map((row) => String(row.object_id)));
		const missing = objectIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`${missing.length === 1 ? 'Article' : 'Articles'} ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found`,
				{
					itemIndex,
					description:
						'Get Many returns only published articles. Publish a draft first, or check the IDs.',
				},
			);
		}
	}
	return rows;
}
