import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { assertAgentToken, sendCustomAgentMessage } from '../../helpers/agentIdentity';
import { MONDAY_AGENTS_API_VERSION } from '../../helpers/agentWebhook';
import { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName:
			'Use the agent API token. This operation calls send_custom_agent_message. Take Conversation ID from the Agent Trigger chat output.',
		name: 'agentNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['agent'], operation: ['sendChatMessage'] } },
	},
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		required: true,
		default: '={{ $("Monday.com Trigger").first().json.conversationId }}',
		description:
			'The conversationId from the agent chat webhook. Pass it through unchanged. The default reads it from the node named "Monday.com Trigger". If you rename that node, update the expression.',
		displayOptions: { show: { resource: ['agent'], operation: ['sendChatMessage'] } },
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		required: true,
		typeOptions: { rows: 4 },
		default: '={{ $json.output }}',
		description: 'The text the user sees in the agent chat. The default is the AI Agent output.',
		displayOptions: { show: { resource: ['agent'], operation: ['sendChatMessage'] } },
	},
];

export const description = properties;

export async function execute(
	this: IExecuteFunctions,
	_client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const client = new MondayGraphQLClient(this, MONDAY_AGENTS_API_VERSION);
	await assertAgentToken(this, client);
	const conversationId = this.getNodeParameter('conversationId', itemIndex) as string;
	const message = this.getNodeParameter('message', itemIndex) as string;
	return await sendCustomAgentMessage(client, itemIndex, conversationId, message);
}
