import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { boardResourceLocator } from '../../helpers/boardLocator';
import {
	callbackUrlOption,
	CONNECT_FAILURE_HINT,
	requestConnectProject,
	requireBoardId,
	requireHttpsUrl,
} from '../../helpers/portfolio';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		...boardResourceLocator,
		displayName: 'Project Board',
		name: 'projectBoardId',
		description:
			'The task board of the project. Do not use the overview board that monday.com creates with the project.',
	},
	{
		...boardResourceLocator,
		displayName: 'Portfolio Board',
		name: 'portfolioBoardId',
		description: 'The portfolio board to connect the project to',
	},
	{
		displayName: 'Options',
		name: 'connectPortfolioOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [callbackUrlOption],
	},
];

const displayOptions = {
	show: {
		resource: ['portfolio'],
		operation: ['connectProjectToPortfolio'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Portfolio & Project: Connect Project. Without a callback URL, the result comes back at once. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const projectBoardId = requireBoardId.call(this, 'projectBoardId', 'Project Board', itemIndex);
	const portfolioBoardId = requireBoardId.call(
		this,
		'portfolioBoardId',
		'Portfolio Board',
		itemIndex,
	);
	const options = this.getNodeParameter('connectPortfolioOptions', itemIndex, {}) as IDataObject;
	const callbackUrl = requireHttpsUrl.call(this, options.callbackUrl, itemIndex);

	const result = await requestConnectProject(
		client,
		itemIndex,
		projectBoardId,
		portfolioBoardId,
		callbackUrl,
	);
	if (result.success !== true) {
		throw new NodeOperationError(
			this.getNode(),
			`monday.com could not connect project board ${projectBoardId} to portfolio board ${portfolioBoardId}`,
			{
				itemIndex,
				description: `monday.com returned: ${String(result.message ?? 'no reason').trim()} ${CONNECT_FAILURE_HINT}`,
			},
		);
	}
	return {
		success: true,
		message: result.message ?? null,
		portfolioItemId: result.portfolio_item_id ?? null,
		processId: result.process_id ?? null,
		projectBoardId,
		portfolioBoardId,
	};
}
