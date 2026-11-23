import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import { timelineItemIdProperty, withTimelineItemErrors } from '../../helpers/emailsActivities';
import { requireText } from '../../helpers/validation';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	timelineItemIdProperty,
	{
		displayName: 'Deleting a timeline item cannot be undone',
		name: 'deleteTimelineItemNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['deleteTimelineItem'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Emails & Activities: Delete Timeline Item. */
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
				'mutation ($id: String!) { delete_timeline_item(id: $id) { id title } }',
				itemIndex,
				{ id },
			),
	);
	const deleted = (data.delete_timeline_item ?? { id }) as IDataObject;
	return withArchiveOrDeleteOutcome(deleted, 'delete', 'timelineItem');
}
