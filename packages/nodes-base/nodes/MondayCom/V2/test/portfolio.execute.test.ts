import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as connectProject } from '../actions/portfolio/connectProjectToPortfolio.operation';
import { execute as createPortfolio } from '../actions/portfolio/createPortfolio.operation';
import { execute as createProject } from '../actions/portfolio/createProject.operation';
import { splitProjectBoards } from '../helpers/portfolio';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

vi.mock('@n8n/utils/sleep', () => ({ sleep: vi.fn(async () => {}) }));

const node: INode = {
	id: '1',
	name: 'monday.com',
	type: 'n8n-nodes-base.mondayCom',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (
			name: string,
			_index: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => {
			const value = params[name];
			if (value === undefined) return fallback;
			if (options?.extractValue && typeof value === 'object' && value !== null) {
				return (value as { value: unknown }).value;
			}
			return value;
		},
		getNode: () => node,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const boards = (...rows: IDataObject[]) => ({ boards: rows });
const oldBoard = { id: '1', name: 'Launch', type: 'board', hierarchy_type: 'classic' };
const taskBoard = {
	id: '10',
	name: 'Launch',
	url: 'https://x.monday.com/boards/10',
	type: 'board',
	hierarchy_type: 'multi_level',
	item_terminology: 'task',
};
const overviewBoard = {
	id: '11',
	name: 'Launch',
	url: 'https://x.monday.com/boards/11',
	type: 'board',
	hierarchy_type: 'classic',
	item_terminology: 'project',
};
const accepted = { create_project: { success: true, message: 'Project creation initiated' } };

describe('Portfolio & Project: Create Project', () => {
	it('excludes old boards with the same name and returns both new boards', async () => {
		const { client, execute } = makeClient(
			boards(oldBoard),
			accepted,
			boards(oldBoard),
			boards(taskBoard, oldBoard),
			boards(overviewBoard, taskBoard, oldBoard),
		);
		const ctx = makeContext({
			projectName: ' Launch ',
			projectKind: 'private',
			createProjectOptions: {
				workspaceId: { mode: 'id', value: '7' },
				folderId: '3',
				resourcePlanner: true,
			},
		});

		expect(await createProject.call(ctx, client, 0)).toEqual({
			success: true,
			message: 'Project creation initiated',
			processId: null,
			projectBoardId: '10',
			projectBoardUrl: 'https://x.monday.com/boards/10',
			overviewBoardId: '11',
			overviewBoardUrl: 'https://x.monday.com/boards/11',
		});
		expect(call(execute, 0)[2]).toEqual({ limit: 50, workspaceIds: ['7'] });
		expect(call(execute, 1)[2]).toEqual({
			input: {
				name: 'Launch',
				board_kind: 'private',
				workspace_id: '7',
				folder_id: '3',
				companions: ['resource_planner'],
			},
		});
	});

	it('returns without the overview board when it does not come after a few polls', async () => {
		const { client, execute } = makeClient(
			boards(),
			accepted,
			...Array.from({ length: 4 }, () => boards(taskBoard)),
		);
		const ctx = makeContext({ projectName: 'Launch', projectKind: 'public' });

		const result = await createProject.call(ctx, client, 0);

		expect(result).toMatchObject({ projectBoardId: '10', overviewBoardId: null });
		expect(execute).toHaveBeenCalledTimes(6);
	});

	it('fails after the timeout and names the board', async () => {
		const { client, execute } = makeClient(boards(), accepted, boards(), boards());
		const ctx = makeContext({
			projectName: 'Launch',
			projectKind: 'public',
			createProjectOptions: { waitTimeout: 10 },
		});

		await expect(createProject.call(ctx, client, 0)).rejects.toThrow(
			'The project board "Launch" did not appear within 10 seconds',
		);
		expect(execute).toHaveBeenCalledTimes(4);
	});

	it('does not poll when Wait for Boards is off', async () => {
		const { client, execute } = makeClient(accepted);
		const ctx = makeContext({ projectName: 'Launch', projectKind: 'public', projectWait: false });

		expect(await createProject.call(ctx, client, 0)).toEqual({
			success: true,
			message: 'Project creation initiated',
			processId: null,
		});
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('connects the task board to the portfolio', async () => {
		const { client, execute } = makeClient(boards(), accepted, boards(overviewBoard, taskBoard), {
			connect_project_to_portfolio: { success: true, portfolio_item_id: '99' },
		});
		const ctx = makeContext({
			projectName: 'Launch',
			projectKind: 'public',
			connectToPortfolio: true,
			projectWait: false,
			portfolioBoardId: { mode: 'id', value: '500' },
		});

		const result = await createProject.call(ctx, client, 0);

		expect(result).toMatchObject({
			projectBoardId: '10',
			portfolioBoardId: '500',
			portfolioItemId: '99',
		});
		expect(call(execute, 3)[2]).toEqual({
			projectBoardId: '10',
			portfolioBoardId: '500',
			callbackUrl: null,
		});
	});

	it('names the created board when the connection fails', async () => {
		const { client } = makeClient(boards(), accepted, boards(overviewBoard, taskBoard), {
			connect_project_to_portfolio: { success: false, message: 'Failed to connect' },
		});
		const ctx = makeContext({
			projectName: 'Launch',
			projectKind: 'public',
			connectToPortfolio: true,
			portfolioBoardId: { mode: 'id', value: '500' },
		});

		await expect(createProject.call(ctx, client, 0)).rejects.toThrow(
			'monday.com created project board 10, but could not connect it to portfolio board 500',
		);
	});

	it.each([
		[{ projectKind: 'share' }, 'Board Kind "share" is not supported'],
		[{ createProjectOptions: { templateId: '5', resourcePlanner: true } }, 'Template ID and'],
		[{ createProjectOptions: { callbackUrl: 'http://example.com' } }, 'not an HTTPS URL'],
		[
			{ connectToPortfolio: true, portfolioBoardId: { mode: 'id', value: '' } },
			'Portfolio Board is required',
		],
		[{ projectName: ' ' }, 'Name is required'],
	])('rejects invalid input before any request: %j', async (extra, message) => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ projectName: 'Launch', projectKind: 'public', ...extra });

		await expect(createProject.call(ctx, client, 0)).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});

	it('reports the reason when monday.com rejects the project', async () => {
		const { client } = makeClient({
			create_project: { success: false, error: 'Template not found' },
		});
		const ctx = makeContext({ projectName: 'Launch', projectKind: 'public', projectWait: false });

		await expect(createProject.call(ctx, client, 0)).rejects.toMatchObject({
			message: 'monday.com did not create the project',
			description: 'monday.com returned: Template not found',
		});
	});
});

describe('Portfolio & Project: Create Portfolio', () => {
	it('sends the workspace as a number and returns the new board', async () => {
		const portfolio = {
			id: '20',
			name: 'Q3',
			url: 'https://x.monday.com/boards/20',
			type: 'board',
		};
		const { client, execute } = makeClient(
			boards({ ...portfolio, id: '2' }),
			{ create_portfolio: { success: true, message: 'ok', process_id: 'p1' } },
			boards(portfolio, { ...portfolio, id: '2' }),
		);
		const ctx = makeContext({
			portfolioName: 'Q3',
			portfolioPrivacy: 'share',
			createPortfolioOptions: {
				workspaceId: { mode: 'id', value: '7' },
				callbackUrl: 'https://example.com/hook',
			},
		});

		expect(await createPortfolio.call(ctx, client, 0)).toEqual({
			success: true,
			message: 'ok',
			processId: 'p1',
			portfolioBoardId: '20',
			portfolioBoardName: 'Q3',
			portfolioBoardUrl: 'https://x.monday.com/boards/20',
		});
		expect(call(execute, 1)[2]).toEqual({
			name: 'Q3',
			privacy: 'share',
			workspaceId: 7,
			callbackUrl: 'https://example.com/hook',
		});
	});

	it('explains the plan when monday.com rejects the portfolio', async () => {
		const { client } = makeClient({
			create_portfolio: {
				success: false,
				message: 'Failed to create portfolio: Not supported for non-enterprise accounts',
			},
		});
		const ctx = makeContext({
			portfolioName: 'Q3',
			portfolioPrivacy: 'private',
			portfolioWait: false,
		});

		await expect(createPortfolio.call(ctx, client, 0)).rejects.toMatchObject({
			message: 'monday.com did not create the portfolio',
			description: expect.stringContaining('Portfolios need an Enterprise plan'),
		});
	});
});

describe('Portfolio & Project: Connect Project', () => {
	it('returns the portfolio item and both board IDs', async () => {
		const { client } = makeClient({
			connect_project_to_portfolio: { success: true, portfolio_item_id: '99', process_id: null },
		});
		const ctx = makeContext({
			projectBoardId: { mode: 'list', value: '10' },
			portfolioBoardId: { mode: 'id', value: '500' },
		});

		expect(await connectProject.call(ctx, client, 0)).toEqual({
			success: true,
			message: null,
			portfolioItemId: '99',
			processId: null,
			projectBoardId: '10',
			portfolioBoardId: '500',
		});
	});

	it('adds a hint to the generic failure', async () => {
		const { client } = makeClient({
			connect_project_to_portfolio: { success: false, message: 'Failed to connect. ' },
		});
		const ctx = makeContext({ projectBoardId: '10', portfolioBoardId: '500' });

		await expect(connectProject.call(ctx, client, 0)).rejects.toMatchObject({
			message: 'monday.com could not connect project board 10 to portfolio board 500',
			description: expect.stringContaining('task board of a project'),
		});
	});
});

describe('splitProjectBoards', () => {
	it('picks the multi-level board, then a task board, then the first match', () => {
		expect(splitProjectBoards([overviewBoard, taskBoard]).projectBoard?.id).toBe('10');
		expect(
			splitProjectBoards([{ ...taskBoard, hierarchy_type: 'classic' }, overviewBoard]).projectBoard
				?.id,
		).toBe('10');
		expect(splitProjectBoards([overviewBoard])).toEqual({ projectBoard: overviewBoard });
		expect(splitProjectBoards([])).toEqual({});
	});
});
