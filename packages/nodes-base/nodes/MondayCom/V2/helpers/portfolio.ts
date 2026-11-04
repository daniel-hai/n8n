import { sleep } from '@n8n/utils/sleep';
import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import { isRealBoard } from './boardLocator';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * Portfolio & Project. create_portfolio and create_project run
 * asynchronously and do not return the board ID. The node finds the new
 * board by name among the newest boards. Boards from before the request are
 * excluded by ID, so a board with the same name cannot match.
 */

export const BOARD_POLL_INTERVAL_MS = 5000;

export const DEFAULT_WAIT_SECONDS = 60;

/** The overview board of a project comes about 8 seconds after the task board. */
const OVERVIEW_BOARD_GRACE_POLLS = 3;

const BOARD_POLL_WINDOW = 50;

const BOARD_POLL_FIELDS = 'id name url type hierarchy_type item_terminology';

export const PORTFOLIO_PRIVACY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Private', value: 'private', description: 'Only invited members can see it' },
	{ name: 'Shareable', value: 'share', description: 'Invited members and guests can see it' },
];

export const PROJECT_KIND_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Private', value: 'private', description: 'Only invited members can see it' },
	{ name: 'Public', value: 'public', description: 'Everyone in the account can see it' },
];

export const CONNECT_FAILURE_HINT =
	'Make sure that the project board is the task board of a project, not its overview board. Also make sure that the portfolio board is a portfolio and that the account has an Enterprise plan.';

export const callbackUrlOption: INodeProperties = {
	displayName: 'Callback URL',
	name: 'callbackUrl',
	type: 'string',
	default: '',
	placeholder: 'e.g. https://example.com/webhook',
	description:
		'An HTTPS URL. monday.com sends the result to it when the request is complete. For example, use the URL of an n8n Webhook trigger.',
};

export function waitTimeoutOption(boardLabel: string): INodeProperties {
	return {
		displayName: 'Wait Timeout (Seconds)',
		name: 'waitTimeout',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: 600 },
		default: DEFAULT_WAIT_SECONDS,
		description: `How long to wait for the ${boardLabel}. The node checks every 5 seconds. After the timeout, the node fails, but monday.com continues to create the board.`,
	};
}

export interface CreatedBoard {
	id: string;
	name: string;
	url?: string;
	type?: string;
	hierarchy_type?: string | null;
	item_terminology?: string | null;
}

export interface ProjectBoards {
	/** The multi-level task board. connect_project_to_portfolio accepts only this board. */
	projectBoard?: CreatedBoard;
	/** The classic overview board with the same name. */
	overviewBoard?: CreatedBoard;
}

export function requireHttpsUrl(
	this: IExecuteFunctions,
	value: unknown,
	itemIndex: number,
): string | undefined {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) return undefined;
	let protocol = '';
	try {
		protocol = new URL(raw).protocol;
	} catch {
		protocol = '';
	}
	if (protocol === 'https:') return raw;
	throw new NodeOperationError(this.getNode(), 'Callback URL is not an HTTPS URL', {
		itemIndex,
		description: `Received "${raw}".`,
	});
}

async function fetchNewestBoards(
	client: MondayGraphQLClient,
	itemIndex: number,
	workspaceId?: string,
): Promise<CreatedBoard[]> {
	const data = await client.execute(
		`query ($limit: Int!, $workspaceIds: [ID]) {
			boards(limit: $limit, order_by: created_at, state: active, workspace_ids: $workspaceIds) { ${BOARD_POLL_FIELDS} }
		}`,
		itemIndex,
		{ limit: BOARD_POLL_WINDOW, workspaceIds: workspaceId ? [workspaceId] : null },
	);
	const boards = Array.isArray(data.boards) ? (data.boards as CreatedBoard[]) : [];
	return boards.filter(isRealBoard);
}

/** Run before the create mutation. These IDs can never be the new board. */
export async function snapshotNewestBoardIds(
	client: MondayGraphQLClient,
	itemIndex: number,
	workspaceId?: string,
): Promise<Set<string>> {
	const boards = await fetchNewestBoards(client, itemIndex, workspaceId);
	return new Set(boards.map((board) => board.id));
}

