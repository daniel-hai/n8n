import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as getTeam } from '../actions/team/getTeam.operation';
import { execute as getTeamMembers } from '../actions/team/getTeamMembers.operation';
import { execute as getTeams } from '../actions/team/getTeams.operation';
import { searchTeams, teamResourceLocator } from '../helpers/userLocator';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
	} as unknown as IExecuteFunctions;
}

function makeClient(response: IDataObject) {
	const execute = vi.fn(async () => response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const team = {
	id: '9',
	name: 'Platform',
	owners: [{ id: '1', name: 'Ada' }],
	users: [
		{ id: '1', name: 'Ada' },
		{ id: '2', name: 'Grace' },
	],
};

describe('Team: Get', () => {
	it('sends the team ID as a variable and does not request members', async () => {
		const { client, execute } = makeClient({ teams: [team] });
		const result = await getTeam.call(makeContext({ teamId: '9' }), client, 0);

		const [query, , variables] = execute.mock.calls[0] as unknown as [string, number, IDataObject];
		expect(query).toContain('teams(ids: $ids)');
		expect(query).not.toContain('users {');
		expect(variables).toEqual({ ids: ['9'] });
		expect(result.name).toBe('Platform');
	});

	it('throws a not found error for an unknown team', async () => {
		const { client } = makeClient({ teams: [] });
		await expect(getTeam.call(makeContext({ teamId: '404' }), client, 0)).rejects.toThrow(
			'Team 404 was not found',
		);
	});
});

describe('Team: Get Members', () => {
	it('returns one row per user, tagged with the team', async () => {
		const { client, execute } = makeClient({ teams: [team] });
		const rows = await getTeamMembers.call(makeContext({ teamId: '9' }), client, 0);

		const [query] = execute.mock.calls[0] as unknown as [string];
		expect(query).toContain('users {');
		expect(rows).toEqual([
			{ id: '1', name: 'Ada', teamId: '9', teamName: 'Platform' },
			{ id: '2', name: 'Grace', teamId: '9', teamName: 'Platform' },
		]);
	});

	it('returns no rows for a team without members', async () => {
		const { client } = makeClient({ teams: [{ id: '9', name: 'Empty', users: [] }] });
		expect(await getTeamMembers.call(makeContext({ teamId: '9' }), client, 0)).toEqual([]);
	});
});

describe('Team: Get Many', () => {
	it('returns one row per team', async () => {
		const { client } = makeClient({ teams: [team, { id: '10', name: 'Sales' }] });
		const rows = await getTeams.call(makeContext({}), client, 0);
		expect(rows.map((row) => row.id)).toEqual(['9', '10']);
	});
});

describe('team picker', () => {
	it('offers list and ID modes', () => {
		expect(teamResourceLocator.modes?.map((mode) => mode.name)).toEqual(['list', 'id']);
	});

	it('filters teams by name and sorts them', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			data: {
				teams: [
					{ id: '3', name: 'Sales West' },
					{ id: '1', name: 'Platform' },
					{ id: '2', name: 'Sales East' },
				],
			},
		}));
		const context = {
			getNode: () => ({ name: 'monday.com' }),
			getNodeParameter: () => 'accessToken',
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;

		const result = await searchTeams.call(context, 'sales');
		expect(result.results).toEqual([
			{ name: 'Sales East', value: '2' },
			{ name: 'Sales West', value: '3' },
		]);
	});
});
