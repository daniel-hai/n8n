import type { INodeProperties } from 'n8n-workflow';

import * as getTeam from './getTeam.operation';
import * as getTeamMembers from './getTeamMembers.operation';
import * as getTeams from './getTeams.operation';

export { getTeam, getTeamMembers, getTeams };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['team'] } },
		options: [
			{
				name: 'Get',
				value: 'getTeam',
				action: 'Get a team',
				description: 'Return a single team with its owners',
			},
			{
				name: 'Get Many',
				value: 'getTeams',
				action: 'Get many teams',
				description: 'Return all teams of the account',
			},
			{
				name: 'Get Members',
				value: 'getTeamMembers',
				action: 'Get team members',
				description: 'Return the users of a team, one output item per user',
			},
		],
		default: 'getTeam',
	},
	...getTeam.description,
	...getTeamMembers.description,
	...getTeams.description,
];
