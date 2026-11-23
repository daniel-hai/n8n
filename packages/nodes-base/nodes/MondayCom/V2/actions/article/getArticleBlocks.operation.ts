import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	ARTICLE_BLOCK_FIELDS,
	articleObjectIdProperty,
	requireArticleId,
	withArticleErrors,
} from '../../helpers/articles';
import { fetchAllPaged } from '../../helpers/pagination';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	articleObjectIdProperty,
	{
		displayName: 'Options',
		name: 'getArticleBlocksOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Higher limits consume more of your account’s API complexity budget per run. See the Get Rate Limits operation.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['getArticleBlocks'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Article: Get Blocks — the blocks of the published version, one output item for each block. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const objectId = requireArticleId.call(this, itemIndex);
	const options = this.getNodeParameter('getArticleBlocksOptions', itemIndex, {}) as IDataObject;

	return await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await fetchAllPaged({
				client,
				itemIndex,
				query: `query ($objectId: ID!, $limit: Int!, $page: Int!) {
				article_blocks(object_id: $objectId, limit: $limit, page: $page) { ${ARTICLE_BLOCK_FIELDS} }
			}`,
				variables: { objectId },
				extractRows: (data) => (Array.isArray(data.article_blocks) ? data.article_blocks : []),
				limit: (options.limit as number | undefined) ?? DEFAULT_LIMIT,
			}),
	);
}
