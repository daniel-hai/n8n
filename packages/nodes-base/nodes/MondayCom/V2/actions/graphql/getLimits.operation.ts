import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { buildRequestInfoOutput } from '../../helpers/requestInfo';
import { MONDAY_API_VERSION } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [];

const displayOptions = {
	show: {
		resource: ['graphql'],
		operation: ['getLimits'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * GraphQL: Get Rate Limits — the budget comes from the response headers,
 * so the query is the cheapest valid request.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const { requestInfo } = await client.executeWithInfo('query { version { value } }', itemIndex);
	return buildRequestInfoOutput(requestInfo, MONDAY_API_VERSION);
}
