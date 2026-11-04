import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import { assertBlockIds, assertDocMutationSucceeded, requireDocId } from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Markdown',
		name: 'docMarkdown',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		description:
			'The markdown to add. monday.com converts headings, bold and italic text, lists, quotes and code to doc blocks.',
	},
	{
		displayName: 'Options',
		name: 'addDocContentOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'After Block ID',
				name: 'afterBlockId',
				type: 'string',
				default: '',
				description:
					'Add the content after this block (get the ID with Get Blocks). If empty, the node adds the content at the end of the doc.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['addDocContent'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Add Content — add_content_to_doc_from_markdown. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const markdown = this.getNodeParameter('docMarkdown', itemIndex) as string;
	const options = this.getNodeParameter('addDocContentOptions', itemIndex, {}) as IDataObject;
	const afterBlockId = String(options.afterBlockId ?? '').trim();

	const varDefs = ['$docId: ID!', '$markdown: String!'];
	const args = ['docId: $docId', 'markdown: $markdown'];
	const variables: Record<string, unknown> = { docId, markdown };
	if (afterBlockId) {
		assertBlockIds.call(this, [afterBlockId], 'After Block ID', itemIndex);
		varDefs.push('$afterBlockId: String');
		args.push('afterBlockId: $afterBlockId');
		variables.afterBlockId = afterBlockId;
	}

	let data: IDataObject;
	try {
		data = await client.execute(
			`mutation (${varDefs.join(', ')}) {
				add_content_to_doc_from_markdown(${args.join(', ')}) { success block_ids error }
			}`,
			itemIndex,
			variables,
		);
	} catch (error) {
		// monday answers an After Block ID that is not in the doc with HTTP 500.
		if (!afterBlockId) throw error;
		const reason = error instanceof Error ? ` monday.com said: ${error.message}.` : '';
		throw new NodeOperationError(
			this.getNode(),
			`monday.com could not add the content after block ${afterBlockId}`,
			{
				itemIndex,
				description: `Check that the block is in doc ${docId}. Get the IDs with the Get Blocks operation.${reason}`,
			},
		);
	}
	const result = (data.add_content_to_doc_from_markdown ?? {}) as IDataObject;
	assertDocMutationSucceeded.call(this, result, `add the content to doc ${docId}`, itemIndex);
	return { docId, blockIds: result.block_ids ?? [] };
}
