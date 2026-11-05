import { ChatOpenAI } from '@langchain/openai';
import { makeN8nLlmFailedAttemptHandler, getProxyAgent, aiClientFetch } from '@n8n/ai-utilities';
import { createMockExecuteFunction } from 'n8n-nodes-base/test/nodes/Helpers';
import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import type { Mocked } from 'vitest';

import { LmChatMonday } from '../LmChatMonday.node';

vi.mock('@langchain/openai');
vi.mock('@n8n/ai-utilities');

const MockedChatOpenAI = vi.mocked(ChatOpenAI);
const mockedMakeN8nLlmFailedAttemptHandler = vi.mocked(makeN8nLlmFailedAttemptHandler);
const mockedGetProxyAgent = vi.mocked(getProxyAgent);
const mockedAiClientFetch = vi.mocked(aiClientFetch);

const MONDAY_MODELS_BASE_URL = 'https://api.monday.com/platform-ai-gateway/openai/v1';

describe('LmChatMonday', () => {
	let node: LmChatMonday;

	const mockNodeDef: INode = {
		id: '1',
		name: 'Monday.com Chat Model',
		typeVersion: 1,
		type: '@n8n/n8n-nodes-langchain.lmChatMonday',
		position: [0, 0],
		parameters: {},
	};

	const setupMockContext = () => {
		const ctx = createMockExecuteFunction<ISupplyDataFunctions>(
			{},
			mockNodeDef,
		) as Mocked<ISupplyDataFunctions>;

		ctx.getCredentials = vi.fn().mockResolvedValue({
			apiToken: 'monday-token',
		});
		ctx.getNode = vi.fn().mockReturnValue(mockNodeDef);
		ctx.getNodeParameter = vi.fn().mockImplementation((paramName: string) => {
			if (paramName === 'model') return 'monday-standard';
			if (paramName === 'options') return {};
			return undefined;
		});
		ctx.helpers.getSecureEgressFilter = vi.fn().mockReturnValue({});

		mockedMakeN8nLlmFailedAttemptHandler.mockReturnValue(vi.fn());
		mockedGetProxyAgent.mockReturnValue({} as never);
		return ctx;
	};

	beforeEach(() => {
		node = new LmChatMonday();
		vi.clearAllMocks();
	});

	it('points ChatOpenAI at the monday Models API with the Monday.com token', async () => {
		const ctx = setupMockContext();

		const result = await node.supplyData.call(ctx, 0);

		expect(ctx.getCredentials).toHaveBeenCalledWith('mondayComApi');
		expect(MockedChatOpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'monday-token',
				model: 'monday-standard',
				configuration: expect.objectContaining({
					fetch: mockedAiClientFetch,
					baseURL: MONDAY_MODELS_BASE_URL,
				}),
			}),
		);
		expect(result).toEqual({ response: expect.any(Object) });
	});
});
