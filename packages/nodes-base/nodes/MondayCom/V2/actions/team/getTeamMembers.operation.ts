import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { fetchTeam } from '../../helpers/team';
import { teamResourceLocator } from '../../helpers/userLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [teamResourceLocator];

const displayOptions = {
	show: {
		resource: ['team'],
		operation: ['getTeamMembers'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Team: Get Members — one output item per user, tagged with the team. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const team = await fetchTeam.call(this, client, itemIndex, { includeMembers: true });
	return (team.users ?? []).map((user) => ({ ...user, teamId: team.id, teamName: team.name }));
}
