import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { normalizeIdList } from '../../helpers/filterOptions';
import {
	buildMeetingFields,
	buildMeetingsFilter,
	fetchMeetings,
	MEETING_ACCESS_FILTER_OPTIONS,
} from '../../helpers/meetings';
import { assertAllowedValue } from '../../helpers/validation';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'meetingFilters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		options: [
			{
				displayName: 'Access',
				name: 'access',
				type: 'options',
				options: MEETING_ACCESS_FILTER_OPTIONS,
				default: 'OWN',
				description:
					'Which meetings to return. Without this filter, the API returns only your meetings.',
			},
			{
				displayName: 'Meeting IDs',
				name: 'meetingIds',
				type: 'string',
				default: '',
				placeholder: 'e.g. 123456789, 123456790',
				description: 'Only return these meetings. Enter a comma-separated list.',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description:
					'Only return meetings whose title, participant name or participant email matches this text',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'getMeetingsOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Include Action Items',
				name: 'includeActionItems',
				type: 'boolean',
				default: false,
				description: 'Whether to return the action items of each meeting',
			},
			{
				displayName: 'Include Cursor',
				name: 'includeCursor',
				type: 'boolean',
				default: false,
				description:
					'Whether to add one last output item { nextCursor } after the meetings. Put it in Starting Cursor to get the next page. A null cursor means there are no more meetings.',
			},
			{
				displayName: 'Include Topics',
				name: 'includeTopics',
				type: 'boolean',
				default: false,
				description: 'Whether to return the topics and talking points of each meeting',
			},
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description:
					'Whether to return the full transcript of each meeting. A long meeting can have thousands of parts. To get one transcript, use Get.',
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
					'Continue from the cursor of an earlier run. The cursor holds the filters, so the node ignores Filters.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['meeting'],
		operation: ['getMeetings'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Meeting: Get Many. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('meetingFilters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('getMeetingsOptions', itemIndex, {}) as IDataObject;
	const access =
		typeof filters.access === 'string' && filters.access
			? assertAllowedValue.call(
					this,
					filters.access,
					MEETING_ACCESS_FILTER_OPTIONS,
					'Access',
					itemIndex,
				)
			: undefined;
	const startCursor = String(options.startingCursor ?? '').trim() || undefined;

	const { rows, nextCursor } = await fetchMeetings({
		client,
		itemIndex,
		filter: buildMeetingsFilter({
			ids: normalizeIdList(filters.meetingIds),
			search: typeof filters.search === 'string' ? filters.search : undefined,
			access,
		}),
		fields: buildMeetingFields({
			topics: options.includeTopics === true,
			actionItems: options.includeActionItems === true,
			transcript: options.includeTranscript === true,
		}),
		limit: typeof options.limit === 'number' ? options.limit : DEFAULT_LIMIT,
		startCursor,
	});

	return options.includeCursor === true ? [...rows, { nextCursor }] : rows;
}
