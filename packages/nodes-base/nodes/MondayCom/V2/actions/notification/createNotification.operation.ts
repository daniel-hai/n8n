import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { boardResourceLocator } from '../../helpers/boardLocator';
import {
	HIDE_UNTIL_BOARD_SELECTED,
	itemIdTextProperty,
	itemInputModeProperty,
	itemListOnlyResourceLocator,
} from '../../helpers/itemLocator';
import { buildUserRowsProperty, extractUserRowIds } from '../../helpers/userLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

/** The aliased batch sends one mutation for each recipient in one request. */
export const MAX_NOTIFICATION_RECIPIENTS = 30;

/** The target_type enum of create_notification for each Target choice. */
const TARGET_TYPES: Record<string, 'Project' | 'Post'> = {
	board: 'Project',
	item: 'Project',
	update: 'Post',
};

/** The query that reads the target, for the check before the batch. */
const TARGET_QUERY_FIELDS: Record<string, string> = {
	board: 'boards',
	item: 'items',
	update: 'updates',
};

const forItemOrUpdate = { notificationTarget: ['item', 'update'] };

const properties: INodeProperties[] = [
	buildUserRowsProperty({
		displayName: 'Users',
		name: 'notificationUserIds',
		description:
			'The users to notify, at most 30. In expression mode, enter the user IDs as a comma-separated string.',
	}),
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		default: '',
		required: true,
		description:
			'The notification text. Users who turned on notification emails also get it by email.',
	},
	{
		displayName: 'Target',
		name: 'notificationTarget',
		type: 'options',
		options: [
			{ name: 'Board', value: 'board', description: 'The notification opens a board' },
			{ name: 'Item', value: 'item', description: 'The notification opens an item' },
			{
				name: 'Update',
				value: 'update',
				description: 'The notification opens an update or a reply',
			},
		],
		default: 'item',
		description: 'What the notification opens when the user clicks it',
	},
	{
		...boardResourceLocator,
		description: 'The board that the notification opens',
		displayOptions: { show: { notificationTarget: ['board'] } },
	},
	{ ...itemInputModeProperty, displayOptions: { show: forItemOrUpdate } },
	{
		...boardResourceLocator,
		description: 'The board of the item. The node uses it only to list the items.',
		displayOptions: { show: { ...forItemOrUpdate, itemInputMode: ['list'] } },
	},
	{
		...itemListOnlyResourceLocator,
		description: 'The item that the notification opens, or the item of the update',
		displayOptions: {
			show: { ...forItemOrUpdate, itemInputMode: ['list'] },
			hide: HIDE_UNTIL_BOARD_SELECTED,
		},
	},
	{
		...itemIdTextProperty,
		description: 'The ID of the item that the notification opens, or of the item of the update',
		displayOptions: { show: { ...forItemOrUpdate, itemInputMode: ['id'] } },
	},
	{
		displayName: 'Update Name or ID',
		name: 'notificationUpdateId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getItemUpdatesList',
			// itemId is a resource locator in From Board mode and a string in By Item ID mode.
			loadOptionsDependsOn: ['itemId.value', 'itemId'],
		},
		default: '',
		required: true,
		description:
			'The update that the notification opens. The list shows the 50 newest updates of the item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { notificationTarget: ['update'] } },
	},
];

