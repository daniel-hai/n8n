import { isRecord } from '@n8n/utils/is-record';
import type {
	IDataObject,
	IHookFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import type { MondayTriggerEvent } from './types';
import { MondayGraphQLClient } from '../V2/transport/MondayGraphQLClient';

/** The filter that a board event needs in its webhook config. */
type EventFilter = 'column' | 'statusLabel' | 'group';

export type ItemScope = 'all' | 'top' | 'subitems';

interface BoardEventDefinition {
	name: string;
	value: string;
	description: string;
	/** The monday.com event for the same change on a subitem. The node then asks which items to watch. */
	subitemEvent?: string;
	filter?: EventFilter;
	/** False when the item no longer exists after the event, so it cannot be fetched. */
	itemAvailable: boolean;
}

/**
 * The options cover all 21 values of the monday.com WebhookEventType enum, verified live 2026-11.
 * Six options combine an item event with its subitem event.
 */
const BOARD_EVENTS: BoardEventDefinition[] = [
	{
		name: 'Column Created',
		value: 'create_column',
		description: 'When a column is added to the board',
		itemAvailable: false,
	},
	{
		name: 'Column Value Changed',
		value: 'change_column_value',
		subitemEvent: 'change_subitem_column_value',
		description: 'When a column value of an item or a subitem changes',
		itemAvailable: true,
	},
	{
		name: 'Item Archived',
		value: 'item_archived',
		subitemEvent: 'subitem_archived',
		description: 'When an item or a subitem is archived',
		itemAvailable: true,
	},
	{
		name: 'Item Created',
		value: 'create_item',
		subitemEvent: 'create_subitem',
		description: 'When an item or a subitem is created',
		itemAvailable: true,
	},
	{
		name: 'Item Deleted',
		value: 'item_deleted',
		subitemEvent: 'subitem_deleted',
		description: 'When an item or a subitem is deleted',
		itemAvailable: false,
	},
	{
		name: 'Item Moved to Any Group',
		value: 'item_moved_to_any_group',
		description: 'When an item moves to a different group',
		itemAvailable: true,
	},
	{
		name: 'Item Moved to Specific Group',
		value: 'item_moved_to_specific_group',
		description: 'When an item moves to the selected group',
		filter: 'group',
		itemAvailable: true,
	},
	{
		name: 'Item Name Changed',
		value: 'change_name',
		subitemEvent: 'change_subitem_name',
		description: 'When an item or a subitem is renamed',
		itemAvailable: true,
	},
	{
		name: 'Item Restored',
		value: 'item_restored',
		description: 'When an archived or deleted item is restored',
		itemAvailable: true,
	},
	{
		name: 'Specific Column Value Changed',
		value: 'change_specific_column_value',
		description: 'When the value of the selected column changes',
		filter: 'column',
		itemAvailable: true,
	},
	{
		name: 'Status Changed to Label',
		value: 'change_status_column_value',
		description: 'When the selected status column changes to the selected label',
		filter: 'statusLabel',
		itemAvailable: true,
	},
	{
		name: 'Subitem Moved',
		value: 'move_subitem',
		description: 'When a subitem moves',
		itemAvailable: true,
	},
	{
		name: 'Update Deleted',
		value: 'delete_update',
		description: 'When an update on an item is deleted',
		itemAvailable: true,
	},
	{
		name: 'Update Edited',
		value: 'edit_update',
		description: 'When an update on an item is edited',
		itemAvailable: true,
	},
	{
		name: 'Update Posted',
		value: 'create_update',
		subitemEvent: 'create_subitem_update',
		description: 'When an update is posted on an item or a subitem',
		itemAvailable: true,
	},
];

const BOARD_EVENTS_BY_VALUE = new Map(BOARD_EVENTS.map((event) => [event.value, event]));

export const BOARD_EVENT_VALUES = BOARD_EVENTS.map((event) => event.value);

/** Events that watch items and subitems. The outputs expression of the node repeats this list. */
export const COMBINED_EVENT_VALUES = BOARD_EVENTS.filter((event) => event.subitemEvent).map(
	(event) => event.value,
);

/** Every monday.com webhook event that the trigger can register. */
export const MONDAY_WEBHOOK_EVENTS = BOARD_EVENTS.flatMap((event) =>
	event.subitemEvent ? [event.value, event.subitemEvent] : [event.value],
);

export const BOARD_EVENTS_WITH_ITEM = BOARD_EVENTS.filter((event) => event.itemAvailable).map(
	(event) => event.value,
);

export const boardEventOptions: INodePropertyOptions[] = BOARD_EVENTS.map((event) => ({
	name: event.name,
	value: event.value,
	action: `On ${event.name.charAt(0).toLowerCase()}${event.name.slice(1)}`,
	description: event.description,
}));

export function isBoardEvent(event: unknown): event is string {
	return typeof event === 'string' && BOARD_EVENTS_BY_VALUE.has(event);
}

const CREATE_WEBHOOK_MUTATION = `mutation ($boardId: ID!, $url: String!, $event: WebhookEventType!, $config: JSON) {
	create_webhook(board_id: $boardId, url: $url, event: $event, config: $config) { id }
}`;

const DELETE_WEBHOOK_MUTATION = `mutation ($id: ID!) {
	delete_webhook(id: $id) { id }
}`;

const LIST_WEBHOOKS_QUERY = `query ($boardId: ID!) {
	webhooks(board_id: $boardId) { id }
}`;

const ITEM_QUERY = `query ($ids: [ID!]) {
	items(ids: $ids) {
		id name state created_at updated_at
		board { id name }
		group { id title }
		parent_item { id }
		column_values { id type text value }
	}
}`;

interface WebhookSubscription {
	event: string;
	config?: IDataObject;
}

interface BoardSubscription {
	boardId: string;
	webhooks: WebhookSubscription[];
}

function readScope(context: IHookFunctions | IWebhookFunctions): ItemScope {
	const scope = context.getNodeParameter('itemScope', 'all');
	return scope === 'top' || scope === 'subitems' ? scope : 'all';
}

/** Reads the node parameters into the webhooks that monday.com must hold. */
export function readSubscription(context: IHookFunctions): BoardSubscription {
	const event = String(context.getNodeParameter('event'));
	const definition = BOARD_EVENTS_BY_VALUE.get(event);
	if (!definition) {
		throw new NodeOperationError(context.getNode(), 'This trigger event is not supported.');
	}
	const boardId = String(context.getNodeParameter('boardId', '', { extractValue: true }));
	if (!boardId) {
		throw new NodeOperationError(context.getNode(), 'Select a board.');
	}
	if (definition.subitemEvent) {
		const scope = readScope(context);
		const events = [
			...(scope === 'subitems' ? [] : [event]),
			...(scope === 'top' ? [] : [definition.subitemEvent]),
		];
		return { boardId, webhooks: events.map((name) => ({ event: name })) };
	}
	const webhook: WebhookSubscription = { event };
	if (definition.filter === 'column') {
		webhook.config = { columnId: String(context.getNodeParameter('columnId')) };
	} else if (definition.filter === 'statusLabel') {
		webhook.config = {
			columnId: String(context.getNodeParameter('labelColumnId')),
			columnValue: { index: Number(context.getNodeParameter('statusLabel')) },
		};
	} else if (definition.filter === 'group') {
		webhook.config = { groupId: String(context.getNodeParameter('groupId')) };
	}
	return { boardId, webhooks: [webhook] };
}

/** A change of URL, board, event, scope or filter must replace the webhooks on monday.com. */
function subscriptionKey(subscription: BoardSubscription, url: string): string {
	return JSON.stringify({ ...subscription, url });
}

function readWebhookIds(staticData: IDataObject): string[] {
	const ids = staticData.webhookIds;
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function errorText(error: unknown): string {
	if (error instanceof NodeApiError) return `${error.message} ${error.description ?? ''}`;
	return error instanceof Error ? error.message : '';
}

/** Turns the two registration errors that monday.com returns as raw keys into instructions. */
function explainCreateError(context: IHookFunctions, error: unknown): Error {
	const text = errorText(error);
	if (text.includes('webhooks.errors.communication')) {
		return new NodeOperationError(context.getNode(), 'monday.com could not reach the webhook URL', {
			description:
				'monday.com sends a challenge request to the URL when the workflow is activated. Use a public HTTPS URL. monday.com cannot reach localhost.',
		});
	}
	if (text.includes('missing_subitems_board')) {
		return new NodeOperationError(context.getNode(), 'This board has no subitems', {
			description:
				'monday.com accepts subitem events only on a board that has subitems. Add a subitem to the board, or set Items to Watch to Top-Level Items Only. Then activate the workflow again.',
		});
	}
	return error instanceof Error ? error : new NodeOperationError(context.getNode(), text);
}

async function deleteRemoteWebhooks(client: MondayGraphQLClient, ids: string[]): Promise<void> {
	for (const id of ids) {
		try {
			await client.execute(DELETE_WEBHOOK_MUTATION, 0, { id });
		} catch {
			// monday.com returns an error for a webhook that is already gone. Deactivation must still succeed.
		}
	}
}

/** monday.com returns JSON, so a plain object from a response is a valid IDataObject. */
function isDataObject(value: unknown): value is IDataObject {
	return isRecord(value);
}

async function fetchItem(
	context: IWebhookFunctions,
	itemId: string,
): Promise<IDataObject | undefined> {
	const client = new MondayGraphQLClient(context);
	const data = await client.execute(ITEM_QUERY, 0, { ids: [itemId] });
	const item: unknown = Array.isArray(data.items) ? data.items[0] : undefined;
	return isDataObject(item) ? item : undefined;
}

/** Item and subitem events use pulseId. Archive and delete events use itemId. */
function readItemId(event: IDataObject): string | undefined {
	const id = event.pulseId ?? event.itemId;
	return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

export const boardEvent: MondayTriggerEvent = {
	async checkExists() {
		const staticData = this.getWorkflowStaticData('node');
		const url = this.getNodeWebhookUrl('default') ?? '';
		const subscription = readSubscription(this);
		const ids = readWebhookIds(staticData);
		if (ids.length === 0 || staticData.subscriptionKey !== subscriptionKey(subscription, url)) {
			return false;
		}
		const client = new MondayGraphQLClient(this);
		try {
			const data = await client.execute(LIST_WEBHOOKS_QUERY, 0, {
				boardId: subscription.boardId,
			});
			const remote = new Set(
				(Array.isArray(data.webhooks) ? data.webhooks : []).map((webhook: unknown) =>
					isRecord(webhook) ? String(webhook.id) : '',
				),
			);
			return ids.every((id) => remote.has(id));
		} catch {
			return false;
		}
	},

	async create() {
		const url = this.getNodeWebhookUrl('default');
		if (!url) {
			throw new NodeOperationError(this.getNode(), 'The webhook URL is not available.');
		}
		const subscription = readSubscription(this);
		const staticData = this.getWorkflowStaticData('node');
		const client = new MondayGraphQLClient(this);
		// A changed parameter leaves the old webhooks on monday.com. Remove them to stop duplicate runs.
		await deleteRemoteWebhooks(client, readWebhookIds(staticData));
		delete staticData.webhookIds;
		delete staticData.subscriptionKey;

		const created: string[] = [];
		for (const webhook of subscription.webhooks) {
			let data: IDataObject;
			try {
				data = await client.execute(CREATE_WEBHOOK_MUTATION, 0, {
					boardId: subscription.boardId,
					url,
					event: webhook.event,
					config: webhook.config ? JSON.stringify(webhook.config) : undefined,
				});
			} catch (error) {
				// Do not leave half of an item and subitem pair on monday.com.
				await deleteRemoteWebhooks(client, created);
				throw explainCreateError(this, error);
			}
			const result = data.create_webhook;
			if (!isRecord(result) || result.id === undefined || result.id === null) {
				await deleteRemoteWebhooks(client, created);
				throw new NodeOperationError(this.getNode(), 'monday.com did not return the new webhook.');
			}
			created.push(String(result.id));
		}
		staticData.webhookIds = created;
		staticData.subscriptionKey = subscriptionKey(subscription, url);
		return true;
	},

	async delete() {
		const staticData = this.getWorkflowStaticData('node');
		await deleteRemoteWebhooks(new MondayGraphQLClient(this), readWebhookIds(staticData));
		delete staticData.webhookIds;
		delete staticData.subscriptionKey;
		return true;
	},

	async webhook(): Promise<IWebhookResponseData> {
		const body: unknown = this.getBodyData();
		// monday.com sends a challenge once, when the webhook is created, and expects it back.
		if (isRecord(body) && typeof body.challenge === 'string') {
			this.getResponseObject().status(200).json({ challenge: body.challenge });
			return { noWebhookResponse: true };
		}
		if (!isRecord(body) || !isDataObject(body.event)) return {};

		const json: IDataObject = { ...body.event };
		const event = String(this.getNodeParameter('event'));
		const includeItem =
			BOARD_EVENTS_WITH_ITEM.includes(event) &&
			this.getNodeParameter('includeItem', false) === true;
		const itemId = readItemId(json);
		if (includeItem && itemId) {
			json.item = (await fetchItem(this, itemId)) ?? null;
		}

		if (!COMBINED_EVENT_VALUES.includes(event)) {
			return { workflowData: [this.helpers.returnJsonArray([json])] };
		}
		// Both levels send the same legacy type, for example create_pulse. Only subitem events
		// have parentItemId (verified live for all six subitem events).
		const isSubitem = json.parentItemId !== undefined && json.parentItemId !== null;
		json.isSubitem = isSubitem;
		if (readScope(this) !== 'all') {
			return { workflowData: [this.helpers.returnJsonArray([json])] };
		}
		const rows = this.helpers.returnJsonArray([json]);
		return { workflowData: isSubitem ? [[], rows] : [rows, []] };
	},
};
