import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { normalizeIdList } from '../../helpers/filterOptions';
import { buildUserFieldSelection } from '../../helpers/userFields';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'userFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		options: [
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				default: '',
				description:
					'Only return users with these email addresses (comma-separated). Do not use it together with Search.',
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Guests Only', value: 'guests' },
					{ name: 'Non-Guests Only', value: 'non_guests' },
					{ name: 'Non-Pending Only', value: 'non_pending' },
				],
				default: 'all',
				description: 'Only return users of this kind',
			},
			{
				displayName: 'Search',
				name: 'name',
				type: 'string',
				default: '',
				description:
					'Only return users whose name or email matches this text. monday.com does the matching, so large accounts stay fast.',
			},
			{
				displayName: 'User IDs',
				name: 'userIds',
				type: 'string',
				default: '',
				description: 'Only return these users (comma-separated IDs)',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Higher limits consume more of your account’s API complexity budget per run',
			},
			{
				displayName: 'Newest First',
				name: 'newestFirst',
				type: 'boolean',
				default: false,
				description: 'Whether to return the most recently created users first',
			},
			{
				displayName: 'Page',
				name: 'page',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				description:
					'Which page of results to fetch (page size = limit). Increment it across runs to walk through large accounts.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['user'],
		operation: ['getUsers'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Kind filter value → users() arguments. Only these values reach the API. */
const USER_KIND_ARGUMENTS: Record<string, { userKind?: IDataObject; status?: string[] }> = {
	all: {},
	guests: { userKind: { in: ['GUEST'] } },
	non_guests: { userKind: { not_in: ['GUEST'] } },
	non_pending: { status: ['ACTIVE'] },
};

/**
 * User: Get Many — monday.com applies every filter, so no user list is
 * filtered in n8n. Search maps to users(name:), which matches names and
 * emails.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const filters = this.getNodeParameter('userFilters', itemIndex, {}) as IDataObject;
	const kind = String(filters.kind || 'all');
	const kindArguments = USER_KIND_ARGUMENTS[kind];
	if (!kindArguments) {
		throw new NodeOperationError(this.getNode(), `Kind "${kind}" is not supported`, {
			itemIndex,
			description: `Use one of: ${Object.keys(USER_KIND_ARGUMENTS).join(', ')}.`,
		});
	}

	const varDefs = ['$limit: Int!', '$page: Int!'];
	const args = ['limit: $limit', 'page: $page'];
	const variables: Record<string, unknown> = {
		limit: (options.limit as number) ?? DEFAULT_LIMIT,
		page: (options.page as number) ?? 1,
	};
	const addArgument = (name: string, type: string, variable: string, value: unknown) => {
		varDefs.push(`$${variable}: ${type}`);
		args.push(`${name}: $${variable}`);
		variables[variable] = value;
	};

	const name = String(filters.name ?? '').trim();
	const emails = normalizeIdList(filters.emails);
	if (name && emails.length > 0) {
		throw new NodeOperationError(this.getNode(), 'Use the Search filter or the Emails filter', {
			itemIndex,
			description:
				'monday.com returns no users when both filters are set. Search also matches email addresses.',
		});
	}
	if (name) addArgument('name', 'String', 'name', name);
	if (kindArguments.userKind) {
		addArgument('user_kind', 'UserKindFilterInput', 'userKind', kindArguments.userKind);
	}
	if (kindArguments.status) addArgument('status', '[UserStatus!]', 'status', kindArguments.status);
	if (emails.length > 0) addArgument('emails', '[String!]', 'emails', emails);
	const userIds = normalizeIdList(filters.userIds);
	if (userIds.length > 0) addArgument('ids', '[ID!]', 'ids', userIds);
	if (options.newestFirst === true) {
		addArgument('sort', '[UsersSortInput!]', 'sort', [{ field: 'CREATED_AT', direction: 'DESC' }]);
	}

	const data = await client.execute(
		`query (${varDefs.join(', ')}) {
			users(${args.join(', ')}) { ${buildUserFieldSelection(false)} }
		}`,
		itemIndex,
		variables,
	);
	return (data.users ?? []) as IDataObject[];
}
