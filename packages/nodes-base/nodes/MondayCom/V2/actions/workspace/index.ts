import type { INodeProperties } from 'n8n-workflow';

import * as searchWorkspacesAccount from './searchWorkspacesAccount.operation';

export { searchWorkspacesAccount };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workspace'] } },
		options: [
			{
				name: 'Search',
				value: 'searchWorkspacesAccount',
				action: 'Search workspaces',
				description: 'Find workspaces account-wide by keyword and semantic relevance',
			},
		],
		default: 'searchWorkspacesAccount',
	},
	...searchWorkspacesAccount.description,
];
