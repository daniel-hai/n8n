import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as getMeeting } from '../actions/meeting/getMeeting.operation';
import { execute as getMeetings } from '../actions/meeting/getMeetings.operation';
import { searchMeetings } from '../helpers/meetings';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

const node: INode = {
	id: '1',
	name: 'monday.com',
	type: 'n8n-nodes-base.mondayCom',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (
			name: string,
			_index: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value = params[name];
			if (value === undefined) return fallback;
			if (options?.extractValue && typeof value === 'object' && value !== null) {
				return (value as { value: unknown }).value;
			}
			return value;
		},
		getNode: () => node,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const page = (ids: string[], cursor: string | null) => ({
	notetaker: {
		meetings: {
			meetings: ids.map((id) => ({ id, title: `Meeting ${id}` })),
			page_info: { has_next_page: cursor !== null, cursor },
		},
	},
});

describe('Meeting: Get', () => {
	it('asks for one meeting with access ALL, topics and action items', async () => {
		const { client, execute } = makeClient(page(['7'], null));

		expect(
			await getMeeting.call(makeContext({ meetingId: { mode: 'id', value: '7' } }), client, 0),
		).toEqual({ id: '7', title: 'Meeting 7' });
		const [query, , variables] = call(execute, 0);
		expect(variables).toEqual({
			limit: 1,
			cursor: null,
			filters: { ids: ['7'], access: 'ALL' },
		});
		expect(query).toContain('topics {');
		expect(query).toContain('action_items {');
		expect(query).not.toContain('transcript {');
	});

	it('adds the transcript on request', async () => {
		const { client, execute } = makeClient(page(['7'], null));
		const ctx = makeContext({
			meetingId: '7',
			getMeetingOptions: { includeTranscript: true, includeTopics: false },
		});

		await getMeeting.call(ctx, client, 0);

		expect(call(execute, 0)[0]).toContain('transcript {');
		expect(call(execute, 0)[0]).not.toContain('topics {');
	});

	it('reports a missing meeting', async () => {
		const { client } = makeClient(page([], null));

		await expect(getMeeting.call(makeContext({ meetingId: '7' }), client, 0)).rejects.toThrow(
			'Meeting 7 was not found',
		);
	});
});

describe('Meeting: Get Many', () => {
	it('sends the filters only on the first page and asks for the remaining rows', async () => {
		const first = Array.from({ length: 100 }, (_, i) => `m${i}`);
		const { client, execute } = makeClient(page(first, 'c1'), page(['n1', 'n2'], 'c2'));
		const ctx = makeContext({
			meetingFilters: { access: 'SHARED_WITH_ME', search: ' sync ', meetingIds: '1, 2' },
			getMeetingsOptions: { limit: 102, includeCursor: true },
		});

		const rows = await getMeetings.call(ctx, client, 0);

		expect(rows).toHaveLength(103);
		expect(rows[102]).toEqual({ nextCursor: 'c2' });
		expect(call(execute, 0)[2]).toEqual({
			limit: 100,
			cursor: null,
			filters: { ids: ['1', '2'], search: 'sync', access: 'SHARED_WITH_ME' },
		});
		expect(call(execute, 1)[2]).toEqual({ limit: 2, cursor: 'c1', filters: null });
	});

	it('starts from a cursor and stops on the last page', async () => {
		const { client, execute } = makeClient(page(['n1'], null));
		const ctx = makeContext({
			meetingFilters: { search: 'ignored' },
			getMeetingsOptions: { startingCursor: ' c9 ' },
		});

		expect(await getMeetings.call(ctx, client, 0)).toEqual([{ id: 'n1', title: 'Meeting n1' }]);
		expect(call(execute, 0)[2]).toEqual({ limit: 50, cursor: 'c9', filters: null });
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('rejects an access value outside the enum', async () => {
		const { client, execute } = makeClient();

		await expect(
			getMeetings.call(makeContext({ meetingFilters: { access: 'EVERYONE' } }), client, 0),
		).rejects.toThrow('Access "EVERYONE" is not supported');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('searchMeetings', () => {
	function makeLoadContext() {
		const httpRequestWithAuthentication = vi.fn();
		const context = {
			getNodeParameter: (name: string) => (name === 'authentication' ? 'accessToken' : undefined),
			getNode: () => node,
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;
		return { context, httpRequestWithAuthentication };
	}

	it('searches all accessible meetings and returns the next cursor', async () => {
		const { context, httpRequestWithAuthentication } = makeLoadContext();
		httpRequestWithAuthentication.mockResolvedValueOnce({
			data: {
				notetaker: {
					meetings: {
						meetings: [
							{ id: '7', title: 'Weekly', start_time: '2026-11-02T09:00:00Z', meeting_link: '' },
						],
						page_info: { has_next_page: true, cursor: 'c1' },
					},
				},
			},
		});

		expect(await searchMeetings.call(context, 'weekly')).toEqual({
			results: [{ name: 'Weekly (2026-11-02)', value: '7', url: undefined }],
			paginationToken: 'c1',
		});
		const body = httpRequestWithAuthentication.mock.calls[0][1].body as {
			variables: IDataObject;
		};
		expect(body.variables).toEqual({
			limit: 50,
			cursor: null,
			filters: { search: 'weekly', access: 'ALL' },
		});
	});
});
