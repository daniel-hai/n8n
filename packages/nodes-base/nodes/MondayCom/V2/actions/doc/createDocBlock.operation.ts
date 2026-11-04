import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import {
	assertBlockIds,
	DOC_BLOCK_FIELDS,
	DOC_BLOCK_TYPE_OPTIONS,
	formatDocBlockRow,
	requireDocId,
} from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { blockContentProperties, readBlockContent } from './blockContent';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Block Type',
		name: 'docBlockType',
		type: 'options',
		options: DOC_BLOCK_TYPE_OPTIONS,
		default: 'normal_text',
		description:
			'The type of block to create. Table, layout, image, video and notice box need the Raw JSON content mode.',
	},
	...blockContentProperties,
	{
		displayName: 'Options',
		name: 'createDocBlockOptions',
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
					'Put the new block after this block (get the ID with Get Blocks). If empty, the node puts it at the top of the doc.',
			},
			{
				displayName: 'Parent Block ID',
				name: 'parentBlockId',
				type: 'string',
				default: '',
				description: 'Put the new block in this block, for example in a table cell or a layout',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['createDocBlock'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Create Block — create_doc_block. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const blockType = this.getNodeParameter('docBlockType', itemIndex) as string;
	if (!DOC_BLOCK_TYPE_OPTIONS.some((option) => option.value === blockType)) {
		throw new NodeOperationError(this.getNode(), `Block type "${blockType}" is not supported`, {
			itemIndex,
			description: 'Choose a value from the list.',
		});
	}
	const content = readBlockContent.call(this, blockType, itemIndex);
	const options = this.getNodeParameter('createDocBlockOptions', itemIndex, {}) as IDataObject;
	const docId = await requireDocId.call(this, client, itemIndex);

	const varDefs = ['$docId: ID!', '$type: DocBlockContentType!', '$content: JSON!'];
	const args = ['doc_id: $docId', 'type: $type', 'content: $content'];
	const variables: Record<string, unknown> = { docId, type: blockType, content };
	for (const [option, argument, label] of [
		['afterBlockId', 'after_block_id', 'After Block ID'],
		['parentBlockId', 'parent_block_id', 'Parent Block ID'],
	]) {
		const blockId = String(options[option] ?? '').trim();
		if (!blockId) continue;
		assertBlockIds.call(this, [blockId], label, itemIndex);
		varDefs.push(`$${option}: String`);
		args.push(`${argument}: $${option}`);
		variables[option] = blockId;
	}

	const data = await client.execute(
		`mutation (${varDefs.join(', ')}) { create_doc_block(${args.join(', ')}) { ${DOC_BLOCK_FIELDS} } }`,
		itemIndex,
		variables,
	);
	return formatDocBlockRow((data.create_doc_block ?? {}) as IDataObject);
}
