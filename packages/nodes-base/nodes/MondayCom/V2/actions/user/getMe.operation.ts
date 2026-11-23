import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { buildUserFieldSelection } from '../../helpers/userFields';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [];

const displayOptions = {
	show: {
		resource: ['user'],
		operation: ['getMe'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** User: Get Current — the profile of the user who owns the credential. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const data = await client.execute(
		`query { me { ${buildUserFieldSelection(false)} } }`,
		itemIndex,
	);
	if (!data.me) {
		throw new NodeOperationError(this.getNode(), 'monday.com returned no current user', {
			itemIndex,
			description: 'Check that the credential belongs to an active user.',
		});
	}
	return data.me as IDataObject;
}
