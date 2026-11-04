import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { CUSTOM_ACTIVITY_FIELDS } from '../../helpers/emailsActivities';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'customActivityFilters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description:
					'Return only the activity types whose name contains this text. The match ignores case.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['getCustomActivities'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Emails & Activities: Get Many Custom Activities. The API returns at most 50. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('customActivityFilters', itemIndex, {}) as IDataObject;
	const name = typeof filters.name === 'string' && filters.name.trim() ? filters.name.trim() : null;
	const data = await client.execute(
		`query ($name: String) { custom_activity(name: $name) { ${CUSTOM_ACTIVITY_FIELDS} } }`,
		itemIndex,
		{ name },
	);
	return Array.isArray(data.custom_activity) ? (data.custom_activity as IDataObject[]) : [];
}
