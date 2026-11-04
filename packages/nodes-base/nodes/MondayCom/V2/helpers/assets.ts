import {
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import { boardNotFoundError } from './boardLocator';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * monday files are assets. API facts (API 2026-10) that shape this module:
 * - public_url is a pre-signed storage URL that expires after about one
 *   hour. url needs a signed-in monday session, so the node never reads it.
 * - items(ids:) and assets(ids:) answer an unknown ID with an empty list.
 * - The /v2/file endpoint accepts `variables[name]` fields next to the file.
 */

/** The asset fields that every file read returns. */
export const ASSET_FIELDS =
	'id name url public_url file_extension file_size created_at uploaded_by { id name }';

/** The "All Files in Column" choice of the Download file picker. */
export const ALL_COLUMN_FILES = '__all__';

export type AssetRow = IDataObject & { id: string; name?: string; public_url?: string };

const UPDATES_PAGE_SIZE = 100;
const ITEMS_PAGE_SIZE = 100;

export function itemNotFoundError(this: IExecuteFunctions, itemId: string, itemIndex: number) {
	return new NodeOperationError(
		this.getNode(),
		`Item ${itemId} was not found. It may never have existed, or your API token may not have access to its board.`,
		{ itemIndex },
	);
}

/**
 * The assets of one item. Source "columns" reads file columns, optionally
 * only some of them. Source "all" also reads update attachments.
 */
export async function fetchItemAssets(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	itemId: string,
	source: 'all' | 'columns',
	columnIds: string[] = [],
): Promise<AssetRow[]> {
	const scoped = source === 'columns' && columnIds.length > 0;
	const data = await client.execute(
		`query ($ids: [ID!]${scoped ? ', $columnIds: [String]' : ''}) {
			items(ids: $ids) {
				assets(assets_source: ${source}${scoped ? ', column_ids: $columnIds' : ''}) { ${ASSET_FIELDS} }
			}
		}`,
		itemIndex,
		scoped ? { ids: [itemId], columnIds } : { ids: [itemId] },
	);
	const items = (data.items ?? []) as Array<{ assets?: AssetRow[] }>;
	if (items.length === 0) throw itemNotFoundError.call(this, itemId, itemIndex);
	return items[0].assets ?? [];
}

/** The update attachments of one item. Reads pages of updates until the limit is reached. */
export async function fetchItemUpdateAssets(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	itemId: string,
	limit: number,
): Promise<AssetRow[]> {
	const assets: AssetRow[] = [];
	const seen = new Set<string>();

	for (let page = 1; ; page++) {
		const data = await client.execute(
			`query ($ids: [ID!], $limit: Int!, $page: Int!) {
				items(ids: $ids) { updates(limit: $limit, page: $page) { id assets { ${ASSET_FIELDS} } } }
			}`,
			itemIndex,
			{ ids: [itemId], limit: UPDATES_PAGE_SIZE, page },
		);
		const items = (data.items ?? []) as Array<{
			updates?: Array<{ id: string; assets?: AssetRow[] }>;
		}>;
		if (items.length === 0) throw itemNotFoundError.call(this, itemId, itemIndex);
		const updates = items[0].updates ?? [];

		for (const update of updates) {
			for (const asset of update.assets ?? []) {
				// One asset can be on more than one update. The first update wins.
				if (seen.has(String(asset.id))) continue;
				seen.add(String(asset.id));
				assets.push({ ...asset, updateId: update.id });
				if (assets.length >= limit) return assets;
			}
		}
		if (updates.length < UPDATES_PAGE_SIZE) return assets;
	}
}

interface AssetItemsPage {
	cursor: string | null;
	items?: Array<{ id: string; name: string; assets?: AssetRow[] }>;
}

/**
 * The files of one column on every item of a board. Reads pages of items
 * until the limit is reached, so a large board with few files can need
 * many requests.
 */
export async function scanBoardColumnAssets(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	boardId: string,
	columnId: string,
	limit: number,
): Promise<IDataObject[]> {
	const itemFields = `id name assets(assets_source: columns, column_ids: $columnIds) { ${ASSET_FIELDS} }`;
	const assets: IDataObject[] = [];
	const collect = (page: AssetItemsPage | undefined): boolean => {
		for (const item of page?.items ?? []) {
			for (const asset of item.assets ?? []) {
				assets.push({ ...asset, itemId: item.id, itemName: item.name, columnId });
				if (assets.length >= limit) return true;
			}
		}
		return false;
	};

	const firstData = await client.execute(
		`query ($ids: [ID!], $limit: Int!, $columnIds: [String]) {
			boards(ids: $ids) { items_page(limit: $limit) { cursor items { ${itemFields} } } }
		}`,
		itemIndex,
		{ ids: [boardId], limit: ITEMS_PAGE_SIZE, columnIds: [columnId] },
	);
	const boards = (firstData.boards ?? []) as Array<{ items_page?: AssetItemsPage }>;
	if (boards.length === 0) throw boardNotFoundError(this.getNode(), boardId, itemIndex);
	if (collect(boards[0].items_page)) return assets;

	let cursor = boards[0].items_page?.cursor ?? null;
	while (cursor) {
		const data = await client.execute(
			`query ($cursor: String!, $limit: Int!, $columnIds: [String]) {
				next_items_page(cursor: $cursor, limit: $limit) { cursor items { ${itemFields} } }
			}`,
			itemIndex,
			{ cursor, limit: ITEMS_PAGE_SIZE, columnIds: [columnId] },
		);
		const page = data.next_items_page as AssetItemsPage | undefined;
		if (collect(page)) return assets;
		cursor = page?.cursor ?? null;
	}
	return assets;
}

/** File picker for File: Download. It lists the files in one file column of one item. */
export async function getItemColumnFiles(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const allFiles = { name: 'All Files in Column', value: ALL_COLUMN_FILES };
	const itemId = this.getCurrentNodeParameter('itemId', { extractValue: true }) as string;
	const columnId = this.getCurrentNodeParameter('fileColumnId') as string;
	if (!itemId || !columnId) return [allFiles];

	const client = new MondayGraphQLClient(this);
	const data = await client.execute(
		`query ($ids: [ID!], $columnIds: [String]) {
			items(ids: $ids) { assets(assets_source: columns, column_ids: $columnIds) { id name } }
		}`,
		0,
		{ ids: [itemId], columnIds: [columnId] },
	);
	const items = (data.items ?? []) as Array<{ assets?: Array<{ id: string; name: string }> }>;
	return [
		allFiles,
		...(items[0]?.assets ?? []).map((asset) => ({ name: asset.name, value: String(asset.id) })),
	];
}
