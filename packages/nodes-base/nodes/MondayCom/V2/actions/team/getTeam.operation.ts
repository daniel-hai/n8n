import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { fetchTeam } from '../../helpers/team';
import { teamResourceLocator } from '../../helpers/userLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [teamResourceLocator];

const displayOptions = {
	show: {
		resource: ['team'],
		operation: ['getTeam'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	return await fetchTeam.call(this, client, itemIndex, { includeMembers: false });
}
