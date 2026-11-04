import type { INodeProperties } from 'n8n-workflow';

import * as createNotification from './createNotification.operation';

export { createNotification };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['notification'] } },
		options: [
			{
				name: 'Create',
				value: 'createNotification',
				action: 'Create a notification',
				description: 'Send an in-app (bell) notification to users',
			},
		],
		default: 'createNotification',
	},
	...createNotification.description,
];
