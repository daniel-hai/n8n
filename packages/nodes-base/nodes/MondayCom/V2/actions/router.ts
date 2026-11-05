import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
} from 'n8n-workflow';

import * as agent from './agent';
import * as board from './board';
import * as column from './column';
import * as file from './file';
import * as folder from './folder';
import * as group from './group';
import * as item from './item';
import type { MondayComPerItemType } from './node.type';
import * as team from './team';
import * as update from './update';
import * as user from './user';
import * as workspace from './workspace';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

type OperationExecute = (
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
) => Promise<IDataObject | IDataObject[]>;

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	// API version is pinned node-wide (constants.ts), not per credential.
	const client = new MondayGraphQLClient(this);

	const resource = this.getNodeParameter('resource', 0);
	const operation = this.getNodeParameter('operation', 0);

	// Bulk Import consumes ALL input items into ONE import job (in mapped
	// mode each input item is one CSV row) — run once per execution.
	if (resource === 'item' && operation === 'bulkImport') {
		try {
			const rows = await item.bulkImport.execute.call(this, client, items.length);
			returnData.push(...rows);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: 0 },
				});
			} else {
				// Errors from MondayGraphQLClient are already mapped NodeApiErrors.
				throw error;
			}
		}
		return [returnData];
	}

	const monday = { resource, operation } as MondayComPerItemType;
	const isDownload = resource === 'file' && operation === 'downloadFile';

	for (let i = 0; i < items.length; i++) {
		try {
			if (isDownload) {
				const rows = await file.downloadFile.execute.call(this, client, i);
				returnData.push(...rows.map((row) => ({ ...row, pairedItem: { item: i } })));
				continue;
			}
			let execute: OperationExecute | undefined;
			switch (monday.resource) {
				case 'agent':
					execute = agent[monday.operation]?.execute;
					break;
				case 'board':
					execute = board[monday.operation]?.execute;
					break;
				case 'column':
					execute = column[monday.operation]?.execute;
					break;
				case 'file':
					execute = file[monday.operation]?.execute;
					break;
				case 'folder':
					execute = folder[monday.operation]?.execute;
					break;
				case 'group':
					execute = group[monday.operation]?.execute;
					break;
				case 'item':
					execute = item[monday.operation]?.execute;
					break;
				case 'team':
					execute = team[monday.operation]?.execute;
					break;
				case 'update':
					execute = update[monday.operation]?.execute;
					break;
				case 'user':
					execute = user[monday.operation]?.execute;
					break;
				case 'workspace':
					execute = workspace[monday.operation]?.execute;
					break;
			}
			if (!execute) {
				throw new NodeOperationError(
					this.getNode(),
					`The operation "${String(operation)}" is not supported`,
					{ itemIndex: i },
				);
			}
			const result = await execute.call(this, client, i);
			for (const json of Array.isArray(result) ? result : [result]) {
				returnData.push({ json, pairedItem: { item: i } });
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
				continue;
			}
			// Errors from MondayGraphQLClient are already mapped NodeApiErrors.
			throw error;
		}
	}

	return [returnData];
}
