import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import { assertBlockIds } from '../../helpers/docs';
import { normalizeIdList } from '../../helpers/filterOptions';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Block IDs',
		name: 'docBlockIds',
		type: 'string',
		default: '',
		required: true,
		description:
			'The IDs of the blocks to delete (comma-separated, from Get Blocks). If one block is not found, monday.com deletes no blocks.',
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['deleteDocBlocks'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Delete Blocks — delete_doc_blocks. One output item for each deleted block. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const blockIds = [...new Set(normalizeIdList(this.getNodeParameter('docBlockIds', itemIndex)))];
	if (blockIds.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Enter at least one block ID', { itemIndex });
	}
	assertBlockIds.call(this, blockIds, 'Block IDs', itemIndex);

	await client.execute(
		'mutation ($blockIds: [ID!]!) { delete_doc_blocks(block_ids: $blockIds) { id } }',
		itemIndex,
		{ blockIds },
	);
	return blockIds.map((id) => withArchiveOrDeleteOutcome({ id }, 'delete', 'block'));
}
