import { isRecord } from '@n8n/utils/is-record';
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { assertAgentToken } from '../../helpers/agentIdentity';
import { MONDAY_AGENTS_API_VERSION, readId } from '../../helpers/agentWebhook';
import { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const CREATE_UPDATE = `mutation ($itemId: ID!, $body: String!, $parentId: ID) {
	create_update(item_id: $itemId, body: $body, parent_id: $parentId) {
		id
	}
}`;

const properties: INodeProperties[] = [
	{
		displayName:
			'Use the agent API token. The update is posted as the agent. Set Update ID to reply in the mention thread.',
		name: 'mentionNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['agent'], operation: ['replyToMention'] } },
	},
	{
		displayName: 'Item ID',
		name: 'itemId',
		type: 'string',
		required: true,
		default: '={{ $json.payload.itemId }}',
		description: 'The item the agent was mentioned on or assigned to',
		displayOptions: { show: { resource: ['agent'], operation: ['replyToMention'] } },
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		required: true,
		typeOptions: { rows: 4 },
		default: '',
		description: 'The update text posted as the agent',
		displayOptions: { show: { resource: ['agent'], operation: ['replyToMention'] } },
	},
	{
		displayName: 'Update ID',
		name: 'updateId',
		type: 'string',
		default: '={{ $json.payload.updateId }}',
		description: 'The mention update. The reply is threaded under this update.',
		displayOptions: { show: { resource: ['agent'], operation: ['replyToMention'] } },
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
	// Expressions return numbers for monday IDs, so read each ID as string or number.
	const itemId = readId(this.getNodeParameter('itemId', itemIndex));
	const message = this.getNodeParameter('message', itemIndex) as string;
	const updateId = readId(this.getNodeParameter('updateId', itemIndex, ''));
	if (!itemId) {
		throw new NodeOperationError(this.getNode(), 'Item ID is required', { itemIndex });
	}
	const data = await client.execute(CREATE_UPDATE, itemIndex, {
		itemId,
		body: message,
		parentId: updateId ?? null,
	});
	const created = data.create_update;
	if (!isRecord(created)) return {};
	const output: IDataObject = {};
	if (typeof created.id === 'string' || typeof created.id === 'number')
		output.id = String(created.id);
	return output;
}
