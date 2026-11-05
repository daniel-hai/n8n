import type { IDataObject, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import type { MondayTriggerEvent } from './types';
import { assertAgentToken, updateAgentWebhook } from '../V2/helpers/agentIdentity';
import {
	MONDAY_AGENTS_API_VERSION,
	buildAgentAck,
	buildChatFields,
	normalizeTriggerType,
	readHeader,
	resolveSelectedTriggerTypes,
	verifyAgentSignature,
} from '../V2/helpers/agentWebhook';
import { MondayGraphQLClient } from '../V2/transport/MondayGraphQLClient';

export const AGENT_EVENT = 'agent_interaction';

interface AgentStaticData {
	signingSecret?: string;
	callbackUrl?: string;
	agentName?: string;
	agentUserId?: string;
}

function readStatic(data: IDataObject): AgentStaticData {
	return {
		signingSecret: typeof data.signingSecret === 'string' ? data.signingSecret : undefined,
		callbackUrl: typeof data.callbackUrl === 'string' ? data.callbackUrl : undefined,
		agentName: typeof data.agentName === 'string' ? data.agentName : undefined,
		agentUserId: typeof data.agentUserId === 'string' ? data.agentUserId : undefined,
	};
}

function rawBodyOf(req: { rawBody?: Buffer | string; body?: unknown }): Buffer | string {
	if (Buffer.isBuffer(req.rawBody) || typeof req.rawBody === 'string') return req.rawBody;
	return JSON.stringify(req.body ?? {});
}

/** Answers monday before the workflow runs. The reply goes out later by API call. */
function ack(context: IWebhookFunctions, stream: boolean): void {
	const response = context.getResponseObject();
	const built = buildAgentAck(stream);
	response.status(200);
	response.setHeader('Content-Type', built.contentType);
	if (typeof built.body === 'string') {
		response.setHeader('Cache-Control', 'no-cache');
		response.send(built.body);
		return;
	}
	response.json(built.body);
}

export const agentInteractionEvent: MondayTriggerEvent = {
	async checkExists() {
		const data = readStatic(this.getWorkflowStaticData('node'));
		const url = this.getNodeWebhookUrl('default');
		return Boolean(data.signingSecret && data.callbackUrl && data.callbackUrl === url);
	},

	async create() {
		const url = this.getNodeWebhookUrl('default');
		if (!url) {
			throw new NodeOperationError(this.getNode(), 'The webhook URL is not available.');
		}
		if (this.getNodeParameter('authentication', 'accessToken') === 'oAuth2') {
			throw new NodeOperationError(this.getNode(), 'Agent Interaction needs an agent token', {
				description: 'Set Authentication to Access Token and select the agent API token.',
			});
		}
		const client = new MondayGraphQLClient(this, MONDAY_AGENTS_API_VERSION);
		const me = await assertAgentToken(this, client);
		const signingSecret = await updateAgentWebhook(this, client, url);
		const staticData = this.getWorkflowStaticData('node');
		staticData.signingSecret = signingSecret;
		staticData.callbackUrl = url;
		staticData.agentName = me.name;
		staticData.agentUserId = me.id;
		return true;
	},

	// The agent callback on monday stays as it is. Only the stored secret is cleared.
	async delete() {
		const staticData = this.getWorkflowStaticData('node');
		delete staticData.signingSecret;
		delete staticData.callbackUrl;
		delete staticData.agentName;
		delete staticData.agentUserId;
		return true;
	},

	async webhook(): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const staticData = readStatic(this.getWorkflowStaticData('node'));
		const headers = req.headers ?? {};
		const rawBody = rawBodyOf(req);

		if (!staticData.signingSecret) {
			this.getResponseObject().status(401).json({ error: 'The agent webhook is not registered.' });
			return { noWebhookResponse: true };
		}

		const valid = verifyAgentSignature(
			staticData.signingSecret,
			rawBody,
			readHeader(headers, 'x-monday-timestamp'),
			readHeader(headers, 'x-monday-signature'),
		);
		if (!valid) {
			this.getResponseObject().status(401).json({ error: 'The agent signature is not valid.' });
			return { noWebhookResponse: true };
		}

		const parsed: unknown =
			req.body && typeof req.body === 'object'
				? req.body
				: jsonParse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
		const body = parsed && typeof parsed === 'object' ? (parsed as IDataObject) : {};
		const triggerType = normalizeTriggerType(body.triggerType);
		const stream = body.stream !== false;
		// Outputs follow the selected types, so the item goes to the index in this list.
		const active = resolveSelectedTriggerTypes(this.getNodeParameter('triggerTypes', []));

		ack(this, triggerType === 'chat' ? stream : false);

		if (triggerType === 'unknown') return { noWebhookResponse: true };
		const outputIndex = active.indexOf(triggerType);
		if (outputIndex === -1) return { noWebhookResponse: true };

		const payload =
			body.payload && typeof body.payload === 'object' ? (body.payload as IDataObject) : {};
		const conversationId = payload.conversationId;
		const item: IDataObject = {
			...buildChatFields(triggerType, payload),
			triggerType,
			text: typeof payload.text === 'string' ? payload.text : '',
			payload,
			timestamp: typeof body.timestamp === 'string' ? body.timestamp : '',
			stream,
			agentId: readHeader(headers, 'x-monday-agent-id') ?? '',
			agentName: staticData.agentName ?? '',
			agentUserId: staticData.agentUserId ?? '',
		};
		if (typeof conversationId === 'string') item.conversationId = conversationId;

		const outputs: IDataObject[][] = active.map(() => []);
		outputs[outputIndex] = [item];

		return {
			workflowData: outputs.map((rows) => rows.map((json) => ({ json }))),
			noWebhookResponse: true,
		};
	},
};
