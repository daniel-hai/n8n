import type { INodeProperties } from 'n8n-workflow';

import * as getLimits from './getLimits.operation';
import * as graphql from './graphql.operation';

export { getLimits, graphql };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['graphql'] } },
		options: [
			{
				name: 'Execute Query',
				value: 'graphql',
				// eslint-disable-next-line n8n-nodes-base/node-param-operation-option-action-miscased
				action: 'Execute a GraphQL query',
				description: 'Run a GraphQL query or mutation with the credential of this node',
			},
			{
				name: 'Get Rate Limits',
				value: 'getLimits',
				action: 'Get rate limits',
				description:
					'Return the API budget of the account: the remaining rate limits (also the complexity budget), the quota and the API version',
			},
		],
		default: 'graphql',
	},
	...getLimits.description,
	...graphql.description,
];
