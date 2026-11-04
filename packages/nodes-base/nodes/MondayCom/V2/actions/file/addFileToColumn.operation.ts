import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { ASSET_FIELDS, itemNotFoundError } from '../../helpers/assets';
import { boardResourceLocator } from '../../helpers/boardLocator';
import { resolveBinaryUpload } from '../../helpers/fileTransfer';
import { itemResourceLocator } from '../../helpers/itemLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { fileColumnProperty } from '../common.description';

const properties: INodeProperties[] = [
	boardResourceLocator,
	itemResourceLocator,
	{
		...fileColumnProperty,
		description:
			'The file column to add the file to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field that contains the file to upload',
	},
];

const displayOptions = {
	show: {
		resource: ['file'],
		operation: ['addFileToColumn'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * File: Add to File Column — add_file_to_column through the /v2/file
 * multipart endpoint. The file comes from an input binary field.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const itemId = String(
		this.getNodeParameter('itemId', itemIndex, undefined, { extractValue: true }),
	).trim();
	const columnId = String(this.getNodeParameter('fileColumnId', itemIndex)).trim();
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;

	// monday answers a wrong item ID with an internal server error, and it
	// stores a file for a column of another type without attaching it.
	const check = await client.execute(
		`query ($ids: [ID!], $columnIds: [String]) {
			items(ids: $ids) { board { columns(ids: $columnIds) { id title type } } }
		}`,
		itemIndex,
		{ ids: [itemId], columnIds: [columnId] },
	);
	const items = (check.items ?? []) as Array<{
		board?: { columns?: Array<{ title: string; type: string }> } | null;
	}>;
	if (items.length === 0) throw itemNotFoundError.call(this, itemId, itemIndex);
	const column = items[0].board?.columns?.[0];
	if (!column) {
		throw new NodeOperationError(
			this.getNode(),
			`Column ${columnId} was not found on the board of item ${itemId}`,
			{ itemIndex },
		);
	}
	if (column.type !== 'file') {
		throw new NodeOperationError(
			this.getNode(),
			`Column "${column.title}" (${columnId}) is a ${column.type} column, not a file column`,
			{ itemIndex, description: 'Choose a file column.' },
		);
	}

	// Streamed from binary storage when possible: monday accepts files up to 500 MB.
	const upload = await resolveBinaryUpload(this, itemIndex, binaryPropertyName);

	const data = await client.uploadFile(
		`mutation ($file: File!, $itemId: ID!, $columnId: String!) {
			add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { ${ASSET_FIELDS} }
		}`,
		upload.body,
		upload.fileName,
		upload.mimeType,
		upload.contentLength,
		{ itemId, columnId },
	);
	return { ...((data.add_file_to_column ?? {}) as IDataObject), itemId, columnId };
}
