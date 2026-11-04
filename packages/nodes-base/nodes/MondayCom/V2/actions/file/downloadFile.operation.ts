import type { Readable } from 'stream';

import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	ALL_COLUMN_FILES,
	ASSET_FIELDS,
	type AssetRow,
	fetchItemAssets,
} from '../../helpers/assets';
import { boardResourceLocator } from '../../helpers/boardLocator';
import {
	assertPresignedStorageUrl,
	PRESIGNED_URL_REQUEST_OPTIONS,
} from '../../helpers/fileTransfer';
import { itemResourceLocator } from '../../helpers/itemLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { fileColumnProperty } from '../common.description';

const fromColumn = { downloadSource: ['fileColumn'] };

const properties: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'downloadSource',
		type: 'options',
		options: [
			{
				name: 'By Asset ID',
				value: 'assetId',
				description: 'Download a file by its asset ID',
			},
			{
				name: 'By File Column',
				value: 'fileColumn',
				description: 'Pick the file from the file column of an item',
			},
		],
		default: 'assetId',
		description: 'How to choose the file to download',
	},
	{
		displayName: 'Asset ID',
		name: 'assetId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 291472294',
		description:
			'The ID of the file to download. File column values, update assets and Add to File Column return it.',
		displayOptions: { show: { downloadSource: ['assetId'] } },
	},
	{ ...boardResourceLocator, displayOptions: { show: fromColumn } },
	{
		...itemResourceLocator,
		description: 'The item to download the file from',
		displayOptions: { show: fromColumn },
	},
	{
		...fileColumnProperty,
		description:
			'The file column to download from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: fromColumn },
	},
	{
		displayName: 'File Name or ID',
		name: 'columnFileId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getItemColumnFiles',
			loadOptionsDependsOn: ['itemId.value', 'fileColumnId'],
		},
		default: ALL_COLUMN_FILES,
		required: true,
		description:
			'The file to download. All Files in Column gives one output item for each file. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: fromColumn },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'downloadBinaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the output binary field to put the file in',
	},
];

const displayOptions = {
	show: {
		resource: ['file'],
		operation: ['downloadFile'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

async function resolveAssets(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<AssetRow[]> {
	const source = this.getNodeParameter('downloadSource', itemIndex, 'assetId') as string;
	if (source === 'assetId') {
		const assetId = String(this.getNodeParameter('assetId', itemIndex)).trim();
		const data = await client.execute(
			`query ($ids: [ID!]!) { assets(ids: $ids) { ${ASSET_FIELDS} } }`,
			itemIndex,
			{ ids: [assetId] },
		);
		const assets = (data.assets ?? []) as AssetRow[];
		if (assets.length === 0) {
			throw new NodeOperationError(this.getNode(), `File ${assetId} was not found`, {
				itemIndex,
				description: 'Check the asset ID, and that your API token can access its board.',
			});
		}
		return assets;
	}
	if (source !== 'fileColumn') {
		throw new NodeOperationError(this.getNode(), `Source "${source}" is not supported`, {
			itemIndex,
			description: 'Choose a value from the list.',
		});
	}

	const itemId = String(
		this.getNodeParameter('itemId', itemIndex, undefined, { extractValue: true }),
	).trim();
	const columnId = String(this.getNodeParameter('fileColumnId', itemIndex)).trim();
	const fileId = String(this.getNodeParameter('columnFileId', itemIndex, ALL_COLUMN_FILES));
	const columnAssets = await fetchItemAssets.call(this, client, itemIndex, itemId, 'columns', [
		columnId,
	]);
	const assets =
		fileId === ALL_COLUMN_FILES
			? columnAssets
			: columnAssets.filter((asset) => String(asset.id) === fileId);
	if (assets.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			fileId === ALL_COLUMN_FILES
				? `Column ${columnId} of item ${itemId} has no files`
				: `File ${fileId} is not in column ${columnId} of item ${itemId}`,
			{ itemIndex },
		);
	}
	return assets;
}

/**
 * File: Download — reads the short-lived public_url of each file and
 * streams the file into a binary field. The router adds pairedItem.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const binaryPropertyName = this.getNodeParameter(
		'downloadBinaryPropertyName',
		itemIndex,
	) as string;
	const assets = await resolveAssets.call(this, client, itemIndex);

	const results: INodeExecutionData[] = [];
	for (const asset of assets) {
		const { public_url: publicUrl, ...json } = asset;
		if (!publicUrl) {
			throw new NodeOperationError(this.getNode(), `File ${asset.id} has no download URL`, {
				itemIndex,
			});
		}
		assertPresignedStorageUrl(this.getNode(), publicUrl, 'file download', itemIndex);
		const stream = (await this.helpers.httpRequest({
			url: publicUrl,
			encoding: 'stream',
			...PRESIGNED_URL_REQUEST_OPTIONS,
		})) as Readable;
		const binary = await this.helpers.prepareBinaryData(stream, asset.name ?? `file-${asset.id}`);
		// The URL expires within the hour, so it has no use downstream.
		results.push({ json, binary: { [binaryPropertyName]: binary } });
	}
	return results;
}
