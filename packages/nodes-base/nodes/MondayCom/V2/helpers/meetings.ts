import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';

import { RETURN_ALL_HARD_CAP } from './pagination';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * monday.com Notetaker meetings. The API is read-only and returns only
 * meetings with a completed recording. The access filter defaults to OWN.
 */

/** The API rejects a page larger than 100. */
export const MEETINGS_PAGE_SIZE = 100;

export const MEETING_ACCESS_FILTER_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'All Accessible',
		value: 'ALL',
		description: 'Your meetings and the meetings shared with you or the account',
	},
	{
		name: 'Owned by Me',
		value: 'OWN',
		description: 'Only your meetings. This is the API default.',
	},
	{ name: 'Shared With Account', value: 'SHARED_WITH_ACCOUNT' },
	{ name: 'Shared With Me', value: 'SHARED_WITH_ME' },
];

const MEETING_BASE_FIELDS = `
	id
	title
	start_time
	end_time
	recording_duration
	access_type
	meeting_link
	summary
	participants { email }
`;

export interface MeetingFieldToggles {
	topics?: boolean;
	actionItems?: boolean;
	transcript?: boolean;
}

/** A transcript can have thousands of entries, so every nested list is opt-in. */
export function buildMeetingFields(toggles: MeetingFieldToggles): string {
	const parts = [MEETING_BASE_FIELDS];
	if (toggles.topics) parts.push('topics { title talking_points { content } }');
	if (toggles.actionItems) parts.push('action_items { id content is_completed owner due_date }');
	if (toggles.transcript) parts.push('transcript { text start_time end_time speaker language }');
	return parts.join('\n');
}

export interface MeetingsFilter {
	ids?: string[];
	search?: string;
	access?: string;
}

/** Returns undefined when no filter is set, so the API default applies. */
export function buildMeetingsFilter(input: MeetingsFilter): MeetingsFilter | undefined {
	const filter: MeetingsFilter = {};
	if (input.ids?.length) filter.ids = input.ids;
	const search = input.search?.trim();
	if (search) filter.search = search;
	if (input.access) filter.access = input.access;
	return Object.keys(filter).length > 0 ? filter : undefined;
}

export const meetingResourceLocator: INodeProperties = {
	displayName: 'Meeting',
	name: 'meetingId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The Notetaker meeting',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchMeetings', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 123456789',
		},
	],
};

interface MeetingsPage {
	meetings?: IDataObject[] | null;
	page_info?: { has_next_page?: boolean | null; cursor?: string | null } | null;
}

const MEETINGS_QUERY = (fields: string) => `query ($limit: Int, $cursor: String, $filters: MeetingsFilterInput) {
	notetaker {
		meetings(limit: $limit, cursor: $cursor, filters: $filters) {
			meetings { ${fields} }
			page_info { has_next_page cursor }
		}
	}
}`;

function readMeetingsPage(data: IDataObject): MeetingsPage | undefined {
	const notetaker = data.notetaker as { meetings?: MeetingsPage } | null | undefined;
	return notetaker?.meetings ?? undefined;
}

const nextCursorOf = (page: MeetingsPage) =>
	page.page_info?.has_next_page ? (page.page_info.cursor ?? null) : null;

/**
 * listSearch for the Meeting picker. The search text goes to the API, and
 * access ALL also lists shared meetings. The cursor is the pagination token.
 */
export async function searchMeetings(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const client = new MondayGraphQLClient(this);
	const data = await client.execute(MEETINGS_QUERY('id title start_time meeting_link'), 0, {
		limit: 50,
		cursor: paginationToken ?? null,
		filters: paginationToken ? null : buildMeetingsFilter({ search: filter, access: 'ALL' }),
	});
	const page = readMeetingsPage(data);
	const meetings = (page?.meetings ?? []) as Array<{
		id: string;
		title?: string | null;
		start_time?: string | null;
		meeting_link?: string | null;
	}>;
	return {
		results: meetings.map((meeting) => {
			const title = meeting.title || meeting.id;
			return {
				name: meeting.start_time ? `${title} (${meeting.start_time.slice(0, 10)})` : title,
				value: meeting.id,
				url: meeting.meeting_link || undefined,
			};
		}),
		paginationToken: (page && nextCursorOf(page)) || undefined,
	};
}

export interface MeetingsFetchOptions {
	client: MondayGraphQLClient;
	itemIndex: number;
	filter?: MeetingsFilter;
	fields: string;
	limit: number;
	/** A cursor from an earlier run. The cursor holds the filter, so the filter is not sent. */
	startCursor?: string;
}

/** Cursor paging. Each page asks only for the rows that are still needed. */
export async function fetchMeetings(
	options: MeetingsFetchOptions,
): Promise<{ rows: IDataObject[]; nextCursor: string | null }> {
	const max = Math.min(options.limit, RETURN_ALL_HARD_CAP);
	const rows: IDataObject[] = [];
	let cursor: string | null = options.startCursor || null;
	let first = !cursor;

	while (rows.length < max && (cursor || first)) {
		const data = await options.client.execute(MEETINGS_QUERY(options.fields), options.itemIndex, {
			limit: Math.min(MEETINGS_PAGE_SIZE, max - rows.length),
			cursor,
			filters: cursor ? null : (options.filter ?? null),
		});
		first = false;
		const page = readMeetingsPage(data);
		if (!page) break;
		const pageRows = page.meetings ?? [];
		rows.push(...pageRows);
		cursor = nextCursorOf(page);
		if (pageRows.length === 0) break;
	}

	return { rows: rows.slice(0, max), nextCursor: cursor };
}
