import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import { DOC_BLOCK_FIELDS, formatDocBlockRow, requireDocId } from '../../helpers/docs';
import { fetchAllPaged } from '../../helpers/pagination';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

/** The blocks connection accepts 100 blocks per page. */
const BLOCKS_PAGE_SIZE = 100;

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Options',
		name: 'getDocBlocksOptions',
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
		resource: ['doc'],
		operation: ['getDocBlocks'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Get Blocks — one output item for each content block, in doc order. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const options = this.getNodeParameter('getDocBlocksOptions', itemIndex, {}) as IDataObject;

	const rows = await fetchAllPaged({
		client,
		itemIndex,
		query: `query ($ids: [ID!], $limit: Int!, $page: Int!) {
			docs(ids: $ids) { blocks(limit: $limit, page: $page) { ${DOC_BLOCK_FIELDS} } }
		}`,
		variables: { ids: [docId] },
		extractRows: (data) => {
			const doc = ((data.docs ?? []) as IDataObject[])[0];
			return (doc?.blocks ?? []) as IDataObject[];
		},
		limit: (options.limit as number | undefined) ?? DEFAULT_LIMIT,
		pageSize: BLOCKS_PAGE_SIZE,
	});
	return rows.map(formatDocBlockRow);
}
