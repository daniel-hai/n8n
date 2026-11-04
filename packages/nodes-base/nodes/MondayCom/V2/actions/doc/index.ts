import type { INodeProperties } from 'n8n-workflow';

import * as addDocContent from './addDocContent.operation';
import * as createDoc from './createDoc.operation';
import * as createDocBlock from './createDocBlock.operation';
import * as deleteDoc from './deleteDoc.operation';
import * as deleteDocBlocks from './deleteDocBlocks.operation';
import * as duplicateDoc from './duplicateDoc.operation';
import * as exportDocAsMarkdown from './exportDocAsMarkdown.operation';
import * as getDoc from './getDoc.operation';
import * as getDocBlocks from './getDocBlocks.operation';
import * as getDocs from './getDocs.operation';
import * as importDocFromHtml from './importDocFromHtml.operation';
import * as renameDoc from './renameDoc.operation';
import * as searchDocsAccount from './searchDocsAccount.operation';
import * as updateDocBlock from './updateDocBlock.operation';

export {
	addDocContent,
	createDoc,
	createDocBlock,
	deleteDoc,
	deleteDocBlocks,
	duplicateDoc,
	exportDocAsMarkdown,
	getDoc,
	getDocBlocks,
	getDocs,
	importDocFromHtml,
	renameDoc,
	searchDocsAccount,
	updateDocBlock,
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['doc'] } },
		options: [
			{
				name: 'Add Content',
				value: 'addDocContent',
				action: 'Add content to a doc',
				description: 'Add markdown to a doc. monday.com converts it to doc blocks.',
			},
			{
				name: 'Create',
				value: 'createDoc',
				action: 'Create a doc',
				description: 'Create a doc in a workspace, or in the doc column of an item',
			},
			{
				name: 'Create Block',
				value: 'createDocBlock',
				action: 'Create a doc block',
				description: 'Add one content block to a doc',
			},
			{
				name: 'Delete',
				value: 'deleteDoc',
				action: 'Delete a doc',
				description: 'Delete a doc permanently',
			},
			{
				name: 'Delete Blocks',
				value: 'deleteDocBlocks',
				action: 'Delete doc blocks',
				description: 'Delete one or more blocks from a doc permanently',
			},
			{
				name: 'Duplicate',
				value: 'duplicateDoc',
				action: 'Duplicate a doc',
				description: 'Create a copy of a doc, with its updates if you want',
			},
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
				name: 'Import From HTML',
				value: 'importDocFromHtml',
				action: 'Import a doc from HTML',
				description: 'Create a doc from HTML. monday.com converts the HTML to doc blocks.',
			},
			{
				name: 'Rename',
				value: 'renameDoc',
				action: 'Rename a doc',
				description: 'Change the name of a doc',
			},
			{
				name: 'Search',
				value: 'searchDocsAccount',
				action: 'Search docs',
				description: 'Find docs across the account by keyword and meaning',
			},
			{
				name: 'Update Block',
				value: 'updateDocBlock',
				action: 'Update a doc block',
				description: 'Replace the content of a doc block',
			},
		],
		default: 'getDoc',
	},
	...addDocContent.description,
	...createDoc.description,
	...createDocBlock.description,
	...deleteDoc.description,
	...deleteDocBlocks.description,
	...duplicateDoc.description,
	...exportDocAsMarkdown.description,
	...getDoc.description,
	...getDocBlocks.description,
	...getDocs.description,
	...importDocFromHtml.description,
	...renameDoc.description,
	...searchDocsAccount.description,
	...updateDocBlock.description,
];
