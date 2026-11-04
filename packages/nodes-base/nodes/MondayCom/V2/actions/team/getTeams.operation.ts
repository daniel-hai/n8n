import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { TEAM_FIELDS } from '../../helpers/team';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [];

const displayOptions = {
	show: {
		resource: ['team'],
		operation: ['getTeams'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Team: Get Many — every team of the account, one output item per team. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const data = await client.execute(`query { teams { ${TEAM_FIELDS} } }`, itemIndex);
	return (data.teams ?? []) as IDataObject[];
}
