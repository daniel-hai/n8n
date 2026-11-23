import type { INodeProperties } from 'n8n-workflow';

import * as exportDocAsMarkdown from './exportDocAsMarkdown.operation';
import * as getDoc from './getDoc.operation';
import * as getDocBlocks from './getDocBlocks.operation';
import * as getDocs from './getDocs.operation';
import * as searchDocsAccount from './searchDocsAccount.operation';

export { exportDocAsMarkdown, getDoc, getDocBlocks, getDocs, searchDocsAccount };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['doc'] } },
		options: [
			{
				name: 'Export as Markdown',
				value: 'exportDocAsMarkdown',
				action: 'Export a doc as markdown',
				description: 'Return the content of a doc, or of some blocks, as markdown',
			},
			{
				name: 'Get',
				value: 'getDoc',
				action: 'Get a doc',
				description: 'Return the metadata of a doc, with its content blocks if requested',
			},
			{
				name: 'Get Blocks',
				value: 'getDocBlocks',
				action: 'Get doc blocks',
				description: 'Return the content blocks of a doc, one output item for each block',
			},
			{
				name: 'Get Many',
				value: 'getDocs',
				action: 'Get many docs',
				description: 'Return the docs of the account, filtered by workspace or IDs if you want',
			},
			{
				name: 'Search',
				value: 'searchDocsAccount',
				action: 'Search docs',
				description: 'Find docs across the account by keyword and meaning',
			},
		],
		default: 'getDoc',
	},
	...exportDocAsMarkdown.description,
	...getDoc.description,
	...getDocBlocks.description,
	...getDocs.description,
	...searchDocsAccount.description,
];
