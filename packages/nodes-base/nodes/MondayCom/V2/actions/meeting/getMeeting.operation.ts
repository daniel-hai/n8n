import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { buildMeetingFields, fetchMeetings, meetingResourceLocator } from '../../helpers/meetings';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	meetingResourceLocator,
	{
		displayName: 'Options',
		name: 'getMeetingOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Include Action Items',
				name: 'includeActionItems',
				type: 'boolean',
				default: true,
				description: 'Whether to return the action items of the meeting',
			},
			{
				displayName: 'Include Topics',
				name: 'includeTopics',
				type: 'boolean',
				default: true,
				description: 'Whether to return the topics and their talking points',
			},
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: false,
				description:
					'Whether to return the full transcript, with the speaker, text and time of each part. A long meeting can have thousands of parts.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['meeting'],
		operation: ['getMeeting'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Meeting: Get. Access ALL also finds meetings that others shared. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const meetingId = String(
		this.getNodeParameter('meetingId', itemIndex, '', { extractValue: true }),
	).trim();
	if (!meetingId) {
		throw new NodeOperationError(this.getNode(), 'Meeting is required', { itemIndex });
	}
	const options = this.getNodeParameter('getMeetingOptions', itemIndex, {}) as IDataObject;

	const { rows } = await fetchMeetings({
		client,
		itemIndex,
		filter: { ids: [meetingId], access: 'ALL' },
		fields: buildMeetingFields({
			topics: options.includeTopics !== false,
			actionItems: options.includeActionItems !== false,
			transcript: options.includeTranscript === true,
		}),
		limit: 1,
	});
	if (rows[0]) return rows[0];
	throw new NodeOperationError(this.getNode(), `Meeting ${meetingId} was not found`, {
		itemIndex,
		description:
			'The API returns only meetings with a completed recording that you own or that are shared with you.',
	});
}
