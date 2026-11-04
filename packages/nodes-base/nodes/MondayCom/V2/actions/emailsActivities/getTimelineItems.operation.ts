import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { TIMELINE_ITEM_FIELDS, withTimelineTargetErrors } from '../../helpers/emailsActivities';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { requireTimelineOwnerId, timelineItemInputProperties } from './itemInput';

const TIMELINE_PAGE_SIZE = 100;

const properties: INodeProperties[] = [
	...timelineItemInputProperties,
	{
		displayName: 'Options',
		name: 'getTimelineItemsOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
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
				displayName: 'Skip Connected Items',
				name: 'skipConnectedItems',
				type: 'boolean',
				default: false,
				description:
					'Whether to leave out entries that come from connected items, for example activities on a linked contact',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['getTimelineItems'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

interface TimelinePage {
	cursor?: string | null;
	timeline_items?: IDataObject[];
}

/**
 * Emails & Activities: Get Many Timeline Items. Each page asks only for the
 * rows that are still needed.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const itemId = requireTimelineOwnerId.call(this, itemIndex);
	const options = this.getNodeParameter('getTimelineItemsOptions', itemIndex, {}) as IDataObject;
	const limit = typeof options.limit === 'number' ? options.limit : DEFAULT_LIMIT;
	const skip = options.skipConnectedItems === true ? true : null;

	const rows: IDataObject[] = [];
	let cursor: string | null = null;
	do {
		const variables = {
			id: itemId,
			skip,
			limit: Math.min(TIMELINE_PAGE_SIZE, limit - rows.length),
			cursor,
		};
		const data = await withTimelineTargetErrors(
			this,
			itemIndex,
			itemId,
			async () =>
				await client.execute(
					`query ($id: ID!, $skip: Boolean, $limit: Int, $cursor: String) {
						timeline(id: $id, skipConnectedItems: $skip) {
							timeline_items_page(limit: $limit, cursor: $cursor) {
								cursor
								timeline_items { ${TIMELINE_ITEM_FIELDS} }
							}
						}
					}`,
					itemIndex,
					variables,
				),
		);
		const timeline = (data.timeline ?? {}) as { timeline_items_page?: TimelinePage };
		const pageRows = timeline.timeline_items_page?.timeline_items ?? [];
		rows.push(...pageRows);
		cursor = timeline.timeline_items_page?.cursor ?? null;
		if (pageRows.length === 0) break;
	} while (cursor && rows.length < limit);

	return rows.slice(0, limit);
}
