import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	buildCreateNotificationsMutation,
	execute as createNotification,
} from '../actions/notification/createNotification.operation';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

function makeContext(params: Record<string, unknown>, continueOnFail = false): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

function makeClient(check: IDataObject, bulk?: { data: IDataObject; errors: IDataObject[] }) {
	const execute = vi.fn(async () => check);
	const executeBulk = vi.fn(async () => bulk ?? { data: {}, errors: [] });
	return {
		client: { execute, executeBulk } as unknown as MondayGraphQLClient,
		execute,
		executeBulk,
	};
}

const itemParams = {
	notificationUserIds: '1, 2',
	text: 'Hello',
	notificationTarget: 'item',
	itemId: '11',
};
const bothUsers = { users: [{ id: '1' }, { id: '2' }], target: [{ id: '11' }] };

describe('buildCreateNotificationsMutation', () => {
	it('declares one user variable and one alias for each recipient', () => {
		const query = buildCreateNotificationsMutation(2, 'Post');
		expect(query).toContain('$targetId: ID!, $text: String!, $user0: ID!, $user1: ID!');
		expect(query).toContain(
			'notify1: create_notification(user_id: $user1, target_id: $targetId, text: $text, target_type: Post)',
		);
	});
});

describe('Notification: Create', () => {
	it('checks the users and the target, then notifies every user in one request', async () => {
		const { client, execute, executeBulk } = makeClient(bothUsers, {
			data: { notify0: { text: 'Hello' }, notify1: { text: 'Hello' } },
			errors: [],
		});
		const rows = await createNotification.call(makeContext(itemParams), client, 0);

		const [checkQuery, , checkVariables] = execute.mock.calls[0] as unknown as [
			string,
			number,
			IDataObject,
		];
		expect(checkQuery).toContain('target: items(ids: $targetIds)');
		expect(checkVariables).toEqual({ userIds: ['1', '2'], targetIds: ['11'], limit: 30 });
		const [, , variables] = executeBulk.mock.calls[0] as unknown as [string, number, IDataObject];
		expect(variables).toEqual({ targetId: '11', text: 'Hello', user0: '1', user1: '2' });
		expect(rows).toEqual([
			{
				userId: '1',
				target: 'item',
				targetId: '11',
				targetType: 'Project',
				text: 'Hello',
				success: true,
			},
			{
				userId: '2',
				target: 'item',
				targetId: '11',
				targetType: 'Project',
				text: 'Hello',
				success: true,
			},
		]);
	});

	it('notifies nobody when the target is not found', async () => {
		const { client, executeBulk } = makeClient({ users: [{ id: '1' }, { id: '2' }], target: [] });
		await expect(createNotification.call(makeContext(itemParams), client, 0)).rejects.toThrow(
			'The item 11 was not found. Nobody was notified.',
		);
		expect(executeBulk).not.toHaveBeenCalled();
	});

	it('notifies nobody when a user is not found', async () => {
		const { client, executeBulk } = makeClient({ users: [{ id: '1' }], target: [{ id: '11' }] });
		await expect(createNotification.call(makeContext(itemParams), client, 0)).rejects.toThrow(
			'User 2 was not found. Nobody was notified.',
		);
		expect(executeBulk).not.toHaveBeenCalled();
	});

	it('uses the update query and the Post type for an update target', async () => {
		const { client, execute, executeBulk } = makeClient(
			{ users: [{ id: '1' }], target: [{ id: '99' }] },
			{ data: { notify0: { text: 'Hi' } }, errors: [] },
		);
		await createNotification.call(
			makeContext({
				notificationUserIds: '1',
				text: 'Hi',
				notificationTarget: 'update',
				notificationUpdateId: '99',
			}),
			client,
			0,
		);
		expect((execute.mock.calls[0] as unknown as [string])[0]).toContain('target: updates(');
		expect((executeBulk.mock.calls[0] as unknown as [string])[0]).toContain('target_type: Post');
	});

	const partial = {
		data: { notify0: { text: 'Hello' }, notify1: null },
		errors: [
			{
				message: 'The target user is not authorized to view target',
				path: ['notify1'],
				extensions: { code: 'NotAuthorized' },
			},
		],
	};

	it('throws for a partial failure and says the other users were notified', async () => {
		const { client } = makeClient(bothUsers, partial);
		await expect(createNotification.call(makeContext(itemParams), client, 0)).rejects.toThrow(
			'1 of 2 notifications failed: 2 (The target user is not authorized to view target)',
		);
	});

	it('with Continue On Fail, returns a failed row for each failed user', async () => {
		const { client } = makeClient(bothUsers, partial);
		const rows = await createNotification.call(makeContext(itemParams, true), client, 0);
		expect(rows[0].success).toBe(true);
		expect(rows[1]).toMatchObject({ userId: '2', success: false, errorCode: 'NotAuthorized' });
	});

	it('rejects more than 30 users before any request', async () => {
		const { client, execute } = makeClient(bothUsers);
		const userIds = Array.from({ length: 31 }, (_, index) => String(index + 1)).join(',');
		await expect(
			createNotification.call(
				makeContext({ ...itemParams, notificationUserIds: userIds }),
				client,
				0,
			),
		).rejects.toThrow('Too many users: 31 selected, and the limit is 30');
		expect(execute).not.toHaveBeenCalled();
	});

	it('rejects a target that is not in the list', async () => {
		const { client } = makeClient(bothUsers);
		await expect(
			createNotification.call(
				makeContext({ ...itemParams, notificationTarget: 'workspace' }),
				client,
				0,
			),
		).rejects.toThrow('Target "workspace" is not supported');
	});
});
