import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { assertBlockIds, DOC_BLOCK_FIELDS, formatDocBlockRow } from '../../helpers/docs';
import { isPlainJsonObject } from '../../helpers/json';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { blockContentProperties, readBlockContent } from './blockContent';

const properties: INodeProperties[] = [
	{
		displayName: 'Block ID',
		name: 'docBlockId',
		type: 'string',
		default: '',
		required: true,
		description: 'The ID of the block to update. Get the IDs with the Get Blocks operation.',
	},
	...blockContentProperties,
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['updateDocBlock'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** The update echoes the type as a number, so the output leaves the type out. */
const UPDATED_BLOCK_FIELDS = DOC_BLOCK_FIELDS.replace(/^\s*type$/m, '');

/** Doc: Update Block — update_doc_block replaces the content of a block. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const blockId = String(this.getNodeParameter('docBlockId', itemIndex)).trim();
	assertBlockIds.call(this, [blockId], 'Block ID', itemIndex);
	// Text mode builds a text block; the block keeps its type.
	const content = readBlockContent.call(this, 'normal_text', itemIndex);

	const data = await client.execute(
		`mutation ($blockId: String!, $content: JSON!) {
			update_doc_block(block_id: $blockId, content: $content) { ${UPDATED_BLOCK_FIELDS} }
		}`,
		itemIndex,
		{ blockId, content },
	);
	const block = formatDocBlockRow((data.update_doc_block ?? {}) as IDataObject);
	// base64Encoded is the internal editor state. Get Blocks does not return it.
	if (isPlainJsonObject(block.content)) {
		const { base64Encoded: _editorState, ...content } = block.content;
		block.content = content;
	}
	return block;
}
