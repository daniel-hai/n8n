import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { DOC_FIELDS, formatDocRow } from '../../helpers/docs';
import { normalizeIdList } from '../../helpers/filterOptions';
import { fetchAllPaged } from '../../helpers/pagination';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

/** The docs query accepts 100 docs per page. */
const DOCS_PAGE_SIZE = 100;

const DOCS_ORDER_BY = ['created_at', 'used_at'];

const properties: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'getDocsOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Doc IDs',
				name: 'docIds',
				type: 'string',
				default: '',
				description:
					'Only return these docs (comma-separated). You can use internal doc IDs and the numbers in doc URLs.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'Higher limits consume more of your account’s API complexity budget per run. See the Get Rate Limits operation.',
			},
			{
				displayName: 'Order By',
				name: 'orderBy',
				type: 'options',
				options: [
					{ name: 'Created At (Newest First)', value: 'created_at' },
					{ name: 'Last Used (Most Recent First)', value: 'used_at' },
				],
				default: 'created_at',
				description: 'How to order the docs. monday.com ignores it when you set Doc IDs.',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Workspaces',
				name: 'workspaceIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getWorkspaces' },
				default: [],
				description:
					'Only return docs of these workspaces. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['getDocs'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Doc: Get Many. With Doc IDs, each ID is looked up as an internal ID and
 * as an object ID in one request, and a missing ID fails the item.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const options = this.getNodeParameter('getDocsOptions', itemIndex, {}) as IDataObject;
	const limit = (options.limit as number | undefined) ?? DEFAULT_LIMIT;

	const docIds = normalizeIdList(options.docIds);
	if (docIds.length > 0) {
		const data = await client.execute(
			`query ($ids: [ID!], $limit: Int!) {
				byId: docs(ids: $ids, limit: $limit) { ${DOC_FIELDS} }
				byObjectId: docs(object_ids: $ids, limit: $limit) { ${DOC_FIELDS} }
			}`,
			itemIndex,
			{ ids: docIds, limit: docIds.length },
		);
		const docs = new Map<string, IDataObject>();
		for (const doc of [
			...((data.byId ?? []) as IDataObject[]),
			...((data.byObjectId ?? []) as IDataObject[]),
		]) {
			docs.set(String(doc.id), doc);
		}
		const found = new Set([...docs.values()].flatMap((doc) => [doc.id, doc.object_id].map(String)));
		const missing = docIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`${missing.length === 1 ? 'Doc' : 'Docs'} ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found`,
				{ itemIndex, description: 'Check the IDs, and that your API token can access the docs.' },
			);
		}
		return [...docs.values()].slice(0, limit).map(formatDocRow);
	}

	const varDefs = ['$limit: Int!', '$page: Int!'];
	const args = ['limit: $limit', 'page: $page'];
	const variables: Record<string, unknown> = {};

	const workspaceIds = normalizeIdList(options.workspaceIds);
	if (workspaceIds.length > 0) {
		varDefs.push('$workspaceIds: [ID]');
		args.push('workspace_ids: $workspaceIds');
		variables.workspaceIds = workspaceIds;
	}
	if (options.orderBy !== undefined) {
		const orderBy = String(options.orderBy);
		if (!DOCS_ORDER_BY.includes(orderBy)) {
			throw new NodeOperationError(this.getNode(), `Order By "${orderBy}" is not supported`, {
				itemIndex,
				description: `Use one of: ${DOCS_ORDER_BY.join(', ')}.`,
			});
		}
		varDefs.push('$orderBy: DocsOrderBy');
		args.push('order_by: $orderBy');
		variables.orderBy = orderBy;
	}

	const rows = await fetchAllPaged({
		client,
		itemIndex,
		query: `query (${varDefs.join(', ')}) { docs(${args.join(', ')}) { ${DOC_FIELDS} } }`,
		variables,
		extractRows: (data) => (data.docs ?? []) as IDataObject[],
		limit,
		pageSize: DOCS_PAGE_SIZE,
	});
	return rows.map(formatDocRow);
}