const displayOptions = {
	show: {
		resource: ['notification'],
		operation: ['createNotification'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** One create_notification alias for each recipient. They share the target and text variables. */
export function buildCreateNotificationsMutation(
	recipientCount: number,
	targetType: 'Project' | 'Post',
): string {
	const varDefs = ['$targetId: ID!', '$text: String!'];
	const aliases: string[] = [];
	for (let index = 0; index < recipientCount; index++) {
		varDefs.push(`$user${index}: ID!`);
		aliases.push(
			`notify${index}: create_notification(user_id: $user${index}, target_id: $targetId, text: $text, target_type: ${targetType}) { text }`,
		);
	}
	return `mutation (${varDefs.join(', ')}) {\n\t${aliases.join('\n\t')}\n}`;
}

/**
 * Notification: Create — one request notifies up to 30 users about the
 * same target. The batch is not atomic, so each recipient gets a row with
 * its own result. The API returns only the text, so the rows repeat the
 * recipient and the target.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const userIds = [
		...new Set(extractUserRowIds(this.getNodeParameter('notificationUserIds', itemIndex, {}))),
	];
	if (userIds.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Select at least one user to notify', {
			itemIndex,
		});
	}
	if (userIds.length > MAX_NOTIFICATION_RECIPIENTS) {
		throw new NodeOperationError(
			this.getNode(),
			`Too many users: ${userIds.length} selected, and the limit is ${MAX_NOTIFICATION_RECIPIENTS}`,
			{ itemIndex, description: 'Split the users across more input items.' },
		);
	}

	const text = this.getNodeParameter('text', itemIndex) as string;
	const target = this.getNodeParameter('notificationTarget', itemIndex, 'item') as string;
	const targetType = TARGET_TYPES[target];
	if (!targetType) {
		throw new NodeOperationError(this.getNode(), `Target "${target}" is not supported`, {
			itemIndex,
			description: 'Choose a value from the list.',
		});
	}

	let targetId: string;
	if (target === 'board') {
		targetId = String(this.getNodeParameter('boardId', itemIndex, '', { extractValue: true }));
	} else if (target === 'update') {
		targetId = String(this.getNodeParameter('notificationUpdateId', itemIndex, ''));
	} else {
		targetId = String(this.getNodeParameter('itemId', itemIndex, '', { extractValue: true }));
	}
	targetId = targetId.trim();
	if (!targetId) {
		throw new NodeOperationError(this.getNode(), `Select the ${target} to open`, { itemIndex });
	}

	// monday answers a wrong user or target ID with HTTP 500 for the whole batch.
	const check = await client.execute(
		`query ($userIds: [ID!], $targetIds: [ID!], $limit: Int) {
			users(ids: $userIds, limit: $limit) { id }
			target: ${TARGET_QUERY_FIELDS[target]}(ids: $targetIds) { id }
		}`,
		itemIndex,
		{ userIds, targetIds: [targetId], limit: MAX_NOTIFICATION_RECIPIENTS },
	);
	if (((check.target ?? []) as IDataObject[]).length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			`The ${target} ${targetId} was not found. Nobody was notified.`,
			{ itemIndex, description: `Check the ${target} ID, and that your API token can access it.` },
		);
	}
	const foundUsers = new Set(((check.users ?? []) as IDataObject[]).map((user) => String(user.id)));
	const missingUsers = userIds.filter((userId) => !foundUsers.has(userId));
	if (missingUsers.length > 0) {
		throw new NodeOperationError(
			this.getNode(),
			`${missingUsers.length === 1 ? 'User' : 'Users'} ${missingUsers.join(', ')} ${missingUsers.length === 1 ? 'was' : 'were'} not found. Nobody was notified.`,
			{ itemIndex },
		);
	}

	const variables: Record<string, unknown> = { targetId, text };
	userIds.forEach((userId, index) => {
		variables[`user${index}`] = userId;
	});
	const { data, errors } = await client.executeBulk(
		buildCreateNotificationsMutation(userIds.length, targetType),
		itemIndex,
		variables,
	);

	const failures: string[] = [];
	const rows = userIds.map((userId, index): IDataObject => {
		const base = { userId, target, targetId, targetType };
		const payload = data[`notify${index}`] as IDataObject | null | undefined;
		if (payload) return { ...base, text: payload.text ?? text, success: true };
		const failure = errors.find((error) => error.path?.[0] === `notify${index}`);
		const message = failure?.message ?? 'Unknown error';
		failures.push(`${userId} (${message})`);
		return {
			...base,
			success: false,
			error: message,
			errorCode: failure?.extensions?.code ?? failure?.error_code ?? null,
		};
	});

	if (failures.length > 0 && !this.continueOnFail()) {
		throw new NodeOperationError(
			this.getNode(),
			`${failures.length} of ${userIds.length} notifications failed: ${failures.join(', ')}`,
			{ itemIndex, description: 'The node notified the other users.' },
		);
	}
	return rows;
}
