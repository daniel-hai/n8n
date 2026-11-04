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
	DEFAULT_WAIT_SECONDS,
	PROJECT_KIND_OPTIONS,
	requestConnectProject,
	requireBoardId,
	requireHttpsUrl,
	snapshotNewestBoardIds,
	waitForProjectBoards,
	waitTimeoutOption,
} from '../../helpers/portfolio';
import { assertAllowedValue, requireText } from '../../helpers/validation';
import { extractWorkspaceId, workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'projectName',
		type: 'string',
		default: '',
		required: true,
		description: 'The name of the project',
	},
	{
		displayName: 'Board Kind',
		name: 'projectKind',
		type: 'options',
		options: PROJECT_KIND_OPTIONS,
		default: 'public',
		description: 'Who can see the project. monday.com does not support shareable projects.',
	},
	{
		displayName: 'Connect to Portfolio',
		name: 'connectToPortfolio',
		type: 'boolean',
		default: false,
		description:
			'Whether to connect the new project to a portfolio. The node then always waits for the boards.',
	},
	{
		...boardResourceLocator,
		displayName: 'Portfolio Board',
		name: 'portfolioBoardId',
		description: 'The portfolio board to connect the project to',
		displayOptions: { show: { connectToPortfolio: [true] } },
	},
	{
		displayName: 'Wait for Boards',
		name: 'projectWait',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until monday.com creates the boards and return their IDs. monday.com creates a task board and an overview board with the same name.',
		displayOptions: { show: { connectToPortfolio: [false] } },
	},
	{
		displayName: 'Options',
		name: 'createProjectOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			callbackUrlOption,
			{
				displayName: 'Enable Resource Planner',
				name: 'resourcePlanner',
				type: 'boolean',
				default: false,
				description:
					'Whether to add the Resource Planner to the project. You cannot use it with Template ID.',
			},
			{
				displayName: 'Folder Name or ID',
				name: 'folderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getProjectWorkspaceFolders',
					loadOptionsDependsOn: ['createProjectOptions.workspaceId.value'],
				},
				default: '',
				description:
					'The folder of the project. Select a workspace first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Template ID',
				name: 'templateId',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1234567',
				description:
					'Create the project from this template. You cannot use it with Enable Resource Planner. Copy the ID from the Template Center URL.',
			},
			{
				...waitTimeoutOption('project boards'),
				hint: 'Applies only when the node waits for the boards',
			},
			{
				...workspaceResourceLocator,
				description:
					'The workspace of the project. Leave it empty for the Main workspace of the account.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['portfolio'],
		operation: ['createProject'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Portfolio & Project: Create Project. The task board is the one that a portfolio accepts. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const name = requireText.call(this, 'projectName', 'Name', itemIndex);
	const boardKind = assertAllowedValue.call(
		this,
		String(this.getNodeParameter('projectKind', itemIndex)),
		PROJECT_KIND_OPTIONS,
		'Board Kind',
		itemIndex,
	);
	const connect = this.getNodeParameter('connectToPortfolio', itemIndex, false) === true;
	const portfolioBoardId = connect
		? requireBoardId.call(this, 'portfolioBoardId', 'Portfolio Board', itemIndex)
		: undefined;
	const wait = connect || this.getNodeParameter('projectWait', itemIndex, true) === true;
	const options = this.getNodeParameter('createProjectOptions', itemIndex, {}) as IDataObject;
	const callbackUrl = requireHttpsUrl.call(this, options.callbackUrl, itemIndex);
	const workspaceId = extractWorkspaceId(options.workspaceId) || undefined;
	const templateId = typeof options.templateId === 'string' ? options.templateId.trim() : '';
	const folderId = typeof options.folderId === 'string' ? options.folderId.trim() : '';
	if (templateId && options.resourcePlanner === true) {
		throw new NodeOperationError(
			this.getNode(),
			'You cannot use Template ID and Enable Resource Planner together',
			{ itemIndex, description: 'Remove one of the two options.' },
		);
	}

	const excludeIds = wait
		? await snapshotNewestBoardIds(client, itemIndex, workspaceId)
		: undefined;

	const input: IDataObject = { name, board_kind: boardKind };
	if (workspaceId) input.workspace_id = workspaceId;
	if (folderId) input.folder_id = folderId;
	if (templateId) input.template_id = templateId;
	if (options.resourcePlanner === true) input.companions = ['resource_planner'];
	if (callbackUrl) input.callback_url = callbackUrl;

	const data = await client.execute(
		`mutation ($input: CreateProjectInput!) {
			create_project(input: $input) { success message error process_id }
		}`,
		itemIndex,
		{ input },
	);
	const result = (data.create_project ?? {}) as IDataObject;
	if (result.success !== true) {
		throw new NodeOperationError(this.getNode(), 'monday.com did not create the project', {
			itemIndex,
			description: `monday.com returned: ${String(result.error ?? result.message ?? 'no reason')}`,
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
	const { projectBoard, overviewBoard } = await waitForProjectBoards(client, itemIndex, {
		name,
		workspaceId,
		excludeIds,
		timeoutSeconds,
	});
	if (!projectBoard) {
		throw new NodeOperationError(
			this.getNode(),
			`The project board "${name}" did not appear within ${timeoutSeconds} seconds`,
			{
				itemIndex,
				description:
					'monday.com accepted the request and continues to create the boards. Find the board by name, or increase Wait Timeout.',
			},
		);
	}
	output.projectBoardId = projectBoard.id;
	output.projectBoardUrl = projectBoard.url ?? null;
	output.overviewBoardId = overviewBoard?.id ?? null;
	output.overviewBoardUrl = overviewBoard?.url ?? null;
	if (!portfolioBoardId) return output;

	const connection = await requestConnectProject(
		client,
		itemIndex,
		projectBoard.id,
		portfolioBoardId,
	);
	if (connection.success !== true) {
		throw new NodeOperationError(
			this.getNode(),
			`monday.com created project board ${projectBoard.id}, but could not connect it to portfolio board ${portfolioBoardId}`,
			{
				itemIndex,
				description: `monday.com returned: ${String(connection.message ?? 'no reason').trim()} ${CONNECT_FAILURE_HINT}`,
			},
		);
	}
	return {
		...output,
		portfolioBoardId,
		portfolioItemId: connection.portfolio_item_id ?? null,
	};
}
