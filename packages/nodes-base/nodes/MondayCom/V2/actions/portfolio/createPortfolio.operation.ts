import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { assertAllowedValue, requireText } from '../../helpers/validation';
import {
	callbackUrlOption,
	DEFAULT_WAIT_SECONDS,
	PORTFOLIO_PRIVACY_OPTIONS,
	requireHttpsUrl,
	snapshotNewestBoardIds,
	waitForPortfolioBoard,
	waitTimeoutOption,
} from '../../helpers/portfolio';
import { extractWorkspaceId, workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'portfolioName',
		type: 'string',
		default: '',
		required: true,
		description: 'The name of the portfolio board',
	},
	{
		displayName: 'Privacy',
		name: 'portfolioPrivacy',
		type: 'options',
		options: PORTFOLIO_PRIVACY_OPTIONS,
		default: 'private',
		description: 'Who can see the portfolio board. monday.com does not support public portfolios.',
	},
	{
		displayName: 'Wait for Board',
		name: 'portfolioWait',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until monday.com creates the board and return its ID. monday.com creates the board some seconds after it accepts the request.',
	},
	{
		displayName: 'Options',
		name: 'createPortfolioOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			callbackUrlOption,
			{
				...waitTimeoutOption('portfolio board'),
				displayOptions: { show: { '/portfolioWait': [true] } },
			},
			{
				...workspaceResourceLocator,
				description:
					'The workspace of the portfolio board. Leave it empty for the Main workspace of the account.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['portfolio'],
		operation: ['createPortfolio'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Portfolio & Project: Create Portfolio. It needs an Enterprise plan. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const name = requireText.call(this, 'portfolioName', 'Name', itemIndex);
	const privacy = assertAllowedValue.call(
		this,
		String(this.getNodeParameter('portfolioPrivacy', itemIndex)),
		PORTFOLIO_PRIVACY_OPTIONS,
		'Privacy',
		itemIndex,
	);
	const wait = this.getNodeParameter('portfolioWait', itemIndex, true) === true;
	const options = this.getNodeParameter('createPortfolioOptions', itemIndex, {}) as IDataObject;
	const callbackUrl = requireHttpsUrl.call(this, options.callbackUrl, itemIndex);
	const workspaceId = extractWorkspaceId(options.workspaceId) || undefined;
	if (workspaceId && !/^\d+$/.test(workspaceId)) {
		throw new NodeOperationError(this.getNode(), `Workspace "${workspaceId}" is not a number`, {
			itemIndex,
		});
	}

	const excludeIds = wait
		? await snapshotNewestBoardIds(client, itemIndex, workspaceId)
		: undefined;

	const data = await client.execute(
		`mutation ($name: String!, $privacy: String!, $workspaceId: Int, $callbackUrl: String) {
			create_portfolio(boardName: $name, boardPrivacy: $privacy, destinationWorkspaceId: $workspaceId, callback_url: $callbackUrl) {
				success
				message
				process_id
			}
		}`,
		itemIndex,
		{
			name,
			privacy,
			workspaceId: workspaceId ? Number(workspaceId) : null,
			callbackUrl: callbackUrl ?? null,
		},
	);
	const result = (data.create_portfolio ?? {}) as IDataObject;
	if (result.success !== true) {
		throw new NodeOperationError(this.getNode(), 'monday.com did not create the portfolio', {
			itemIndex,
			description: `monday.com returned: ${String(result.message ?? 'no reason')}. Portfolios need an Enterprise plan.`,
		});
	}

	const output: IDataObject = {
		success: true,
		message: result.message ?? null,
		processId: result.process_id ?? null,
	};
	if (!excludeIds) return output;

	const timeoutSeconds =
		typeof options.waitTimeout === 'number' ? options.waitTimeout : DEFAULT_WAIT_SECONDS;
	const board = await waitForPortfolioBoard(client, itemIndex, {
		name,
		workspaceId,
		excludeIds,
		timeoutSeconds,
	});
	if (!board) {
		throw new NodeOperationError(
			this.getNode(),
			`The portfolio board "${name}" did not appear within ${timeoutSeconds} seconds`,
			{
				itemIndex,
				description:
					'monday.com accepted the request and continues to create the board. Find the board by name, or increase Wait Timeout.',
			},
		);
	}
	return {
		...output,
		portfolioBoardId: board.id,
		portfolioBoardName: board.name,
		portfolioBoardUrl: board.url ?? null,
	};
}
