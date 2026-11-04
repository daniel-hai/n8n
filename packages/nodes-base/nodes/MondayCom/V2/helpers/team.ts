import { type IDataObject, type IExecuteFunctions, NodeOperationError } from 'n8n-workflow';

import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/** Team fields shared by Team: Get and Team: Get Many. */
export const TEAM_FIELDS = 'id name is_guest picture_url created_at owners { id name }';

const TEAM_MEMBER_FIELDS = 'id name email title kind status';

export interface TeamRow extends IDataObject {
	id: string;
	name: string;
	users?: IDataObject[];
}

/**
 * Reads the team from the `teamId` locator. monday answers an unknown team
 * ID with an empty list, so the empty case becomes a "not found" error.
 */
export async function fetchTeam(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	options: { includeMembers: boolean },
): Promise<TeamRow> {
	const teamId = this.getNodeParameter('teamId', itemIndex, undefined, {
		extractValue: true,
	}) as string;
	const members = options.includeMembers ? ` users { ${TEAM_MEMBER_FIELDS} }` : '';
	const data = await client.execute(
		`query ($ids: [ID!]) { teams(ids: $ids) { ${TEAM_FIELDS}${members} } }`,
		itemIndex,
		{ ids: [teamId] },
	);
	const team = ((data.teams ?? []) as TeamRow[])[0];
	if (!team) {
		throw new NodeOperationError(
			this.getNode(),
			`Team ${teamId} was not found. It may never have existed, or your API token may not have access to it.`,
			{ itemIndex },
		);
	}
	return team;
}
