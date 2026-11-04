import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import {
	DOC_BLOCK_FIELDS,
	DOC_FIELDS,
	docNotFoundError,
	formatDocRow,
	requireDocId,
} from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

/** The most blocks that Include Blocks returns. Get Blocks pages through longer docs. */
const INCLUDED_BLOCKS_LIMIT = 100;

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Options',
		name: 'getDocOptions',
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
					'Whether to include the first 100 content blocks of the doc. Use the Get Blocks operation for longer docs.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['getDoc'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Get — the metadata of one doc, with its first blocks if requested. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const options = this.getNodeParameter('getDocOptions', itemIndex, {}) as IDataObject;
	const blocks =
		options.includeBlocks === true
			? `blocks(limit: ${INCLUDED_BLOCKS_LIMIT}) { ${DOC_BLOCK_FIELDS} }`
			: '';

	const data = await client.execute(
		`query ($ids: [ID!]) { docs(ids: $ids) { ${DOC_FIELDS} ${blocks} } }`,
		itemIndex,
		{ ids: [docId] },
	);
	const doc = ((data.docs ?? []) as IDataObject[])[0];
	if (!doc) throw docNotFoundError.call(this, docId, itemIndex);
	return formatDocRow(doc);
}
