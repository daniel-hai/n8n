import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import { assertCustomActivityExists, customActivityProperty } from '../../helpers/emailsActivities';
import { requireText } from '../../helpers/validation';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		...customActivityProperty,
		description:
			'The activity type to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName:
			'Deleting a custom activity cannot be undone. You cannot delete the built-in activity types.',
		name: 'deleteCustomActivityNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['deleteCustomActivity'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Emails & Activities: Delete Custom Activity. monday.com gives an internal
 * error for an unknown ID, so the node checks the ID first.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const id = requireText.call(this, 'customActivityId', 'Custom Activity', itemIndex);
	const activity = await assertCustomActivityExists(this, client, id, itemIndex);
	await client.execute(
		'mutation ($id: String!) { delete_custom_activity(id: $id) { name } }',
		itemIndex,
		{ id },
	);
	return withArchiveOrDeleteOutcome(activity, 'delete', 'customActivity');
}
