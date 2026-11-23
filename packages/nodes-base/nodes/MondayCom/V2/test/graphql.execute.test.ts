import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as getLimits } from '../actions/graphql/getLimits.operation';
import { execute as graphql } from '../actions/graphql/graphql.operation';
import { getApiVersions } from '../helpers/requestInfo';
import { MondayGraphQLClient, parseRateLimitHeader } from '../transport/MondayGraphQLClient';

const RATE_LIMIT = '"minuteRate";r=3334, "complexityMinute";r=9999999;t=60';
const RATE_LIMIT_POLICY = '"minuteRate";q=3335;w=60, "concurrency";q=200;qu="concurrent-requests"';

function makeHttpContext(params: Record<string, unknown> = {}) {
	const httpRequestWithAuthentication = vi.fn(async (_credential: string, options: IDataObject) =>
		options.returnFullResponse
			? {
					body: { data: { version: { value: '2026-07' } } },
					statusCode: 200,
					headers: {
						'x-request-id': 'req-1',
						'api-version': '2026-07',
						ratelimit: RATE_LIMIT,
						'ratelimit-policy': RATE_LIMIT_POLICY,
					},
				}
			: { data: { me: { id: '1' } } },
	);
	const context = {
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name === 'authentication' ? 'accessToken' : (params[name] ?? fallback),
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
	return { context, client: new MondayGraphQLClient(context), httpRequestWithAuthentication };
}

const sentOptions = (mock: ReturnType<typeof vi.fn>) =>
	(mock.mock.calls[0] as unknown as [string, IDataObject & { headers: IDataObject }])[1];

describe('parseRateLimitHeader', () => {
	it('reads each policy with readable parameter names', () => {
		expect(parseRateLimitHeader(RATE_LIMIT)).toEqual({
			minuteRate: { remaining: 3334 },
			complexityMinute: { remaining: 9999999, resetSeconds: 60 },
		});
		expect(parseRateLimitHeader(RATE_LIMIT_POLICY)).toEqual({
			minuteRate: { limit: 3335, windowSeconds: 60 },
			concurrency: { limit: 200, unit: 'concurrent-requests' },
		});
		expect(parseRateLimitHeader(undefined)).toBeUndefined();
	});
});

describe('GraphQL: Get Rate Limits', () => {
	it('returns the budget from the response headers', async () => {
		const { context, client, httpRequestWithAuthentication } = makeHttpContext();
		const result = await getLimits.call(context, client, 0);

		expect(sentOptions(httpRequestWithAuthentication).returnFullResponse).toBe(true);
		expect(result).toEqual({
			rateLimit: parseRateLimitHeader(RATE_LIMIT),
			rateLimitPolicy: parseRateLimitHeader(RATE_LIMIT_POLICY),
			apiVersionRequested: '2026-10',
			apiVersionReturned: '2026-07',
			requestId: 'req-1',
			statusCode: 200,
		});
	});
});

describe('GraphQL: Execute Query', () => {
	it('sends the query with its variables and returns the data', async () => {
		const { context, client, httpRequestWithAuthentication } = makeHttpContext({
			query: 'query ($ids: [ID!]) { users(ids: $ids) { id } }',
			variables: '{"ids": ["1"]}',
		});
		expect(await graphql.call(context, client, 0)).toEqual({ me: { id: '1' } });

		const options = sentOptions(httpRequestWithAuthentication);
		expect(options.body).toEqual({
			query: 'query ($ids: [ID!]) { users(ids: $ids) { id } }',
			variables: { ids: ['1'] },
		});
		expect(options.returnFullResponse).toBe(false);
	});

	it('sends the chosen API version and adds the request info', async () => {
		const { context, client, httpRequestWithAuthentication } = makeHttpContext({
			query: '{ version { value } }',
			graphqlOptions: { apiVersion: '2026-07', includeRequestInfo: true },
		});
		const result = await graphql.call(context, client, 0);

		expect(sentOptions(httpRequestWithAuthentication).headers['API-Version']).toBe('2026-07');
		expect(result.version).toEqual({ value: '2026-07' });
		expect(result.requestInfo).toMatchObject({
			apiVersionRequested: '2026-07',
			apiVersionReturned: '2026-07',
		});
	});

	it('rejects an API version that is not yyyy-mm', async () => {
		const { context, client, httpRequestWithAuthentication } = makeHttpContext({
			query: '{ me { id } }',
			graphqlOptions: { apiVersion: '2026-07\r\nX-Other: 1' },
		});
		await expect(graphql.call(context, client, 0)).rejects.toThrow('is not valid');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects variables that are not a JSON object', async () => {
		const { context, client } = makeHttpContext({ query: '{ me { id } }', variables: '[1]' });
		await expect(graphql.call(context, client, 0)).rejects.toThrow(
			'Variables must be a JSON object',
		);
	});

	it('sends no variables for an empty object', async () => {
		const { context, client, httpRequestWithAuthentication } = makeHttpContext({
			query: '{ me { id } }',
			variables: {},
		});
		await graphql.call(context, client, 0);
		expect(sentOptions(httpRequestWithAuthentication).body).toEqual({ query: '{ me { id } }' });
	});
});

describe('API version picker', () => {
	it('lists the versions newest first, without dev', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			data: {
				versions: [
					{ kind: 'maintenance', value: '2026-07', display_name: 'Maintenance' },
					{ kind: 'dev', value: 'dev', display_name: 'Dev' },
					{ kind: 'current', value: '2026-10', display_name: 'Current' },
				],
			},
		}));
		const context = {
			getNode: () => ({ name: 'monday.com' }),
			getNodeParameter: () => 'accessToken',
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;

		expect(await getApiVersions.call(context)).toEqual([
			{ name: '2026-10 (Current)', value: '2026-10' },
			{ name: '2026-07 (Maintenance)', value: '2026-07' },
		]);
	});
});
