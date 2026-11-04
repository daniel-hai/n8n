import { type IExecuteFunctions, type INodeProperties, NodeOperationError } from 'n8n-workflow';

import { buildTextBlockContent, normalizeBlockContentJson } from '../../helpers/docs';

/** The content fields of Create Block and Update Block. */
export const blockContentProperties: INodeProperties[] = [
	{
		displayName: 'Content Mode',
		name: 'docBlockContentMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Raw JSON',
				value: 'json',
				description: 'The full block content object as JSON, for example table dimensions',
			},
			{
				name: 'Text',
				value: 'text',
				description: 'Plain text. The node puts it in the block content format.',
			},
		],
		default: 'text',
		description: 'How to give the content of the block',
	},
	{
		displayName: 'Text',
		name: 'docBlockText',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'The text of the block',
		displayOptions: { show: { docBlockContentMode: ['text'] } },
	},
	{
		displayName: 'Content (JSON)',
		name: 'docBlockContentJson',
		type: 'json',
		default: '{\n  "deltaFormat": [{ "insert": "Block text" }]\n}',
		description:
			'The block content object, in the same format as the content field of Get Blocks. For example, a table needs column_count and row_count.',
		displayOptions: { show: { docBlockContentMode: ['json'] } },
	},
];

/** Reads the content fields and returns the content as the JSON string that monday.com needs. */
export function readBlockContent(
	this: IExecuteFunctions,
	blockType: string,
	itemIndex: number,
): string {
	const mode = this.getNodeParameter('docBlockContentMode', itemIndex, 'text') as string;
	if (mode === 'json') {
		const content = normalizeBlockContentJson(
			this.getNodeParameter('docBlockContentJson', itemIndex, ''),
		);
		if (content !== null) return content;
		throw new NodeOperationError(this.getNode(), 'Content (JSON) must be a JSON object', {
			itemIndex,
			description: 'For example {"deltaFormat": [{"insert": "Block text"}]}.',
		});
	}
	const text = this.getNodeParameter('docBlockText', itemIndex, '') as string;
	const content = buildTextBlockContent(blockType, text);
	if (content !== null) return content;
	throw new NodeOperationError(this.getNode(), `A "${blockType}" block needs structured content`, {
		itemIndex,
		description:
			'Set Content Mode to Raw JSON. For example, a table needs column_count and row_count.',
	});
}
