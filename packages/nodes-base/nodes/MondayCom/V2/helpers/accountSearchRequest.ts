import {
	type IDataObject,
	type IExecuteFunctions,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';
import {
	type AccountSearchFilters,
	buildAccountSearchPlan,
	flattenSearchResults,
	SEARCH_OPERATION_ENTITY,
	SEARCH_TIMELINE_KIND_OPTIONS,
	SEARCH_TIMELINE_PRODUCT_OPTIONS,
} from './accountSearch';
import { normalizeIdList, toIso8601 } from './filterOptions';
import { extractUserRowIds } from './userLocator';
import { assertAllowedValue } from './validation';

/**
 * Search: one request against the entity's field on the cross-entity
 * `search` root query. Which entity type is searched follows from the
 * operation (SEARCH_OPERATION_ENTITY). Scale-safe by design: server-side
 * relevance search, hard-capped at 20 results, no pagination (see
 * accountSearch.ts for the verified API contract).
 */
export async function searchAcrossAccount(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	operation: string,
): Promise<IDataObject[]> {
	const entity = SEARCH_OPERATION_ENTITY[operation];
	const searchText = (this.getNodeParameter('searchQuery', itemIndex) as string).trim();
	const includeLiveData = this.getNodeParameter('includeLiveData', itemIndex, false) === true;
	const options = this.getNodeParameter('searchOptions', itemIndex, {}) as IDataObject;

	if (!searchText) {
		throw new NodeOperationError(this.getNode(), 'Query is required', {
			itemIndex,
			description: 'Provide the text to search for.',
		});
	}

	const filters: AccountSearchFilters = {
		boardIds: normalizeIdList(options.boardIds),
		workspaceIds: normalizeIdList(options.workspaceIds),
		creatorIds: extractUserRowIds(options.creatorIds),
		itemIds: normalizeIdList(options.itemIds),
		timelineType: optionalEnum(
			this,
			options.timelineType,
			SEARCH_TIMELINE_KIND_OPTIONS,
			'Timeline Item Type',
			itemIndex,
		),
		timelineProductKind: optionalEnum(
			this,
			options.timelineProductKind,
			SEARCH_TIMELINE_PRODUCT_OPTIONS,
			'Timeline Item Product',
			itemIndex,
		),
		createdAfter: toIso8601(options.createdAfter),
		createdBefore: toIso8601(options.createdBefore),
		updatedAfter: toIso8601(options.updatedAfter),
		updatedBefore: toIso8601(options.updatedBefore),
	};

	const plan = buildAccountSearchPlan(
		searchText,
		[entity],
		includeLiveData,
		(options.searchLimit as number) ?? 10,
		options.strategy as string | undefined,
		filters,
	);

	const data = await client.execute(plan.query, itemIndex, plan.variables);
	return flattenSearchResults(data.search as IDataObject | undefined, [entity], includeLiveData);
}

function optionalEnum(
	context: IExecuteFunctions,
	value: unknown,
	options: INodePropertyOptions[],
	fieldName: string,
	itemIndex: number,
): string | undefined {
	if (typeof value !== 'string' || value === '') return undefined;
	return assertAllowedValue.call(context, value, options, fieldName, itemIndex);
}
