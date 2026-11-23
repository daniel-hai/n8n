import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertCustomActivityExists,
	buildTimelineItemVariables,
	customActivityProperty,
	withTimelineTargetErrors,
} from '../../helpers/emailsActivities';
import { mondayError } from '../../helpers/mondayError';
import { requireText } from '../../helpers/validation';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { requireTimelineOwnerId, timelineItemInputProperties } from './itemInput';

const properties: INodeProperties[] = [
	...timelineItemInputProperties,
	{
		...customActivityProperty,
		description:
			'The activity type of the entry. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Title',
		name: 'timelineItemTitle',
		type: 'string',
		default: '',
		required: true,
		description: 'The title of the entry, up to 255 characters',
	},
	{
		displayName: 'Options',
		name: 'timelineItemOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'The body of the entry. Basic HTML such as &lt;b&gt; and &lt;br&gt; works.',
			},
			{
				displayName: 'End Time',
				name: 'timeRangeEnd',
				type: 'dateTime',
				default: '',
				description: 'When the activity ended. Set it together with Start Time.',
			},
			{
				displayName: 'Location',
				name: 'location',
				type: 'string',
				default: '',
				description: 'Free text. monday.com does not check it.',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				description: 'Free text. monday.com does not check it.',
			},
			{
				displayName: 'Start Time',
				name: 'timeRangeStart',
				type: 'dateTime',
				default: '',
				description: 'When the activity started. Set it together with End Time.',
			},
			{
				displayName: 'Summary',
				name: 'summary',
				type: 'string',
				default: '',
				description: 'A short summary, up to 255 characters',
			},
			{
				displayName: 'Timestamp',
				name: 'timestamp',
				type: 'dateTime',
				default: '',
				description:
					'When the activity happened. If empty, the node uses the time of the run. If Start Time is set, monday.com shows the entry at the start time.',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				description: 'A link to attach to the entry',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['createTimelineItem'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Emails & Activities: Create Timeline Item. The mutation does not select
 * created_at: monday.com creates the entry and then fails to resolve it.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const itemId = requireTimelineOwnerId.call(this, itemIndex);
	const customActivityId = requireText.call(this, 'customActivityId', 'Custom Activity', itemIndex);
	const title = requireText.call(this, 'timelineItemTitle', 'Title', itemIndex);
	const options = this.getNodeParameter('timelineItemOptions', itemIndex, {}) as IDataObject;
	const variables = buildTimelineItemVariables.call(this, title, options, itemIndex);

	const data = await withTimelineTargetErrors(this, itemIndex, itemId, async () => {
		try {
			return await client.execute(
				`mutation ($itemId: ID!, $customActivityId: String!, $title: String!, $timestamp: ISO8601DateTime!, $summary: String, $content: String, $location: String, $phone: String, $url: String, $timeRange: TimelineItemTimeRange) {
					create_timeline_item(item_id: $itemId, custom_activity_id: $customActivityId, title: $title, timestamp: $timestamp, summary: $summary, content: $content, location: $location, phone: $phone, url: $url, time_range: $timeRange) {
						id
						title
						content
					}
				}`,
				itemIndex,
				{ itemId, customActivityId, ...variables },
			);
		} catch (error) {
			// INVALID_INPUT also covers other fields, so one query checks the activity.
			if (mondayError(error).code === 'INVALID_INPUT') {
				await assertCustomActivityExists(this, client, customActivityId, itemIndex);
			}
			throw error;
		}
	});

	const created = (data.create_timeline_item ?? {}) as IDataObject;
	return { ...created, custom_activity_id: customActivityId, item_id: itemId };
}
