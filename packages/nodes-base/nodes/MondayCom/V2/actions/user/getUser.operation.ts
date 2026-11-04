import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { buildUserFieldSelection } from '../../helpers/userFields';
import { userNotFoundError, userResourceLocator } from '../../helpers/userLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	userResourceLocator,
	{
		displayName: 'Options',
		name: 'getUserOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Include Extended Info',
				name: 'includeExtendedInfo',
				type: 'boolean',
				default: false,
				description:
					'Whether to also return the extended profile: account ID, activation date, birthday, country, language, invitation method, email confirmation, serial number, UTC offset, out-of-office status, user config, and every photo size',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['user'],
		operation: ['getUser'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const userId = this.getNodeParameter('userId', itemIndex, undefined, {
		extractValue: true,
	}) as string;
	const options = this.getNodeParameter('getUserOptions', itemIndex, {}) as IDataObject;
	const data = await client.execute(
		`query ($ids: [ID!]) {
			users(ids: $ids) { ${buildUserFieldSelection(options.includeExtendedInfo === true)} }
		}`,
		itemIndex,
		{ ids: [userId] },
	);
	const user = ((data.users ?? []) as IDataObject[])[0];
	if (!user) throw userNotFoundError(this.getNode(), userId, itemIndex);
	return user;
}
