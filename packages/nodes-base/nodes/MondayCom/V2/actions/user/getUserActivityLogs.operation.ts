import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { type ActivityLogRow, formatActivityLogRow } from '../../helpers/activityLog';
import { normalizeIdList, parseDateFilter } from '../../helpers/filterOptions';
import { userNotFoundError, userResourceLocator } from '../../helpers/userLocator';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	userResourceLocator,
	{
		displayName: 'Filters',
		name: 'userActivityLogFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		options: [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Boards',
				name: 'boardIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getBoardList' },
				default: [],
				description:
					'Only return events on these boards. The list shows only the 500 most recently used boards; for boards beyond that window, pass explicit IDs via an expression (an array or a comma-separated string). Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Event Types',
				name: 'eventTypes',
				type: 'string',
				default: '',
				placeholder: 'e.g. update_column_value, create_pulse',
				description:
					'Only return these event types (comma-separated). The names match the event field of the output.',
			},
			{
				displayName: 'From',
				name: 'from',
				type: 'dateTime',
				default: '',
				description: 'Only return events from this time onward',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'dateTime',
				default: '',
				description: 'Only return events up to this time',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'userActivityLogOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Include Cursor',
				name: 'includeCursor',
				type: 'boolean',
				default: false,
				description:
					'Whether to add one last output item { nextCursor } after the events. Put it in Starting Cursor to get the next page. A null cursor means there are no more events.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Higher limits consume more of your account’s API complexity budget per run. See the Get Rate Limits operation.',
			},
			{
				displayName: 'Starting Cursor',
				name: 'startingCursor',
				type: 'string',
				default: '',
				description:
					'Continue from this cursor (from a previous run with Include Cursor on) instead of the most recent event',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['user'],
		operation: ['getUserActivityLogs'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** monday.com returns at most this many activity log events per request. */
const PAGE_SIZE = 100;
/** Stops the cursor loop if the API keeps returning a cursor. */
const MAX_PAGES = 1000;

/**
 * User: List Activity Logs — users(ids:){ activity_logs } pages by cursor,
 * newest event first. The filters go with every page, so a resumed run
 * keeps them.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const userId = this.getNodeParameter('userId', itemIndex, undefined, {
		extractValue: true,
	}) as string;
	const filters = this.getNodeParameter('userActivityLogFilters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('userActivityLogOptions', itemIndex, {}) as IDataObject;
	const limit = (options.limit as number) ?? DEFAULT_LIMIT;
	let cursor: string | null = String(options.startingCursor ?? '').trim() || null;

	const varDefs = ['$ids: [ID!]', '$limit: Int', '$cursor: String'];
	const args = ['limit: $limit', 'cursor: $cursor'];
	const baseVariables: Record<string, unknown> = { ids: [userId] };
	const addFilter = (name: string, type: string, variable: string, value: unknown) => {
		varDefs.push(`$${variable}: ${type}`);
		args.push(`${name}: $${variable}`);
		baseVariables[variable] = value;
	};

	const from = parseDateFilter.call(this, filters.from, 'From', itemIndex);
	if (from) addFilter('from', 'String', 'from', from);
	const to = parseDateFilter.call(this, filters.to, 'To', itemIndex);
	if (to) addFilter('to', 'String', 'to', to);
	const boardIds = normalizeIdList(filters.boardIds);
	if (boardIds.length > 0) addFilter('board_ids', '[ID!]', 'boardIds', boardIds);
	const eventTypes = normalizeIdList(filters.eventTypes);
	if (eventTypes.length > 0) addFilter('event_types', '[String!]', 'eventTypes', eventTypes);

	const query = `query (${varDefs.join(', ')}) {
		users(ids: $ids) {
			activity_logs(${args.join(', ')}) {
				cursor
				logs { id event entity data user_id account_id created_at }
			}
		}
	}`;

	const rows: IDataObject[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const pageLimit = Math.min(limit - rows.length, PAGE_SIZE);
		const data = await client.execute(query, itemIndex, {
			...baseVariables,
			limit: pageLimit,
			cursor,
		});
		const users = (data.users ?? []) as Array<{
			activity_logs?: { cursor?: string | null; logs?: ActivityLogRow[] } | null;
		}>;
		if (users.length === 0) throw userNotFoundError(this.getNode(), userId, itemIndex);

		const logs = users[0].activity_logs?.logs ?? [];
		rows.push(...logs.map((log) => ({ ...formatActivityLogRow(log), targetUserId: userId })));
		cursor = users[0].activity_logs?.cursor ?? null;
		if (!cursor || logs.length < pageLimit || rows.length >= limit) break;
	}

	return options.includeCursor === true ? [...rows, { nextCursor: cursor }] : rows;
}
