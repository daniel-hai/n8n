import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	ASSET_FIELDS,
	type AssetRow,
	fetchItemAssets,
	fetchItemUpdateAssets,
	scanBoardColumnAssets,
} from '../../helpers/assets';
import { boardResourceLocator } from '../../helpers/boardLocator';
import { normalizeIdList } from '../../helpers/filterOptions';
import { itemResourceLocator } from '../../helpers/itemLocator';
import { DEFAULT_LIMIT } from '../../transport/constants';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { fileColumnProperty } from '../common.description';

const ITEM_SCOPES = ['all', 'columns', 'updates'];

const properties: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'assetsSource',
		type: 'options',
		options: [
			{
				name: 'By Asset IDs',
				value: 'assetIds',
				description: 'Return files by their asset IDs',
			},
			{
				name: 'By Board Item',
				value: 'boardItem',
				description: 'Return the files of one item: file columns, updates, or both',
			},
			{
				name: 'By File Column',
				value: 'boardColumn',
				description: 'Return the files of one file column, on one item or on the whole board',
			},
		],
		default: 'assetIds',
		description: 'Where to take the files from',
	},
	{
		displayName: 'Asset IDs',
		name: 'assetIds',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 291472294, 291472300',
		description:
			'Comma-separated IDs of the files to return. File column values and update assets contain them.',
		displayOptions: { show: { assetsSource: ['assetIds'] } },
	},
	{
		...boardResourceLocator,
		displayOptions: { show: { assetsSource: ['boardItem', 'boardColumn'] } },
	},
	{
		...itemResourceLocator,
		displayOptions: { show: { assetsSource: ['boardItem'] } },
	},
	{
		displayName: 'Return Files From',
		name: 'itemAssetsScope',
		type: 'options',
		options: [
			{
				name: 'All',
				value: 'all',
				description: 'The files in file columns and in updates',
			},
			{
				name: 'File Columns',
				value: 'columns',
				description: 'Only the files in file columns',
			},
			{
				name: 'Updates',
				value: 'updates',
				description: 'Only the files attached to updates',
			},
		],
		default: 'all',
		description: 'Which files of the item to return',
		displayOptions: { show: { assetsSource: ['boardItem'] } },
	},
	{
		displayName: 'File Column Names or IDs',
		name: 'itemFileColumnIds',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsMethod: 'getBoardFileColumns',
			loadOptionsDependsOn: ['boardId.value'],
		},
		default: [],
		description:
			'Only return files from these file columns. Leave it empty for all file columns. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { assetsSource: ['boardItem'], itemAssetsScope: ['columns'] } },
	},
	{
		...fileColumnProperty,
		description:
			'The file column to return files from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { assetsSource: ['boardColumn'] } },
	},
	{
		...itemResourceLocator,
		required: false,
		description:
			'Only return files from this item. Leave it empty to read the column on every item of the board.',
		displayOptions: { show: { assetsSource: ['boardColumn'] } },
	},
	{
		displayName: 'Options',
		name: 'getAssetsOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { assetsSource: ['boardItem', 'boardColumn'] } },
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				hint: 'To read a column on the whole board, the node reads pages of items until it finds this many files. A large board with few files can need many requests.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['file'],
		operation: ['getAssets'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * File: Get Many — file metadata by asset IDs, from one item (file
 * columns, updates or both), or from one file column.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	const source = this.getNodeParameter('assetsSource', itemIndex, 'assetIds') as string;

	if (source === 'assetIds') {
		const assetIds = normalizeIdList(this.getNodeParameter('assetIds', itemIndex));
		if (assetIds.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Enter at least one asset ID', { itemIndex });
		}
		const data = await client.execute(
			`query ($ids: [ID!]!) { assets(ids: $ids) { ${ASSET_FIELDS} } }`,
			itemIndex,
			{ ids: assetIds },
		);
		const assets = (data.assets ?? []) as AssetRow[];
		const found = new Set(assets.map((asset) => String(asset.id)));
		const missing = assetIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`${missing.length === 1 ? 'File' : 'Files'} ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found`,
				{ itemIndex, description: 'Check the asset IDs, and that your API token can access them.' },
			);
		}
		return assets;
	}

	const options = this.getNodeParameter('getAssetsOptions', itemIndex, {}) as IDataObject;
	const limit = (options.limit as number) ?? DEFAULT_LIMIT;

	if (source === 'boardItem') {
		const itemId = String(
			this.getNodeParameter('itemId', itemIndex, undefined, { extractValue: true }),
		).trim();
		const scope = this.getNodeParameter('itemAssetsScope', itemIndex, 'all') as string;
		if (!ITEM_SCOPES.includes(scope)) {
			throw new NodeOperationError(
				this.getNode(),
				`Return Files From "${scope}" is not supported`,
				{
					itemIndex,
					description: 'Choose a value from the list.',
				},
			);
		}
		if (scope === 'updates') {
			const assets = await fetchItemUpdateAssets.call(this, client, itemIndex, itemId, limit);
			return assets.map((asset) => ({ ...asset, itemId, source: 'updates' }));
		}
		const columnIds =
			scope === 'columns'
				? normalizeIdList(this.getNodeParameter('itemFileColumnIds', itemIndex, []))
				: [];
		const assets = await fetchItemAssets.call(
			this,
			client,
			itemIndex,
			itemId,
			scope === 'columns' ? 'columns' : 'all',
			columnIds,
		);
		return assets.slice(0, limit).map((asset) => ({ ...asset, itemId, source: scope }));
	}

	if (source !== 'boardColumn') {
		throw new NodeOperationError(this.getNode(), `Source "${source}" is not supported`, {
			itemIndex,
			description: 'Choose a value from the list.',
		});
	}
	const columnId = String(this.getNodeParameter('fileColumnId', itemIndex)).trim();
	const itemId = String(
		this.getNodeParameter('itemId', itemIndex, '', { extractValue: true }) ?? '',
	).trim();
	if (itemId) {
		const assets = await fetchItemAssets.call(this, client, itemIndex, itemId, 'columns', [
			columnId,
		]);
		return assets.slice(0, limit).map((asset) => ({ ...asset, itemId, columnId }));
	}
	const boardId = String(
		this.getNodeParameter('boardId', itemIndex, undefined, { extractValue: true }),
	).trim();
	return await scanBoardColumnAssets.call(this, client, itemIndex, boardId, columnId, limit);
}
