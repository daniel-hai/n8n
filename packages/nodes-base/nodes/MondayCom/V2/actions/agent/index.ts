import type { INodeProperties } from 'n8n-workflow';

import * as replyToMention from './replyToMention.operation';
import * as sendChatMessage from './sendChatMessage.operation';

export { replyToMention, sendChatMessage };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['agent'] } },
		options: [
			{
				name: 'Reply to Mention',
				value: 'replyToMention',
				action: 'Reply to an agent mention',
				description: 'Post a threaded update on the item where the agent was mentioned',
			},
			{
				name: 'Send Chat Message',
				value: 'sendChatMessage',
				action: 'Send an agent chat message',
				description: 'Deliver a chat reply after the agent webhook has returned',
			},
		],
		default: 'sendChatMessage',
	},
	...replyToMention.description,
	...sendChatMessage.description,
];
