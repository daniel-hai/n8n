import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as getMe } from '../actions/user/getMe.operation';
import { execute as getUser } from '../actions/user/getUser.operation';
import { execute as getUserActivityLogs } from '../actions/user/getUserActivityLogs.operation';
import { execute as getUsers } from '../actions/user/getUsers.operation';
import { execute as searchUsersAccount } from '../actions/user/searchUsersAccount.operation';
import { buildUserFieldSelection } from '../helpers/userFields';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

function makeContext(params: Record<string, unknown>, timezone = 'UTC'): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
		getTimezone: () => timezone,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

function call(execute: ReturnType<typeof vi.fn>, index = 0) {
	const [query, , variables] = execute.mock.calls[index] as [
		string,
		number,
		Record<string, unknown>,
	];
	return { query, variables };
}

describe('buildUserFieldSelection', () => {
	it('returns the standard profile with the small photo only', () => {
		const fields = buildUserFieldSelection(false);
		expect(fields).toContain('photo_url { thumb_small }');
		expect(fields).not.toContain('account_id');
	});

	it('adds the extended profile and every photo size', () => {
		const fields = buildUserFieldSelection(true);
		expect(fields).toContain('photo_url { original small thumb thumb_small tiny }');
		expect(fields).toContain('out_of_office {');
		expect(fields).toContain('account_id');
	});
});

describe('User: Get', () => {
	it('sends the user ID as a variable and returns the user', async () => {
		const { client, execute } = makeClient({ users: [{ id: '7', name: 'Ada' }] });
		const result = await getUser.call(makeContext({ userId: '7' }), client, 0);

		const { query, variables } = call(execute);
		expect(query).toContain('users(ids: $ids)');
		expect(query).not.toContain('account_id');
		expect(variables).toEqual({ ids: ['7'] });
		expect(result).toEqual({ id: '7', name: 'Ada' });
	});

	it('requests the extended profile when the option is on', async () => {
		const { client, execute } = makeClient({ users: [{ id: '7' }] });
		await getUser.call(
			makeContext({ userId: '7', getUserOptions: { includeExtendedInfo: true } }),
			client,
			0,
		);
		expect(call(execute).query).toContain('account_id');
	});

	it('throws a not found error for an unknown user', async () => {
		const { client } = makeClient({ users: [] });
		await expect(getUser.call(makeContext({ userId: '404' }), client, 0)).rejects.toThrow(
			'User 404 was not found',
		);
	});
});

describe('User: Get Current', () => {
	it('returns the user who owns the credential', async () => {
		const { client, execute } = makeClient({ me: { id: '1', name: 'Me' } });
		const result = await getMe.call(makeContext({}), client, 0);
		expect(call(execute).query).toContain('me {');
		expect(result).toEqual({ id: '1', name: 'Me' });
	});

	it('throws when monday.com returns no user', async () => {
		const { client } = makeClient({ me: null });
		await expect(getMe.call(makeContext({}), client, 0)).rejects.toThrow(
			'monday.com returned no current user',
		);
	});
});

