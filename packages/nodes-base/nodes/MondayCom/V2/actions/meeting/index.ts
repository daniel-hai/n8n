import type { INodeProperties } from 'n8n-workflow';

import * as getMeeting from './getMeeting.operation';
import * as getMeetings from './getMeetings.operation';

export { getMeeting, getMeetings };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['meeting'] } },
		options: [
			{
				name: 'Get',
				value: 'getMeeting',
				action: 'Get a meeting',
				description:
					'Return one Notetaker meeting with its summary, topics and action items, and the transcript if requested',
			},
			{
				name: 'Get Many',
				value: 'getMeetings',
				action: 'Get many meetings',
				description: 'Return Notetaker meetings that have a completed recording',
			},
		],
		default: 'getMeetings',
	},
	...getMeeting.description,
	...getMeetings.description,
];
