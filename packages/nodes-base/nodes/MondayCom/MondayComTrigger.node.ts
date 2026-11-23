import type {
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { AGENT_EVENT, agentInteractionEvent } from './triggerEvents/agentInteraction';
import {
	BOARD_EVENT_VALUES,
	BOARD_EVENTS_WITH_ITEM,
	COMBINED_EVENT_VALUES,
	boardEvent,
	boardEventOptions,
	isBoardEvent,
} from './triggerEvents/boardEvents';
import type { MondayTriggerEvent } from './triggerEvents/types';
import { AGENT_TRIGGER_TYPES } from './V2/helpers/agentWebhook';
import { boardResourceLocator, searchBoards } from './V2/helpers/boardLocator';
import { getBoardColumns, getBoardLabelColumns, getColumnLabels } from './V2/helpers/columnOptions';
import { getBoardGroups } from './V2/helpers/groupLocator';

function getHandler(
	context: IHookFunctions | IWebhookFunctions,
	event: unknown,
): MondayTriggerEvent {
	if (event === AGENT_EVENT) return agentInteractionEvent;
	if (isBoardEvent(event)) return boardEvent;
	throw new NodeOperationError(context.getNode(), 'This trigger event is not supported.');
}

export class MondayComTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Monday.com Trigger',
		name: 'mondayComTrigger',
		icon: 'file:mondayCom.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when a monday.com event happens',
		defaults: {
			name: 'Monday.com Trigger',
		},
		inputs: [],
		// The outputs depend on the event. An agent event has one output for each selected
		// trigger type. An item event that watches all items has Items and Subitems outputs.
		// Other events have one output. The expression cannot use imports.
		outputs: `={{((event, types, scope) => {
			if (${JSON.stringify(COMBINED_EVENT_VALUES)}.includes(event)) {
				if (scope === 'top') return [{ type: 'main', displayName: 'Items' }];
				if (scope === 'subitems') return [{ type: 'main', displayName: 'Subitems' }];
				return [{ type: 'main', displayName: 'Items' }, { type: 'main', displayName: 'Subitems' }];
			}
			if (event !== '${AGENT_EVENT}') return [{ type: 'main' }];
			const order = ['chat', 'mention', 'assigned'];
			const labels = { chat: 'Chat', mention: 'Mention', assigned: 'Assigned' };
			const selected = Array.isArray(types) ? types : [];
			const active = order.filter((type) => selected.includes(type));
			return (active.length > 0 ? active : order).map((type) => ({ type: 'main', displayName: labels[type] }));
		})($parameter["event"], $parameter["triggerTypes"], $parameter["itemScope"])}}`,
		credentials: [
			{
				name: 'mondayComApi',
				required: true,
				displayOptions: { show: { authentication: ['accessToken'] } },
			},
			{
				name: 'mondayComOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'Access Token', value: 'accessToken' },
					{ name: 'OAuth2', value: 'oAuth2' },
				],
				default: 'accessToken',
			},
			{
				// The node creator reads this property to list the events under the Monday.com node.
				displayName: 'Trigger On',
				name: 'event',
				type: 'options',
				default: 'create_item',
				required: true,
				description: 'The monday.com event that starts the workflow',
				options: [
					{
						name: 'Agent Interaction (Beta)',
						value: AGENT_EVENT,
						action: 'On agent interaction',
						description: 'When a monday.com agent gets a chat message, a mention, or an assignment',
					},
					...boardEventOptions,
				],
			},
			{
				displayName:
					'Use the agent API token, not a user token. On activation this node checks the token and sets the agent webhook to this URL. The URL must be public HTTPS. monday.com rejects localhost. Each output has chatInput and sessionId, so you can connect an AI Agent with "Connected Chat Trigger Node" as the prompt source.',
				name: 'agentNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { event: [AGENT_EVENT] } },
			},
			{
				displayName: 'Trigger Types',
				name: 'triggerTypes',
				type: 'multiOptions',
				default: [...AGENT_TRIGGER_TYPES],
				description:
					'The agent events that start the workflow. Each selected type has its own output.',
				options: [
					{ name: 'Assigned', value: 'assigned' },
					{ name: 'Chat', value: 'chat' },
					{ name: 'Mention', value: 'mention' },
				],
				displayOptions: { show: { event: [AGENT_EVENT] } },
			},
			{
				...boardResourceLocator,
				description: 'The board to watch',
				displayOptions: { show: { event: BOARD_EVENT_VALUES } },
			},
			{
				displayName: 'Items to Watch',
				name: 'itemScope',
				type: 'options',
				options: [
					{
						name: 'All Items',
						value: 'all',
						description:
							'Top-level items go to the Items output. Subitems go to the Subitems output.',
					},
					{
						name: 'Subitems Only',
						value: 'subitems',
						description: 'Only subitems of the items on the board',
					},
					{
						name: 'Top-Level Items Only',
						value: 'top',
						description: 'Only the items directly on the board',
					},
				],
				default: 'all',
				description: 'The item levels that start the workflow. The outputs follow this selection.',
				displayOptions: { show: { event: COMBINED_EVENT_VALUES } },
			},
			{
				displayName: 'Column Name or ID',
				name: 'columnId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getBoardColumns',
					loadOptionsDependsOn: ['boardId.value'],
				},
				default: '',
				required: true,
				description:
					'The column to watch. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['change_specific_column_value'] } },
			},
			{
				displayName: 'Status Column Name or ID',
				name: 'labelColumnId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getBoardLabelColumns',
					loadOptionsDependsOn: ['boardId.value'],
				},
				default: '',
				required: true,
				description:
					'The status column to watch. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['change_status_column_value'] } },
			},
			{
				displayName: 'Status Label Name or ID',
				name: 'statusLabel',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getColumnLabels',
					loadOptionsDependsOn: ['boardId.value', 'labelColumnId'],
				},
				default: '',
				required: true,
				description:
					'The workflow starts when the column changes to this label. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['change_status_column_value'] } },
			},
			{
				displayName: 'Group Name or ID',
				name: 'groupId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getBoardGroups',
					loadOptionsDependsOn: ['boardId.value'],
				},
				default: '',
				required: true,
				description:
					'The workflow starts when an item moves to this group. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['item_moved_to_specific_group'] } },
			},
			{
				displayName: 'Include Item Details',
				name: 'includeItem',
				type: 'boolean',
				default: false,
				description:
					"Whether to add the item's name, group and column values to the output. This uses one more API call for each event.",
				displayOptions: { show: { event: BOARD_EVENTS_WITH_ITEM } },
			},
		],
	};

	methods = {
		listSearch: { searchBoards },
		loadOptions: { getBoardColumns, getBoardGroups, getBoardLabelColumns, getColumnLabels },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return await getHandler(this, this.getNodeParameter('event')).checkExists.call(this);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				return await getHandler(this, this.getNodeParameter('event')).create.call(this);
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return await getHandler(this, this.getNodeParameter('event')).delete.call(this);
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return await getHandler(this, this.getNodeParameter('event')).webhook.call(this);
	}
}
