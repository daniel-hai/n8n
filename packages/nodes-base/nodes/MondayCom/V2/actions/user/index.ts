import type { INodeProperties } from 'n8n-workflow';

import * as getMe from './getMe.operation';
import * as getUser from './getUser.operation';
import * as getUserActivityLogs from './getUserActivityLogs.operation';
import * as getUsers from './getUsers.operation';
import * as searchUsersAccount from './searchUsersAccount.operation';

export { getMe, getUser, getUserActivityLogs, getUsers, searchUsersAccount };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['user'] } },
		options: [
			{
				name: 'Get',
				value: 'getUser',
				action: 'Get a user',
				description: 'Return a single user profile',
			},
			{
				name: 'Get Current',
				value: 'getMe',
				action: 'Get the current user',
				description: 'Return the profile of the user who owns the credential',
			},
			{
				name: 'Get Many',
				value: 'getUsers',
				action: 'Get many users',
				description: 'Return a page of users, with optional filters',
			},
			{
				name: 'List Activity Logs',
				value: 'getUserActivityLogs',
				action: 'List user activity logs',
				description:
					'Return the activity log events of a user across boards, with optional filters',
			},
			{
				name: 'Search',
				value: 'searchUsersAccount',
				action: 'Search users',
				description: 'Find users account-wide by name or email',
			},
		],
		default: 'getUser',
	},
	...getMe.description,
	...getUser.description,
	...getUserActivityLogs.description,
	...getUsers.description,
	...searchUsersAccount.description,
];
