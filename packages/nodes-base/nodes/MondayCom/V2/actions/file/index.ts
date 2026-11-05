import type { INodeProperties } from 'n8n-workflow';

import * as addFileToColumn from './addFileToColumn.operation';
import * as downloadFile from './downloadFile.operation';
import * as getAssets from './getAssets.operation';

export { addFileToColumn, downloadFile, getAssets };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Add to File Column',
				value: 'addFileToColumn',
				action: 'Add a file to a file column',
				description: 'Upload a binary file from the workflow to the file column of an item',
			},
			{
				name: 'Download',
				value: 'downloadFile',
				action: 'Download a file',
				description: 'Download a file into the workflow as binary data',
			},
			{
				name: 'Get Many',
				value: 'getAssets',
				action: 'Get many files',
				description: 'Return file metadata by asset ID, from an item, or from a file column',
			},
		],
		default: 'addFileToColumn',
	},
	...addFileToColumn.description,
	...downloadFile.description,
	...getAssets.description,
];
