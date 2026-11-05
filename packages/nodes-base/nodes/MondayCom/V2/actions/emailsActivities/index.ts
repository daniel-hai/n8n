import type { INodeProperties } from 'n8n-workflow';

import * as createCustomActivity from './createCustomActivity.operation';
import * as createTimelineItem from './createTimelineItem.operation';
import * as deleteCustomActivity from './deleteCustomActivity.operation';
import * as deleteTimelineItem from './deleteTimelineItem.operation';
import * as getCustomActivities from './getCustomActivities.operation';
import * as getTimelineItem from './getTimelineItem.operation';
import * as getTimelineItems from './getTimelineItems.operation';
import * as searchTimelineItemsAccount from './searchTimelineItemsAccount.operation';

export {
	createCustomActivity,
	createTimelineItem,
	deleteCustomActivity,
	deleteTimelineItem,
	getCustomActivities,
	getTimelineItem,
	getTimelineItems,
	searchTimelineItemsAccount,
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['emailsActivities'] } },
		options: [
			{
				name: 'Create Custom Activity',
				value: 'createCustomActivity',
				action: 'Create a custom activity',
				description: 'Create an activity type for the Emails & Activities timeline',
			},
			{
				name: 'Create Timeline Item',
				value: 'createTimelineItem',
				action: 'Create a timeline item',
				description: 'Log an activity on the Emails & Activities timeline of an item',
			},
			{
				name: 'Delete Custom Activity',
				value: 'deleteCustomActivity',
				action: 'Delete a custom activity',
				description: 'Delete an activity type permanently',
			},
			{
				name: 'Delete Timeline Item',
				value: 'deleteTimelineItem',
				action: 'Delete a timeline item',
				description: 'Delete an entry from the Emails & Activities timeline',
			},
			{
				name: 'Get Many Custom Activities',
				value: 'getCustomActivities',
				action: 'Get many custom activities',
				description: 'Return the activity types of the account, at most 50',
			},
			{
				name: 'Get Many Timeline Items',
				value: 'getTimelineItems',
				action: 'Get many timeline items',
				description:
					'Return the Emails & Activities timeline of an item. Only entries that the API created are visible.',
			},
			{
				name: 'Get Timeline Item',
				value: 'getTimelineItem',
				action: 'Get a timeline item',
				description: 'Return one entry of the Emails & Activities timeline',
			},
			{
				name: 'Search Timeline Items',
				value: 'searchTimelineItemsAccount',
				action: 'Search timeline items',
				description: 'Find Emails & Activities entries across the account by keyword',
			},
		],
		default: 'createTimelineItem',
	},
	...createCustomActivity.description,
	...createTimelineItem.description,
	...deleteCustomActivity.description,
	...deleteTimelineItem.description,
	...getCustomActivities.description,
	...getTimelineItem.description,
	...getTimelineItems.description,
	...searchTimelineItemsAccount.description,
];
