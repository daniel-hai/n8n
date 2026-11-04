import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	CUSTOM_ACTIVITY_COLOR_OPTIONS,
	CUSTOM_ACTIVITY_FIELDS,
	CUSTOM_ACTIVITY_ICON_OPTIONS,
} from '../../helpers/emailsActivities';
import { assertAllowedValue, requireText } from '../../helpers/validation';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'customActivityName',
		type: 'string',
		default: '',
		required: true,
		description: 'The name of the activity type. Names do not have to be unique.',
	},
	{
		displayName: 'Color',
		name: 'customActivityColor',
		type: 'options',
		options: CUSTOM_ACTIVITY_COLOR_OPTIONS,
		default: 'SLATE_BLUE',
		description: 'The color of the entries of this activity type',
	},
	{
		displayName: 'Icon',
		name: 'customActivityIcon',
		type: 'options',
		options: CUSTOM_ACTIVITY_ICON_OPTIONS,
		default: 'NOTEBOOK',
		description: 'The icon of the entries of this activity type',
	},
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['createCustomActivity'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Emails & Activities: Create Custom Activity. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const name = requireText.call(this, 'customActivityName', 'Name', itemIndex);
	const color = assertAllowedValue.call(
		this,
		String(this.getNodeParameter('customActivityColor', itemIndex)),
		CUSTOM_ACTIVITY_COLOR_OPTIONS,
		'Color',
		itemIndex,
	);
	const iconId = assertAllowedValue.call(
		this,
		String(this.getNodeParameter('customActivityIcon', itemIndex)),
		CUSTOM_ACTIVITY_ICON_OPTIONS,
		'Icon',
		itemIndex,
	);
	const data = await client.execute(
		`mutation ($name: String!, $color: CustomActivityColor!, $iconId: CustomActivityIcon!) {
			create_custom_activity(name: $name, color: $color, icon_id: $iconId) { ${CUSTOM_ACTIVITY_FIELDS} }
		}`,
		itemIndex,
		{ name, color, iconId },
	);
	return (data.create_custom_activity ?? {}) as IDataObject;
}
