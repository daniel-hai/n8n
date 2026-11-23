import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { isPlainJsonObject, safeJsonParse } from '../../helpers/json';
import { API_VERSION_PATTERN, buildRequestInfoOutput } from '../../helpers/requestInfo';
import { MONDAY_API_VERSION } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '{\n  me {\n    id\n    name\n  }\n}',
		required: true,
		description: 'The GraphQL query or mutation to run',
	},
	{
		displayName: 'Variables',
		name: 'variables',
		type: 'json',
		default: '{}',
		description:
			'The GraphQL variables, as a JSON object, for example {"boardIds": [123]}. Use them in the query as $boardIds. Use variables instead of putting values into the query text.',
	},
	{
		displayName: 'Options',
		name: 'graphqlOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'API Version Name or ID',
				name: 'apiVersion',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getApiVersions' },
				default: MONDAY_API_VERSION,
				description:
					'The monday.com API version for this request. The list shows the lifecycle of each version. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Include Request Info',
				name: 'includeRequestInfo',
				type: 'boolean',
				default: false,
				description:
					'Whether to add a requestInfo object with the remaining rate limits, the quota, the requested and returned API version, the request ID and the HTTP status code',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['graphql'],
		operation: ['graphql'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Reads the Variables field. An empty object sends no variables. */
export function parseGraphqlVariables(
	this: IExecuteFunctions,
	itemIndex: number,
): Record<string, unknown> | undefined {
	const raw = this.getNodeParameter('variables', itemIndex, '{}');
	if (raw === null || raw === undefined || raw === '') return undefined;
	const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
	if (!isPlainJsonObject(parsed)) {
		throw new NodeOperationError(
			this.getNode(),
			'Variables must be a JSON object, for example {"boardIds": [123]}',
			{ itemIndex },
		);
	}
	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/** GraphQL: Execute Query — runs the query of the user with the node credential. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const query = this.getNodeParameter('query', itemIndex) as string;
	if (!query.trim()) {
		throw new NodeOperationError(this.getNode(), 'Enter a query', { itemIndex });
	}
	const variables = parseGraphqlVariables.call(this, itemIndex);
	const options = this.getNodeParameter('graphqlOptions', itemIndex, {}) as IDataObject;
	const apiVersion = String(options.apiVersion ?? '').trim() || undefined;
	if (apiVersion !== undefined && !API_VERSION_PATTERN.test(apiVersion)) {
		throw new NodeOperationError(this.getNode(), `API version "${apiVersion}" is not valid`, {
			itemIndex,
			description: 'Use the form yyyy-mm, for example 2026-10.',
		});
	}

	if (apiVersion === undefined && options.includeRequestInfo !== true) {
		return await client.execute(query, itemIndex, variables);
	}
	const { data, requestInfo } = await client.executeWithInfo(query, itemIndex, variables, {
		apiVersion,
	});
	if (options.includeRequestInfo !== true) return data;
	return {
		...data,
		requestInfo: buildRequestInfoOutput(requestInfo, apiVersion ?? MONDAY_API_VERSION),
	};
}
