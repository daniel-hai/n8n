import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import { requireDocId } from '../../helpers/docs';
import { normalizeIdList } from '../../helpers/filterOptions';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Options',
		name: 'exportDocOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Block IDs',
				name: 'blockIds',
				type: 'string',
				default: '',
				description:
					'Only export these blocks (comma-separated IDs from Get Blocks). If empty, the node exports the full doc.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['exportDocAsMarkdown'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Doc: Export as Markdown. monday.com reports a failure in the result, not
 * as a GraphQL error. A doc that it cannot read gives a raw HTTP 500 text.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const options = this.getNodeParameter('exportDocOptions', itemIndex, {}) as IDataObject;

	const varDefs = ['$docId: ID!'];
	const args = ['docId: $docId'];
	const variables: Record<string, unknown> = { docId };
	const blockIds = normalizeIdList(options.blockIds);
	if (blockIds.length > 0) {
		varDefs.push('$blockIds: [String!]');
		args.push('blockIds: $blockIds');
		variables.blockIds = blockIds;
	}

	const data = await client.execute(
		`query (${varDefs.join(', ')}) {
			export_markdown_from_doc(${args.join(', ')}) { success markdown error }
		}`,
		itemIndex,
		variables,
	);
	const result = (data.export_markdown_from_doc ?? {}) as IDataObject;
	if (result.success !== true) {
		const error = String(result.error ?? 'Unknown error');
		throw new NodeOperationError(
			this.getNode(),
			`monday.com could not export doc ${docId} as markdown`,
			{
				itemIndex,
				description: error.includes('NON-OK status')
					? 'monday.com could not read the doc. Check that the doc and the block IDs exist.'
					: error,
			},
		);
	}
	return { docId, markdown: result.markdown ?? '' };
}
