import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	TIMELINE_ITEM_FIELDS,
	timelineItemIdProperty,
	withTimelineItemErrors,
} from '../../helpers/emailsActivities';
import { requireText } from '../../helpers/validation';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [timelineItemIdProperty];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['getTimelineItem'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Emails & Activities: Get Timeline Item. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const id = requireText.call(this, 'timelineItemId', 'Timeline Item ID', itemIndex);
	const data = await withTimelineItemErrors(
		this,
		itemIndex,
		id,
		async () =>
			await client.execute(
				`query ($id: ID!) { timeline_item(id: $id) { ${TIMELINE_ITEM_FIELDS} } }`,
				itemIndex,
				{ id },
			),
	);
	return (data.timeline_item ?? { id }) as IDataObject;
}