describe('User: Get Many', () => {
	it('sends only limit and page when no filter is set', async () => {
		const { client, execute } = makeClient({ users: [{ id: '1' }, { id: '2' }] });
		const result = await getUsers.call(makeContext({}), client, 0);

		const { query, variables } = call(execute);
		expect(query).toContain('query ($limit: Int!, $page: Int!)');
		expect(query).toContain('users(limit: $limit, page: $page)');
		expect(variables).toEqual({ limit: 50, page: 1 });
		expect(result).toHaveLength(2);
	});

	it.each([
		['guests', 'user_kind: $userKind', { userKind: { in: ['GUEST'] } }],
		['non_guests', 'user_kind: $userKind', { userKind: { not_in: ['GUEST'] } }],
		['non_pending', 'status: $status', { status: ['ACTIVE'] }],
	])('maps the %s kind to a variable', async (kind, argument, expected) => {
		const { client, execute } = makeClient({ users: [] });
		await getUsers.call(makeContext({ userFilters: { kind } }), client, 0);

		const { query, variables } = call(execute);
		expect(query).toContain(argument);
		expect(variables).toMatchObject(expected);
	});

	it('rejects a kind outside the allowed values before calling the API', async () => {
		const { client, execute } = makeClient();
		await expect(
			getUsers.call(makeContext({ userFilters: { kind: 'GUEST]) { id } #' } }), client, 0),
		).rejects.toThrow('is not supported');
		expect(execute).not.toHaveBeenCalled();
	});

	it('sends search, IDs and sort as variables', async () => {
		const { client, execute } = makeClient({ users: [] });
		await getUsers.call(
			makeContext({
				userFilters: { name: '  ada ', userIds: '1,2' },
				options: { limit: 10, page: 3, newestFirst: true },
			}),
			client,
			0,
		);

		const { query, variables } = call(execute);
		expect(query).toContain('name: $name');
		expect(query).toContain('sort: $sort');
		expect(variables).toEqual({
			limit: 10,
			page: 3,
			name: 'ada',
			ids: ['1', '2'],
			sort: [{ field: 'CREATED_AT', direction: 'DESC' }],
		});
	});

	it('sends the email list as a variable', async () => {
		const { client, execute } = makeClient({ users: [] });
		await getUsers.call(
			makeContext({ userFilters: { emails: 'a@acme.com, b@acme.com' } }),
			client,
			0,
		);

		const { query, variables } = call(execute);
		expect(query).toContain('$emails: [String!]');
		expect(variables.emails).toEqual(['a@acme.com', 'b@acme.com']);
	});

	it('rejects Search together with Emails before calling the API', async () => {
		const { client, execute } = makeClient();
		await expect(
			getUsers.call(makeContext({ userFilters: { name: 'ada', emails: 'a@acme.com' } }), client, 0),
		).rejects.toThrow('Use the Search filter or the Emails filter');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('User: List Activity Logs', () => {
	const log = (id: string) => ({ id, event: 'subscribe', created_at: '17924977662508170' });
	const page = (cursor: string | null, count: number, offset = 0) => ({
		users: [
			{
				activity_logs: {
					cursor,
					logs: Array.from({ length: count }, (_, n) => log(String(offset + n))),
				},
			},
		],
	});

	it('follows the cursor until the limit is reached', async () => {
		const { client, execute } = makeClient(page('c1', 100), page('c2', 50, 100));
		const rows = await getUserActivityLogs.call(
			makeContext({ userId: '7', userActivityLogOptions: { limit: 150 } }),
			client,
			0,
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(call(execute, 0).variables).toMatchObject({ limit: 100, cursor: null });
		expect(call(execute, 1).variables).toMatchObject({ limit: 50, cursor: 'c1' });
		expect(rows).toHaveLength(150);
		expect(rows[0]).toMatchObject({
			id: '0',
			targetUserId: '7',
			createdAt: '2026-10-20T12:02:46.250Z',
		});
	});

	it('starts from the given cursor and adds the next cursor as the last item', async () => {
		const { client, execute } = makeClient(page('c9', 2));
		const rows = await getUserActivityLogs.call(
			makeContext({
				userId: '7',
				userActivityLogOptions: { limit: 2, startingCursor: ' c8 ', includeCursor: true },
			}),
			client,
			0,
		);

		expect(call(execute).variables.cursor).toBe('c8');
		expect(rows).toHaveLength(3);
		expect(rows[2]).toEqual({ nextCursor: 'c9' });
	});

	it('reads the date filters in the workflow timezone and sends them as UTC', async () => {
		const { client, execute } = makeClient(page(null, 0));
		await getUserActivityLogs.call(
			makeContext(
				{
					userId: '7',
					userActivityLogFilters: {
						from: '2026-01-31T09:00:00',
						to: '2026-02-01T00:00:00+00:00',
						boardIds: ['11', '12'],
						eventTypes: 'create_pulse, subscribe',
					},
				},
				'Europe/Berlin',
			),
			client,
			0,
		);

		const { query, variables } = call(execute);
		expect(query).toContain('from: $from');
		expect(query).toContain('board_ids: $boardIds');
		expect(variables).toMatchObject({
			from: '2026-01-31T08:00:00.000Z',
			to: '2026-02-01T00:00:00.000Z',
			boardIds: ['11', '12'],
			eventTypes: ['create_pulse', 'subscribe'],
		});
	});

	it('names the filter when a date is not valid', async () => {
		const { client, execute } = makeClient();
		await expect(
			getUserActivityLogs.call(
				makeContext({ userId: '7', userActivityLogFilters: { to: 'next tuesday' } }),
				client,
				0,
			),
		).rejects.toThrow('The To filter is not a valid date');
		expect(execute).not.toHaveBeenCalled();
	});

	it('throws a not found error for an unknown user', async () => {
		const { client } = makeClient({ users: [] });
		await expect(
			getUserActivityLogs.call(makeContext({ userId: '404' }), client, 0),
		).rejects.toThrow('User 404 was not found');
	});
});

describe('User: Search', () => {
	it('searches users only and does not send board or workspace filters', async () => {
		const { client, execute } = makeClient({
			search: {
				users: {
					results: [{ id: '7', indexed_data: { id: '7', name: 'Ada', email: 'a@acme.com' } }],
				},
			},
		});
		const rows = await searchUsersAccount.call(
			makeContext({
				searchQuery: 'ada',
				searchOptions: { boardIds: ['1'], workspaceIds: ['2'] },
			}),
			client,
			0,
		);

		const { query, variables } = call(execute);
		expect(query).toContain('users(query: $q, limit: $limit)');
		expect(query).not.toContain('board_ids');
		expect(variables).toEqual({ q: 'ada', limit: 10 });
		expect(rows).toEqual([{ entityType: 'user', id: '7', name: 'Ada', email: 'a@acme.com' }]);
	});
});