interface WaitOptions {
	name: string;
	workspaceId?: string;
	excludeIds: Set<string>;
	timeoutSeconds: number;
}

/** Polls until `isDone` is true or the timeout ends. Returns the last matches. */
async function pollNewBoards(
	client: MondayGraphQLClient,
	itemIndex: number,
	options: WaitOptions,
	isDone: (matches: CreatedBoard[]) => boolean,
): Promise<CreatedBoard[]> {
	const attempts = Math.max(1, Math.ceil((options.timeoutSeconds * 1000) / BOARD_POLL_INTERVAL_MS));
	let matches: CreatedBoard[] = [];
	for (let attempt = 1; attempt <= attempts; attempt++) {
		await sleep(BOARD_POLL_INTERVAL_MS);
		const boards = await fetchNewestBoards(client, itemIndex, options.workspaceId);
		matches = boards.filter(
			(board) => board.name === options.name && !options.excludeIds.has(board.id),
		);
		if (isDone(matches)) break;
	}
	return matches;
}

export async function waitForPortfolioBoard(
	client: MondayGraphQLClient,
	itemIndex: number,
	options: WaitOptions,
): Promise<CreatedBoard | undefined> {
	const matches = await pollNewBoards(client, itemIndex, options, (found) => found.length > 0);
	return matches[0];
}

/** The task board is multi-level. A template can change the boards, so other matches are fallbacks. */
export function splitProjectBoards(boards: CreatedBoard[]): ProjectBoards {
	const projectBoard =
		boards.find((board) => board.hierarchy_type === 'multi_level') ??
		boards.find((board) => board.item_terminology === 'task') ??
		boards[0];
	if (!projectBoard) return {};
	return {
		projectBoard,
		overviewBoard: boards.find(
			(board) => board.id !== projectBoard.id && board.hierarchy_type !== 'multi_level',
		),
	};
}

/** Returns when both boards exist, or a few polls after the task board if the overview board stays missing. */
export async function waitForProjectBoards(
	client: MondayGraphQLClient,
	itemIndex: number,
	options: WaitOptions,
): Promise<ProjectBoards> {
	let pollsSinceTaskBoard = 0;
	const matches = await pollNewBoards(client, itemIndex, options, (found) => {
		const boards = splitProjectBoards(found);
		if (boards.projectBoard?.hierarchy_type !== 'multi_level') return false;
		if (boards.overviewBoard) return true;
		pollsSinceTaskBoard += 1;
		return pollsSinceTaskBoard > OVERVIEW_BOARD_GRACE_POLLS;
	});
	return splitProjectBoards(matches);
}

export async function requestConnectProject(
	client: MondayGraphQLClient,
	itemIndex: number,
	projectBoardId: string,
	portfolioBoardId: string,
	callbackUrl?: string,
): Promise<IDataObject> {
	const data = await client.execute(
		`mutation ($projectBoardId: ID!, $portfolioBoardId: ID!, $callbackUrl: String) {
			connect_project_to_portfolio(projectBoardId: $projectBoardId, portfolioBoardId: $portfolioBoardId, callback_url: $callbackUrl) {
				success
				message
				portfolio_item_id
				process_id
			}
		}`,
		itemIndex,
		{ projectBoardId, portfolioBoardId, callbackUrl: callbackUrl ?? null },
	);
	return (data.connect_project_to_portfolio ?? {}) as IDataObject;
}

/** Reads a board ID from a resource locator. */
export function requireBoardId(
	this: IExecuteFunctions,
	parameterName: string,
	fieldName: string,
	itemIndex: number,
): string {
	const value = String(
		this.getNodeParameter(parameterName, itemIndex, '', { extractValue: true }),
	).trim();
	if (/^\d+$/.test(value)) return value;
	throw new NodeOperationError(
		this.getNode(),
		value ? `${fieldName} "${value}" is not a board ID` : `${fieldName} is required`,
		{ itemIndex },
	);
}
