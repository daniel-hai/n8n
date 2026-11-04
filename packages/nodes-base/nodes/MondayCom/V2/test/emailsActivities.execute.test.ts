import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as createCustomActivity } from '../actions/emailsActivities/createCustomActivity.operation';
import { execute as createTimelineItem } from '../actions/emailsActivities/createTimelineItem.operation';
import { execute as deleteCustomActivity } from '../actions/emailsActivities/deleteCustomActivity.operation';
import { execute as deleteTimelineItem } from '../actions/emailsActivities/deleteTimelineItem.operation';
import { execute as getCustomActivities } from '../actions/emailsActivities/getCustomActivities.operation';
import { execute as getTimelineItem } from '../actions/emailsActivities/getTimelineItem.operation';
import { execute as getTimelineItems } from '../actions/emailsActivities/getTimelineItems.operation';
import { execute as searchTimelineItems } from '../actions/emailsActivities/searchTimelineItemsAccount.operation';
import { getCustomActivitiesList } from '../helpers/emailsActivities';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

const node: INode = {
	id: '1',
	name: 'monday.com',
	type: 'n8n-nodes-base.mondayCom',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};

function makeContext(params: Record<string, unknown>, timezone = 'UTC'): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => node,
		getTimezone: () => timezone,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: Array<IDataObject | Error>) {
	const execute = vi.fn();
	for (const response of responses) {
		if (response instanceof Error) execute.mockRejectedValueOnce(response);
		else execute.mockResolvedValueOnce(response);
	}
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const apiError = (code: string, message: string) =>
	new NodeApiError(node, { message, extensions: { code } } as unknown as JsonObject, { message });

const timelineParams = (extra: Record<string, unknown> = {}) => ({
	itemInputMode: 'id',
	itemId: '42',
	customActivityId: 'act-1',
	timelineItemTitle: 'Call with the customer',
	...extra,
});

describe('Emails & Activities: Create Timeline Item', () => {
	it('reads dates in the workflow timezone and sends UTC', async () => {
		const { client, execute } = makeClient({
			create_timeline_item: { id: 't1', title: 'Call with the customer', content: null },
		});
		const ctx = makeContext(
			timelineParams({
				timelineItemOptions: {
					timestamp: '2026-11-04T10:00:00',
					timeRangeStart: '2026-11-04T10:00:00',
					timeRangeEnd: '2026-11-04T11:00:00',
					summary: 'Short',
					url: 'https://example.com',
					location: '',
				},
			}),
			'Asia/Jerusalem',
		);

		const result = await createTimelineItem.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toEqual({
			itemId: '42',
			customActivityId: 'act-1',
			title: 'Call with the customer',
			timestamp: '2026-11-04T08:00:00.000Z',
			summary: 'Short',
			content: null,
			location: null,
			phone: null,
			url: 'https://example.com',
			timeRange: {
				start_timestamp: '2026-11-04T08:00:00.000Z',
				end_timestamp: '2026-11-04T09:00:00.000Z',
			},
		});
		expect(call(execute, 0)[0]).not.toContain('created_at');
		expect(result).toEqual({
			id: 't1',
			title: 'Call with the customer',
			content: null,
			custom_activity_id: 'act-1',
			item_id: '42',
		});
	});

	it('uses the time of the run when Timestamp is empty', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
		try {
			const { client, execute } = makeClient({ create_timeline_item: { id: 't1' } });
			await createTimelineItem.call(makeContext(timelineParams()), client, 0);
			expect(call(execute, 0)[2]).toMatchObject({
				timestamp: '2026-11-04T12:00:00.000Z',
				timeRange: null,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([
		[{ timelineItemTitle: 'x'.repeat(256) }, 'Title is longer than 255 characters'],
		[{ timelineItemOptions: { summary: 'x'.repeat(256) } }, 'Summary is longer than 255'],
		[{ timelineItemOptions: { timeRangeStart: '2026-11-04T10:00:00' } }, 'Set both Start Time'],
		[
			{
				timelineItemOptions: {
					timeRangeStart: '2026-11-04T11:00:00',
					timeRangeEnd: '2026-11-04T10:00:00',
				},
			},
			'End Time is before Start Time',
		],
		[{ timelineItemOptions: { timestamp: 'soon' } }, 'Timestamp is not a valid date'],
		[{ itemId: ' ' }, 'Item is required'],
		[{ timelineItemTitle: ' ' }, 'Title is required'],
	])('rejects invalid input before the request: %j', async (extra, message) => {
		const { client, execute } = makeClient();

		await expect(
			createTimelineItem.call(makeContext(timelineParams(extra)), client, 0),
		).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});

	it('reports an unknown item', async () => {
		const { client } = makeClient(
			apiError('UNAUTHORIZED', 'User is not allowed to act on this item.'),
		);

		await expect(createTimelineItem.call(makeContext(timelineParams()), client, 0)).rejects.toThrow(
			'Item 42 was not found, or you have no access to it',
		);
	});

	it('checks the custom activity when monday.com rejects the input', async () => {
		const { client, execute } = makeClient(
			apiError('INVALID_INPUT', 'Custom activity not found.'),
			{ custom_activity: [] },
		);

		await expect(createTimelineItem.call(makeContext(timelineParams()), client, 0)).rejects.toThrow(
			'Custom activity act-1 was not found',
		);
		expect(call(execute, 1)[2]).toEqual({ ids: ['act-1'] });
	});

	it('keeps the monday.com error when the custom activity exists', async () => {
		const { client } = makeClient(apiError('INVALID_INPUT', 'Invalid URL'), {
			custom_activity: [{ id: 'act-1' }],
		});

		await expect(createTimelineItem.call(makeContext(timelineParams()), client, 0)).rejects.toThrow(
			'Invalid URL',
		);
	});
});

describe('Emails & Activities: Get Timeline Item', () => {
	it('returns the entry', async () => {
		const { client, execute } = makeClient({ timeline_item: { id: 't1', title: 'Call' } });

		expect(await getTimelineItem.call(makeContext({ timelineItemId: ' t1 ' }), client, 0)).toEqual({
			id: 't1',
			title: 'Call',
		});
		expect(call(execute, 0)[2]).toEqual({ id: 't1' });
	});

	it.each(['NOT_FOUND', 'INTERNAL_ERROR'])('reports %s as not found', async (code) => {
		const { client } = makeClient(apiError(code, 'Timeline item not found.'));

		await expect(
			getTimelineItem.call(makeContext({ timelineItemId: 'nope' }), client, 0),
		).rejects.toThrow('Timeline item nope was not found');
	});
});

describe('Emails & Activities: Get Many Timeline Items', () => {
	const page = (ids: string[], cursor: string | null) => ({
		timeline: { timeline_items_page: { cursor, timeline_items: ids.map((id) => ({ id })) } },
	});

	it('follows the cursor and asks only for the rows that are still needed', async () => {
		const first = Array.from({ length: 100 }, (_, i) => `a${i}`);
		const { client, execute } = makeClient(page(first, 'c1'), page(['b0', 'b1', 'b2'], 'c2'));
		const ctx = makeContext({
			itemInputMode: 'id',
			itemId: '42',
			getTimelineItemsOptions: { limit: 103, skipConnectedItems: true },
		});

		const rows = await getTimelineItems.call(ctx, client, 0);

		expect(rows).toHaveLength(103);
		expect(call(execute, 0)[2]).toEqual({ id: '42', skip: true, limit: 100, cursor: null });
		expect(call(execute, 1)[2]).toEqual({ id: '42', skip: true, limit: 3, cursor: 'c1' });
	});

	it('stops on an empty page', async () => {
		const { client, execute } = makeClient(page([], 'c1'));

		const rows = await getTimelineItems.call(
			makeContext({ itemInputMode: 'id', itemId: '42' }),
			client,
			0,
		);

		expect(rows).toEqual([]);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(call(execute, 0)[2]).toMatchObject({ limit: 50, skip: null });
	});

	it('reports an unknown item', async () => {
		const { client } = makeClient(apiError('UNAUTHORIZED', 'User is not allowed'));

		await expect(
			getTimelineItems.call(makeContext({ itemInputMode: 'id', itemId: '1' }), client, 0),
		).rejects.toThrow('Item 1 was not found, or you have no access to it');
	});
});

describe('Emails & Activities: Delete Timeline Item', () => {
	it('returns the deleted entry with the outcome', async () => {
		const { client } = makeClient({ delete_timeline_item: { id: 't1', title: 'Call' } });

		expect(await deleteTimelineItem.call(makeContext({ timelineItemId: 't1' }), client, 0)).toEqual(
			{ id: 't1', title: 'Call', deleted: true, action: 'delete' },
		);
	});

	it('reports an unknown entry', async () => {
		const { client } = makeClient(apiError('INTERNAL_ERROR', 'Failed to delete timeline item.'));

		await expect(
			deleteTimelineItem.call(makeContext({ timelineItemId: 'nope' }), client, 0),
		).rejects.toThrow('Timeline item nope was not found');
	});
});

describe('Emails & Activities: custom activities', () => {
	it('creates an activity type with allowed enum values', async () => {
		const { client, execute } = makeClient({
			create_custom_activity: { id: 'a1', name: 'Site visit' },
		});
		const ctx = makeContext({
			customActivityName: ' Site visit ',
			customActivityColor: 'GO_GREEN',
			customActivityIcon: 'UTENCILS',
		});

		expect(await createCustomActivity.call(ctx, client, 0)).toEqual({
			id: 'a1',
			name: 'Site visit',
		});
		expect(call(execute, 0)[2]).toEqual({
			name: 'Site visit',
			color: 'GO_GREEN',
			iconId: 'UTENCILS',
		});
	});

	it.each([
		[{ customActivityColor: 'PURPLE' }, 'Color "PURPLE" is not supported'],
		[{ customActivityIcon: 'UTENSILS' }, 'Icon "UTENSILS" is not supported'],
	])('rejects a value outside the enum: %j', async (extra, message) => {
		const { client, execute } = makeClient();
		const ctx = makeContext({
			customActivityName: 'Visit',
			customActivityColor: 'GRAY',
			customActivityIcon: 'FLAG',
			...extra,
		});

		await expect(createCustomActivity.call(ctx, client, 0)).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});

	it('sends the name filter, or null when it is empty', async () => {
		const { client, execute } = makeClient(
			{ custom_activity: [{ id: 'a1' }] },
			{ custom_activity: null },
		);

		expect(
			await getCustomActivities.call(
				makeContext({ customActivityFilters: { name: ' visit ' } }),
				client,
				0,
			),
		).toEqual([{ id: 'a1' }]);
		expect(await getCustomActivities.call(makeContext({}), client, 0)).toEqual([]);
		expect(call(execute, 0)[2]).toEqual({ name: 'visit' });
		expect(call(execute, 1)[2]).toEqual({ name: null });
	});

	it('checks the activity, deletes it, and returns it with the outcome', async () => {
		const { client, execute } = makeClient(
			{ custom_activity: [{ id: 'a1', name: 'Visit' }] },
			{ delete_custom_activity: { name: 'Visit' } },
		);

		expect(
			await deleteCustomActivity.call(makeContext({ customActivityId: 'a1' }), client, 0),
		).toEqual({ id: 'a1', name: 'Visit', deleted: true, action: 'delete' });
		expect(call(execute, 1)[0]).toContain('delete_custom_activity(id: $id) { name }');
	});

	it('does not delete an unknown activity', async () => {
		const { client, execute } = makeClient({ custom_activity: [] });

		await expect(
			deleteCustomActivity.call(makeContext({ customActivityId: 'nope' }), client, 0),
		).rejects.toThrow('Custom activity nope was not found');
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('lists activities and shows the ID only for repeated names', async () => {
		const httpRequestWithAuthentication = vi.fn().mockResolvedValue({
			data: {
				custom_activity: [
					{ id: 'B', name: 'Visit' },
					{ id: 'A', name: 'Call' },
					{ id: 'C', name: 'Visit' },
					{ id: 'D', name: null },
				],
			},
		});
		const ctx = {
			getNodeParameter: (name: string) => (name === 'authentication' ? 'accessToken' : undefined),
			getNode: () => node,
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;

		expect(await getCustomActivitiesList.call(ctx)).toEqual([
			{ name: 'Call', value: 'A' },
			{ name: 'D', value: 'D' },
			{ name: 'Visit (B)', value: 'B' },
			{ name: 'Visit (C)', value: 'C' },
		]);
	});
});

describe('Emails & Activities: Search Timeline Items', () => {
	it('sends the timeline filters on the timeline_items field', async () => {
		const { client, execute } = makeClient({
			search: {
				timeline_items: { results: [{ id: 't1', indexed_data: { id: 't1', title: 'Call' } }] },
			},
		});
		const ctx = makeContext({
			searchQuery: 'call',
			searchOptions: {
				itemIds: '42, 43',
				timelineType: 'email',
				timelineProductKind: 'crm',
				workspaceIds: ['7'],
			},
		});

		const rows = await searchTimelineItems.call(ctx, client, 0);

		const [query, , variables] = call(execute, 0);
		expect(query).toContain('timeline_items(');
		expect(query).toContain('item_ids: $itemIds');
		expect(query).toContain('$timelineType: TimelineItemKind');
		expect(query).toContain('$timelineProductKind: TimelineItemProductKind');
		expect(variables).toMatchObject({
			itemIds: ['42', '43'],
			timelineType: 'email',
			timelineProductKind: 'crm',
			workspaceIds: ['7'],
		});
		expect(rows).toEqual([{ entityType: 'timelineItem', id: 't1', title: 'Call' }]);
	});

	it('rejects a type outside the enum', async () => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ searchQuery: 'call', searchOptions: { timelineType: 'fax' } });

		await expect(searchTimelineItems.call(ctx, client, 0)).rejects.toThrow(
			'Timeline Item Type "fax" is not supported',
		);
		expect(execute).not.toHaveBeenCalled();
	});
});
