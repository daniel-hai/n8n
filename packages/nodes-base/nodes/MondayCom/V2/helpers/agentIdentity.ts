import { isRecord } from '@n8n/utils/is-record';
import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
} from 'n8n-workflow';

import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';
import { isExternalAgentTokenKind } from './agentWebhook';

const ME_QUERY = 'query { me { id name kind email } }';

const UPDATE_WEBHOOK_MUTATION = `mutation ($input: UpdateCustomAgentInput!) {
	update_custom_agent(input: $input) {
		success
		signing_secret
	}
}`;

const SEND_MESSAGE_MUTATION = `mutation ($input: SendCustomAgentMessageInput!) {
	send_custom_agent_message(input: $input) {
		delivered
		message_id
	}
}`;

export interface AgentMe {
	id: string;
	name: string;
	kind: string;
	email: string | null;
}

type AgentContext = IExecuteFunctions | IHookFunctions;

function readMe(data: IDataObject): AgentMe | undefined {
	if (!isRecord(data.me)) return undefined;
	const { id, name, kind, email } = data.me;
	if (typeof id !== 'string' && typeof id !== 'number') return undefined;
	if (typeof kind !== 'string') return undefined;
	return {
		id: String(id),
		name: typeof name === 'string' ? name : '',
		kind,
		email: typeof email === 'string' ? email : null,
	};
}

/** Rejects a user token. Agent trigger and agent actions require an agent token. */
export async function assertAgentToken(
	context: AgentContext,
	client: MondayGraphQLClient,
): Promise<AgentMe> {
	const data = await client.execute(ME_QUERY, 0);
	const me = readMe(data);
	if (!me || !isExternalAgentTokenKind(me.kind)) {
		throw new NodeOperationError(
			context.getNode(),
			'This credential is not a monday.com agent token. Paste the token from the connected agent.',
		);
	}
	return me;
}

/**
 * Points the agent at this node's webhook. A callback change returns a new
 * signing secret. A name-only response returns null and must not wipe the
 * stored secret.
 */
export async function updateAgentWebhook(
	context: AgentContext,
	client: MondayGraphQLClient,
	callbackUrl: string,
): Promise<string> {
	const data = await client.execute(UPDATE_WEBHOOK_MUTATION, 0, {
		input: { callback_url: callbackUrl },
	});
	if (!isRecord(data.update_custom_agent)) {
		throw new NodeOperationError(context.getNode(), 'monday.com did not return the updated agent.');
	}
	const result = data.update_custom_agent;
	if (result.success === false) {
		throw new NodeOperationError(context.getNode(), 'monday.com did not update the agent webhook.');
	}
	if (typeof result.signing_secret !== 'string' || result.signing_secret.length === 0) {
		throw new NodeOperationError(
			context.getNode(),
			'monday.com did not return a signing secret for the new webhook URL.',
		);
	}
	return result.signing_secret;
}

export async function sendCustomAgentMessage(
	client: MondayGraphQLClient,
	itemIndex: number,
	conversationId: string,
	message: string,
): Promise<IDataObject> {
	const data = await client.execute(SEND_MESSAGE_MUTATION, itemIndex, {
		input: {
			conversation_id: conversationId,
			message,
		},
	});
	const result = data.send_custom_agent_message;
	if (!isRecord(result)) return {};
	const output: IDataObject = {};
	if (typeof result.delivered === 'boolean') output.delivered = result.delivered;
	if (typeof result.message_id === 'string' || typeof result.message_id === 'number') {
		output.message_id = String(result.message_id);
	}
	return output;
}
